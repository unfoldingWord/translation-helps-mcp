#!/usr/bin/env node
/**
 * Compares every call in tests/contracts/packs3-calls.json between format 3 and today's path.
 * Usage: node scripts/compare-packs3.mjs --base <url> [--base-b <url>] [--calls f] [--known f] [--out docs/packs3-comparison.md] [--key <bearer>]
 *  - one base: each call twice, `x-th-packs3: off` against `x-th-packs3: only` (the Worker needs PACKS_V3_DEBUG=on)
 *  - two bases: each call plain on both (A = --base, B = --base-b)
 * Calls go through the stateless MCP endpoint (`<base>/v3/mcp`, tools/call). Exit 1 on any difference not listed in
 * the known-differences file, on a pack call that falls back, on a fallback call that does not, or on an `only`
 * answer without the Worker's `_meta._packs3` mark (served or fallback is read from that mark, never from the text).
 * Pure parts are exported for tests/unit/compare-packs3.test.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TOOLS = [
  "th_get_passage",
  "th_get_passage_index",
  "th_get_notes",
  "th_get_questions",
  "th_get_article",
  "th_search",
  "th_list_resources",
];
const ID_PLACEHOLDER = "__FROM_INDEX__";

/** Removes what is allowed to differ, each for a reason:
 *  - requestId: new on every call.
 *  - meta.timings: wall-clock milliseconds.
 *  - meta.cache, meta.cacheStatus: whether a cache answered differs between `off` and `only` by design.
 *  - the text summary's trailing [cache...] tag, or a [kv], [pack], [memory], [mixed] or [network] tag (the
 *    meta.cache value in prose, as in `3 scripture version(s) for JHN 3:16 [kv]`): the same cache note, in prose.
 *  - _meta._packs3: the debug mark of the path taken, read separately. */
export function normalize(value) {
  if (typeof value === "string") {
    if (value.startsWith("{") || value.startsWith("[")) {
      // The text content blocks carry the JSON answer as a string (with its own meta).
      try {
        return JSON.stringify(normalize(JSON.parse(value)));
      } catch {
        /* not JSON */
      }
    }
    return value
      .replace(/[ \t]*\[cache[^\]]*\](?=\s*$)/gi, "")
      .replace(/(\S)[ \t]*\[(?:kv|pack|memory|mixed|network)\](?=\s*$|\s*\n)/g, "$1");
  }
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "requestId") continue;
      if (k === "_meta" && v && typeof v === "object" && !Array.isArray(v)) {
        // _meta._packs3 is the debug mark of where the answer came from, not part of the answer.
        const { _packs3: _p, ...rest } = v;
        if (Object.keys(rest).length) out[k] = normalize(rest);
        continue;
      }
      if (k === "meta" && v && typeof v === "object" && !Array.isArray(v)) {
        const { timings: _t, cache: _c, cacheStatus: _s, ...rest } = v;
        if (Object.keys(rest).length) out[k] = normalize(rest);
        continue;
      }
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

/** Every leaf difference as { path, a, b }; paths look like `$.notes[2].quote`. */
export function diffPaths(a, b, path = "$") {
  if (a === b) return [];
  const isObj = (x) => x && typeof x === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    return [{ path, a, b }];
  }
  const out = [];
  if (Array.isArray(a)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length) out.push({ path: `${path}[${i}]`, a: undefined, b: b[i] });
      else if (i >= b.length) out.push({ path: `${path}[${i}]`, a: a[i], b: undefined });
      else out.push(...diffPaths(a[i], b[i], `${path}[${i}]`));
    }
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in a)) out.push({ path: `${path}.${k}`, a: undefined, b: b[k] });
    else if (!(k in b)) out.push({ path: `${path}.${k}`, a: a[k], b: undefined });
    else out.push(...diffPaths(a[k], b[k], `${path}.${k}`));
  }
  return out;
}

/** normalize for a whole tool result: the result's own top-level `cacheStatus` (hit, miss, ...) also differs with how
 *  warm each side's cache is, like meta.cacheStatus; nested fields of that name stay (see normalize). */
export function normalizeResult(result) {
  if (result && typeof result === "object" && !Array.isArray(result) && "cacheStatus" in result) {
    const { cacheStatus: _c, ...rest } = result;
    return normalize(rest);
  }
  return normalize(result);
}

const sameJson = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/** A known difference matches on tool, args (omitted = any) and path (a trailing `*` is a prefix; array indexes also match as `[]`). */
export function matchKnown(known, call, path) {
  const generic = path.replace(/\[\d+\]/g, "[]");
  return known.find((k) => {
    if (k.tool !== call.tool) return false;
    if (k.args !== undefined && !sameJson(k.args, call.args)) return false;
    const p = String(k.path);
    if (p.endsWith("*")) {
      const pre = p.slice(0, -1);
      return path.startsWith(pre) || generic.startsWith(pre);
    }
    return p === path || p === generic;
  });
}

/** Release skew: a difference at a `release` field (path ends in `.release`) whose two strings differ only in the
 *  release number, such as v91 against v92. Anything else, including a v3 against v4 elsewhere, stays a diff. */
export function isReleaseSkew(a, b, path = "") {
  if (!/\.release$/.test(path)) return false;
  if (typeof a !== "string" || typeof b !== "string" || a === b) return false;
  const tag = /\bv\d+\b/g;
  return /\bv\d+\b/.test(a) && a.replace(tag, "v#") === b.replace(tag, "v#");
}

/** The error class of an answer: the code (structuredContent.code or JSON-RPC error.code), else the first words of an
 *  isError text; null when the answer is not an error. */
export function errorClass(result) {
  if (result?.error) return `rpc:${result.error.code ?? result.error.message ?? "error"}`;
  const sc = result?.structuredContent;
  const isErr = result?.isError === true || sc?.error === true || sc?.available === false;
  if (!isErr) return null;
  if (typeof sc?.code === "string") return sc.code;
  const text = result?.content?.find?.((c) => typeof c?.text === "string")?.text ?? "";
  return `text:${text.split(/[:\n]/)[0].trim().slice(0, 60)}`;
}

/** Null when the two answers agree on being errors or not and on the error class; otherwise a message. */
export function errorMismatch(a, b) {
  const ca = errorClass(a);
  const cb = errorClass(b);
  return ca === cb ? null : `error mismatch: A ${ca ?? "ok"}, B ${cb ?? "ok"}`;
}

/** Sorts diffs into skew, known and failing. */
export function classify(diffs, call, known) {
  const skew = [];
  const knownHit = [];
  const failing = [];
  for (const d of diffs) {
    if (isReleaseSkew(d.a, d.b, d.path)) skew.push(d);
    else {
      const k = matchKnown(known, call, d.path);
      if (k) knownHit.push({ ...d, reason: k.reason });
      else failing.push(d);
    }
  }
  return { skew, known: knownHit, failing };
}

/** The call list is valid when every call has a seven-tool name, object args and an expectation; counts per language. */
export function validateCalls(calls) {
  const errors = [];
  if (!Array.isArray(calls)) return { errors: ["calls is not an array"], en: 0, es: 0 };
  let en = 0;
  let es = 0;
  calls.forEach((c, i) => {
    if (!c || typeof c !== "object") return errors.push(`#${i}: not an object`);
    if (!TOOLS.includes(c.tool)) errors.push(`#${i}: unknown tool ${c.tool}`);
    if (!c.args || typeof c.args !== "object" || Array.isArray(c.args)) errors.push(`#${i}: args must be an object`);
    if (c.expect !== "pack" && c.expect !== "fallback" && c.expect !== "either") errors.push(`#${i}: expect must be pack, fallback or either`);
    if (c.args?.language === "en") en++;
    if (c.args?.language === "es-419") es++;
  });
  return { errors, en, es };
}

export function validateKnown(known) {
  if (!Array.isArray(known)) return ["known diffs is not an array"];
  return known.flatMap((k, i) =>
    typeof k?.tool === "string" && typeof k?.path === "string" && typeof k?.reason === "string" && k.reason
      ? []
      : [`known #${i}: needs tool, path and reason`],
  );
}

/** The Worker's own mark (PACKS_V3_DEBUG=on only): `result._meta._packs3` is `{ served: true }` or
 *  `{ fallback: "<reason>" }`. Nothing is inferred from the answer text: no mark is `unmarked`, never served. */
export function packs3Status(result) {
  const m = result?._meta?._packs3;
  if (m && typeof m === "object") {
    if (typeof m.fallback === "string" && m.fallback) return { kind: "fallback", reason: m.fallback };
    if (m.served === true) return { kind: "served" };
  }
  return { kind: "unmarked" };
}

/** The marked fallback reason, or null (served or unmarked). */
export function fallbackReason(result) {
  const s = packs3Status(result);
  return s.kind === "fallback" ? s.reason : null;
}

export function isFallback(result) {
  return fallbackReason(result) !== null;
}

/** A text block that carries the JSON answer repeats every structuredContent difference: keep only the latter. */
export function dropMirroredText(diffs) {
  const structured = diffs.some((d) => d.path.startsWith("$.structuredContent"));
  if (!structured) return diffs;
  return diffs.filter(
    (d) => !(/^\$\.content\[\d+\]\.text$/.test(d.path) && typeof d.a === "string" && /^[[{]/.test(d.a)),
  );
}

// ---- network part ----

async function callTool(base, headers, tool, args, key) {
  const t0 = Date.now();
  const res = await fetch(`${base.replace(/\/$/, "")}/v3/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    const line = raw.split("\n").find((l) => l.startsWith("data:"));
    body = line ? JSON.parse(line.slice(5)) : { httpStatus: res.status, raw: raw.slice(0, 500) };
  }
  return { ms: Date.now() - t0, status: res.status, result: body.result ?? body };
}

/** `ids: ["__FROM_INDEX__"]` becomes the first two note ids of th_get_passage_index for the same reference. */
async function resolveIds(call, base, headers, key) {
  if (!JSON.stringify(call.args).includes(ID_PLACEHOLDER)) return call;
  const { result } = await callTool(
    base,
    headers,
    "th_get_passage_index",
    { reference: call.args.reference, language: call.args.language },
    key,
  );
  const notes = result?.structuredContent?.notes ?? [];
  const ids = notes
    .map((n) => n.id)
    .filter(Boolean)
    .slice(0, 2);
  return { ...call, args: { ...call.args, ids } };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function fbSummary(rows) {
  const by = {};
  for (const r of rows) if (r.fallback) by[r.fallback] = (by[r.fallback] ?? 0) + 1;
  const parts = Object.entries(by).map(([k, n]) => `${k} ${n}`);
  return parts.length ? parts.join(", ") : "none";
}

const md = (v) => "`" + String(JSON.stringify(v)).slice(0, 160).replace(/`/g, "'") + "`";

async function main() {
  const base = arg("base");
  const baseB = arg("base-b");
  if (!base) {
    console.error("Usage: compare-packs3.mjs --base <url> [--base-b <url>]");
    process.exit(2);
  }
  const key = arg("key");
  const calls = JSON.parse(readFileSync(arg("calls") ?? "tests/contracts/packs3-calls.json", "utf8"));
  const known = JSON.parse(readFileSync(arg("known") ?? "tests/contracts/packs3-known-diffs.json", "utf8"));
  const v = validateCalls(calls);
  const kv = validateKnown(known);
  if (v.errors.length || kv.length) {
    console.error([...v.errors, ...kv].join("\n"));
    process.exit(2);
  }
  const sideA = baseB ? { base, headers: {} } : { base, headers: { "x-th-packs3": "off" } };
  const sideB = baseB ? { base: baseB, headers: {} } : { base, headers: { "x-th-packs3": "only" } };
  const rows = [];
  for (const original of calls) {
    const call = await resolveIds(original, sideA.base, sideA.headers, key);
    const a = await callTool(sideA.base, sideA.headers, call.tool, call.args, key);
    const b = await callTool(sideB.base, sideB.headers, call.tool, call.args, key);
    const row = { call, msA: a.ms, msB: b.ms, problems: [], skew: [], known: [], failing: [], fallback: null, status: null };
    if (/"RATE_LIMITED"/.test(JSON.stringify([a.result, b.result]))) {
      row.problems.push("rate limited: the run says nothing about this call (raise RATE_LIMIT_RPM and rerun)");
      rows.push(row);
      console.log(`FAIL ${call.tool} ${JSON.stringify(call.args)} rate limited`);
      continue;
    }
    const st = baseB ? null : packs3Status(b.result);
    // Under `only` a call format 3 cannot answer is an error by design (the fallback reason), so it is not an error mismatch.
    const em = st?.kind === "fallback" ? null : errorMismatch(a.result, b.result);
    if (em) row.problems.push(em);
    if (!baseB) {
      row.status = st.kind;
      row.fallback = st.kind === "fallback" ? st.reason : null;
      if (st.kind === "unmarked") {
        row.problems.push("UNMARKED: no _meta._packs3 on the `only` answer (is PACKS_V3_DEBUG on?); not counted as served");
        console.error(`UNMARKED ${call.tool} ${JSON.stringify(call.args)}: the Worker gave no _packs3 mark`);
      } else {
        if (call.expect === "pack" && st.kind === "fallback") row.problems.push(`expected a pack answer, got a fallback (${row.fallback})`);
        if (call.expect === "fallback" && st.kind === "served") row.problems.push("expected a fallback, got a format 3 answer");
      }
    }
    if ((call.expect !== "fallback" && row.status === "served") || baseB) {
      Object.assign(row, classify(dropMirroredText(diffPaths(normalizeResult(a.result), normalizeResult(b.result))), call, known));
    }
    rows.push(row);
    const bad = row.problems.length + row.failing.length;
    console.log(`${bad ? "FAIL" : "ok  "} ${call.tool} ${JSON.stringify(call.args)} ${a.ms}ms/${b.ms}ms`);
  }
  const failed = rows.filter((r) => r.problems.length || r.failing.length);
  const out = [
    "# Format 3 against today: comparison",
    "",
    baseB ? `A: ${sideA.base}, B: ${sideB.base} (plain)` : `Base: ${base}, \`x-th-packs3: off\` (A) against \`only\` (B)`,
    "",
    `Calls: ${rows.length} (en ${v.en}, es-419 ${v.es}). Failed: ${failed.length}. ` +
      `Known differences hit: ${rows.reduce((n, r) => n + r.known.length, 0)}. ` +
      `Release skew: ${rows.reduce((n, r) => n + r.skew.length, 0)}.`,
    "",
    `Fallbacks under \`only\` (from the Worker's _meta._packs3 mark): ${fbSummary(rows)}. ` +
      `Unmarked answers: ${rows.filter((r) => r.status === "unmarked").length}.`,
    "",
    "## Differences",
    "",
  ];
  for (const r of rows) {
    const t = `${r.call.tool} ${JSON.stringify(r.call.args)}`;
    for (const p of r.problems) out.push(`- FAIL ${t}: ${p}`);
    for (const d of r.failing.slice(0, 6)) out.push(`- FAIL ${t} ${d.path}: A ${md(d.a)} B ${md(d.b)}`);
    if (r.failing.length > 6) out.push(`- FAIL ${t}: and ${r.failing.length - 6} more differences`);
    for (const d of r.known) out.push(`- known ${t} ${d.path}: ${d.reason}`);
    for (const d of r.skew) out.push(`- release skew ${t} ${d.path}: A ${md(d.a)} B ${md(d.b)}`);
  }
  out.push("", "## Every call (timings in ms)", "", "| tool | args | expect | result | A | B |", "|---|---|---|---|---|---|");
  for (const r of rows) {
    const bad = r.problems.length + r.failing.length;
    const result = bad
      ? r.status === "unmarked"
        ? "FAIL (unmarked)"
        : "FAIL"
      : r.fallback
        ? `fallback (${r.fallback})${r.call.why ? `: ${r.call.why}` : ""}`
        : r.known.length
          ? "known differences"
          : r.skew.length
            ? "release skew"
            : "equal";
    out.push(`| ${r.call.tool} | ${md(r.call.args)} | ${r.call.expect} | ${result} | ${r.msA} | ${r.msB} |`);
  }
  writeFileSync(arg("out") ?? "docs/packs3-comparison.md", out.join("\n") + "\n");
  console.log(`${rows.length} calls, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

const self = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (self && fileURLToPath(import.meta.url).replace(/\\/g, "/") === self) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
