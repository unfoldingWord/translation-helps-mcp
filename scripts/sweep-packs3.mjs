#!/usr/bin/env node
/**
 * Whole-resource sweep: runs the format 3 adapters over a local copy of the staging bucket for EVERY item of one kind
 * (every chapter of every book, every article, a fixed query list) and compares each answer with today's answer of the
 * API Worker, with the normalizer of compare-packs3.mjs. A resource whose items all match (exceptions listed) is
 * proven for its release; the proof is a `verified.json` entry keyed `"<lang>|<resource key>|<release>|<kind>"`.
 *
 * Usage (the adapters are TypeScript, so run it with tsx, which the repo already has):
 *   npx tsx scripts/sweep-packs3.mjs --lang en|es-419 --kind passage|notes|links|questions|articles|search \
 *     --bucket <dir> --api <url> [--books tit,rut] [--resume] [--out-dir <dir>] [--cache <dir>] [--keys <id:hex>]
 *
 * - `--bucket` is a local copy of the staging bucket (a folder with `v3/catalog`, `v3/seg`); catalogs are verified with
 *   the trusted key as the Worker does (`--keys`, default the staging key of wrangler.toml).
 * - The API Worker is only read (GET): concurrency 4, retries with backoff on 429 and 5xx. Answers are cached in
 *   `<out-dir>/sweep-cache`; `--resume` reads that cache instead of asking again.
 * - `<out-dir>/verified.json` (default src/packs3) is merged, and `<out-dir>/verified-differences-<lang>-<kind>.md`
 *   lists the exceptions beside it.
 * - Until Task 13 removes the adapters' (language, book) lists, they are opened for the sweep (every book), so the
 *   sweep says what the adapter does on a book, not that the book is not on a list.
 * Pure parts are exported for tests/unit/packs3-sweep.test.ts.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diffPaths, normalize } from "./compare-packs3.mjs";

export const KINDS = ["passage", "notes", "links", "questions", "articles", "search"];

const SUBJECTS = {
  passage: ["Aligned Bible", "Bible"],
  notes: ["TSV Translation Notes"],
  links: ["TSV Translation Words Links"],
  questions: ["TSV Translation Questions"],
  tw: ["Translation Words"],
  ta: ["Translation Academy"],
};
// `articles` and `search` cover both article resources, in the order ta, tw.
SUBJECTS.articles = [...SUBJECTS.ta, ...SUBJECTS.tw];
SUBJECTS.search = SUBJECTS.articles;

const STAGING_KEY = "78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911";

const QUERIES = {
  en: [
    "grace", "faith", "love", "covenant", "sin", "priest", "temple", "sacrifice", "kingdom of god", "holy spirit",
    "salvation", "righteous", "forgive", "repent", "resurrection", "prophet", "angel", "blessing", "sabbath", "passover",
    "gospel", "apostle", "disciple", "elder", "church", "baptize", "circumcision", "idol", "wisdom", "justice",
    "metaphor", "figs-simile", "how to translate names", "translate numbers", "rhetorical question", "abstract nouns",
    "son of god", "lamb", "shepherd", "heaven",
  ],
  "es-419": [
    "gracia", "fe", "amor", "pacto", "pecado", "sacerdote", "templo", "sacrificio", "reino de dios", "espiritu santo",
    "salvacion", "justo", "perdonar", "arrepentimiento", "resurreccion", "profeta", "angel", "bendicion", "sabado", "pascua",
    "evangelio", "apostol", "discipulo", "anciano", "iglesia", "bautizar", "circuncision", "idolo", "sabiduria", "justicia",
    "metafora", "simil", "como traducir nombres", "traducir numeros", "pregunta retorica", "sustantivos abstractos",
    "hijo de dios", "cordero", "pastor", "cielo",
  ],
};

/** The fixed query list of a language (40 each for en and es-419); none for another language. */
export function searchQueries(lang) {
  return [...(QUERIES[lang] ?? [])];
}

/** `"<lang>|<resource key>|<release>|<kind>"`: the proof is by release, never by content hash. */
export function sweepKey(lang, resourceKey, release, kind) {
  return `${lang}|${resourceKey}|${release}|${kind}`;
}

/** The catalog resources a kind covers (sorted by key). */
export function resourcesOfKind(kind, resources) {
  const subjects = SUBJECTS[kind] ?? [];
  return resources.filter((r) => subjects.includes(r.subject)).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** The items that did not match: differing answers, fallbacks and API errors. Sorted, unique. */
export function listExceptions(results) {
  return [...new Set(results.filter((r) => r.status !== "equal").map((r) => r.item))].sort();
}

export function buildEntry(results, swept) {
  return { items: new Set(results.map((r) => r.item)).size, exceptions: listExceptions(results), swept };
}

/** Existing entries plus new ones (a new entry replaces the same key); keys sorted; inputs untouched. */
export function mergeVerified(existing, entries) {
  const all = { ...existing, ...entries };
  return Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
}

/** One item: the adapter's attempt against the API's JSON (`undefined` when the API did not answer 2xx). */
export function classifyItem(attempt, api) {
  if (api === undefined) return { status: "api-error" };
  if (!attempt.hit) return { status: "fallback", reason: attempt.reason };
  const mine = JSON.parse(JSON.stringify(attempt.value));
  const diffs = diffPaths(normalize(api), normalize(mine));
  return diffs.length ? { status: "differs", diffs } : { status: "equal" };
}

/** Chapter numbers of several lists of chapter strings: numeric only, unique, ascending. */
export function unionChapters(lists) {
  const set = new Set();
  for (const list of lists) for (const c of list) if (/^\d+$/.test(String(c))) set.add(Number(c));
  return [...set].sort((a, b) => a - b);
}

/** `["TIT", "TIT 1", …]` (the whole-book item only where `withBook`). */
export function chapterItems(book, chapters, withBook) {
  return [...(withBook ? [book] : []), ...chapters.map((c) => `${book} ${c}`)];
}

/** The API request of an item; `kind` is a sweep kind or an article sub-kind (`tw`, `ta`). */
export function requestOf(kind, language, item) {
  switch (kind) {
    case "passage":
      return { path: "/api/v1/scripture", params: { reference: item, language } };
    case "notes":
      return { path: "/api/v1/notes", params: { reference: item, language } };
    case "links":
      return { path: "/api/v1/word-links", params: { reference: item, language } };
    case "questions":
      return { path: "/api/v1/questions", params: { reference: item, language } };
    case "tw":
    case "ta":
      return {
        path: `/api/v1/${kind === "tw" ? "words" : "academy"}/${item.split("/").map(encodeURIComponent).join("/")}`,
        params: { language, requestedPath: item, prepared: "1" },
      };
    case "search":
      return { path: "/api/v1/search", params: { q: item, language, types: "tw", limit: "5" } };
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

// ---- running part ----

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The bucket folder as the Worker's R2 binding: the body object also answers `arrayBuffer()`, as R2 does. */
async function localBucket(dir) {
  const { dirBucket } = await import("../src/packs/dirBucket.ts");
  const b = dirBucket(dir);
  return {
    head: (k) => b.head(k),
    get: async (k, o) => {
      const r = await b.get(k, o);
      return r && r.body ? { ...r, arrayBuffer: () => new Response(r.body).arrayBuffer() } : r;
    },
  };
}

/** GET with retries (429 and 5xx back off, 4 tries after the first); `undefined` for any other non-2xx. Cached on disk. */
async function apiGet(base, req, cacheDir, resume) {
  const qs = new URLSearchParams(req.params).toString();
  const url = `${base.replace(/\/$/, "")}${req.path}?${qs}`;
  const file = join(cacheDir, createHash("sha1").update(url).digest("hex") + ".json");
  if (resume && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).body;
  let last = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { accept: "application/json" } });
    } catch {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    last = res.status;
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** attempt;
      await sleep(Math.min(wait, 30000));
      continue;
    }
    const body = res.ok ? await res.json().catch(() => undefined) : undefined;
    writeFileSync(file, JSON.stringify({ url, status: res.status, body }));
    return body;
  }
  console.error(`API gave ${last} for ${url} after retries`);
  return undefined;
}

async function pool(tasks, n, run) {
  let next = 0;
  const out = new Array(tasks.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await run(tasks[i], i);
      }
    }),
  );
  return out;
}

const cellOf = (v) => "`" + String(JSON.stringify(v)).slice(0, 140).replace(/`/g, "'") + "`";

async function main() {
  const lang = arg("lang");
  const kind = arg("kind");
  const bucketDir = arg("bucket");
  const api = arg("api");
  if (!lang || !KINDS.includes(kind) || !bucketDir || !api) {
    console.error("Usage: sweep-packs3.mjs --lang en|es-419 --kind <kind> --bucket <dir> --api <url> [--books a,b] [--resume]");
    process.exit(2);
  }
  const outDir = resolve(arg("out-dir") ?? join(dirname(fileURLToPath(import.meta.url)), "..", "src", "packs3"));
  const cacheDir = resolve(arg("cache") ?? join(outDir, "sweep-cache"));
  mkdirSync(cacheDir, { recursive: true });
  const only = arg("books")?.toLowerCase().split(",").filter(Boolean);

  const { getCatalogs } = await import("../src/packs3/catalogs.ts");
  const { withReader } = await import("../src/packs3/readers.ts");
  const { attemptPacks3 } = await import("../src/packs3/answer.ts");
  const { BOOKS } = await import("../src/packs3/adapters/scripture.ts");
  const { GROUPS, pathOfId } = await import("../src/packs3/adapters/articles.ts");
  const helps = await import("../src/packs3/adapters/helps.ts");
  const questions = await import("../src/packs3/adapters/questions.ts");
  // Open the adapters' hand lists of books for the sweep (Task 13 removes them).
  for (const m of [helps.VERIFIED_BOOKS, questions.VERIFIED_QUESTION_BOOKS]) {
    if (m instanceof Map) m.set(lang, new Set(BOOKS));
  }

  const env = {
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: arg("keys") ?? STAGING_KEY,
    LANGUAGE_PACKS: await localBucket(bucketDir),
  };
  const cats = await getCatalogs(env, lang);
  if (!cats) throw new Error(`no verified catalogs for ${lang} in ${bucketDir}`);
  const own = cats.catalogs.find((c) => c.name !== "common");
  const resources = resourcesOfKind(kind, own.catalog.resources ?? []);
  if (!resources.length) throw new Error(`the ${lang} catalog has no resource for ${kind}`);

  // Items: { res (resource keys they prove), sub (request kind), item }.
  const items = [];
  if (kind === "search") {
    for (const q of searchQueries(lang)) items.push({ sub: "search", item: q, res: resources.map((r) => r.key) });
  } else if (kind === "articles") {
    await withReader(env, lang, async (reader) => {
      for (const sub of ["tw", "ta"]) {
        const res = resources.filter((r) => SUBJECTS[sub].includes(r.subject)).map((r) => r.key);
        for (const group of GROUPS[sub]) {
          if (!reader.listed(`art:${group}`)) continue;
          for (const a of (await reader.articles(group)) ?? []) items.push({ sub, item: pathOfId(a.id), res });
        }
      }
    });
  } else {
    const hasBit = (r, i) => ((r.books?.[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
    const withBook = kind === "notes" || kind === "links";
    const codes = BOOKS.filter((code, i) => resources.some((r) => hasBit(r, i)) && (!only || only.includes(code)));
    for (const code of codes) {
      const chapters = await withReader(env, lang, async (reader) => {
        const data = await reader.book(code);
        const lists = [];
        for (const t of data?.texts ?? []) lists.push((t.events ?? []).filter((e) => e[1] === "chapter").map((e) => e[2]));
        for (const v of Object.values(data ?? {})) {
          if (v && Array.isArray(v.rows)) lists.push(v.rows.map((r) => String(r.ref).split(":")[0]));
        }
        const orig = await reader.orig(code).catch(() => undefined);
        if (orig?.events) lists.push(orig.events.filter((e) => e[1] === "chapter").map((e) => e[2]));
        return unionChapters(lists);
      });
      for (const item of chapterItems(code.toUpperCase(), chapters ?? [], withBook)) {
        items.push({ sub: kind, item, res: resources.map((r) => r.key) });
      }
    }
  }
  console.log(`${lang} ${kind}: ${items.length} items, ${resources.length} resource(s)`);

  // The adapters run one at a time (the readers are limited); the API is asked 4 at a time.
  let chain = Promise.resolve();
  const runAdapter = (path, params) => {
    const p = chain.then(() => attemptPacks3(env, path, params));
    chain = p.catch(() => undefined);
    return p;
  };
  let done = 0;
  const results = await pool(items, 4, async (it) => {
    const req = requestOf(it.sub, lang, it.item);
    const body = await apiGet(api, req, cacheDir, flag("resume"));
    const attempt = await runAdapter(req.path, req.params);
    const r = { ...it, ...classifyItem(attempt, body) };
    if (++done % 100 === 0) console.log(`${done}/${items.length}`);
    return r;
  });

  const swept = new Date().toISOString();
  const entries = {};
  const lines = [`# Sweep differences: ${lang} ${kind}`, "", `Swept ${swept}, API ${api}, catalog ${cats.key}.`, ""];
  for (const r of resources) {
    const mine = results.filter((x) => x.res.includes(r.key));
    const key = sweepKey(lang, r.key, r.release, kind);
    entries[key] = buildEntry(mine, swept);
    const bad = mine.filter((x) => x.status !== "equal");
    const by = {};
    for (const x of bad) {
      const why = x.status === "fallback" ? `fallback ${x.reason}` : x.status;
      by[why] = (by[why] ?? 0) + 1;
    }
    lines.push(`## ${key}`, "", `Items ${entries[key].items}, exceptions ${entries[key].exceptions.length}` +
      (bad.length ? ` (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""), "");
    for (const x of bad) {
      if (x.status === "differs") {
        lines.push(`- ${x.item}: differs`);
        for (const d of x.diffs.slice(0, 3)) lines.push(`  - ${d.path}: today ${cellOf(d.a)} format 3 ${cellOf(d.b)}`);
        if (x.diffs.length > 3) lines.push(`  - and ${x.diffs.length - 3} more`);
      } else lines.push(`- ${x.item}: ${x.status === "fallback" ? `fallback (${x.reason})` : x.status}`);
    }
    lines.push("");
  }
  const vfile = join(outDir, "verified.json");
  const existing = existsSync(vfile) ? JSON.parse(readFileSync(vfile, "utf8")) : {};
  writeFileSync(vfile, JSON.stringify(mergeVerified(existing, entries), null, 2) + "\n");
  const rfile = join(outDir, `verified-differences-${lang}-${kind}.md`);
  writeFileSync(rfile, lines.join("\n") + "\n");
  for (const [k, e] of Object.entries(entries)) console.log(`${k}: ${e.items} items, ${e.exceptions.length} exceptions`);
  console.log(`wrote ${vfile} and ${rfile}`);
}

const self = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (self && pathToFileURL(self).href === import.meta.url) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
