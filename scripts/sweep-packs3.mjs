#!/usr/bin/env node
/**
 * Whole-resource sweep: runs the format 3 adapters over a local copy of the staging bucket for EVERY item of one kind
 * (every chapter of every book, every article, a fixed query list) and compares each answer with today's answer of the
 * API Worker, with the normalizer of compare-packs3.mjs. A resource whose items all match (exceptions listed) is
 * proven for its release; the proof is a `verified.json` entry keyed `"<lang>|<resource key>|<release>|<kind>"`.
 *
 * Usage (the adapters are TypeScript, so run it with tsx, which the repo already has):
 *   npx tsx scripts/sweep-packs3.mjs --lang en|es-419 --kind passage|notes|links|questions|articles|search \
 *     --bucket <dir> --api <url> [--books tit,rut] [--resume] [--max-age-hours 24] [--out-dir <dir>] [--cache <dir>] [--keys <id:hex>]
 *
 * - `--bucket` is a local copy of the staging bucket (a folder with `v3/catalog`, `v3/seg`); catalogs are verified with
 *   the trusted key as the Worker does (`--keys`, default the staging key of wrangler.toml).
 * - The API Worker is only read (GET): concurrency 4, retries with backoff on 429 and 5xx. Answers are cached in
 *   `<out-dir>/sweep-cache` (git-ignored) with the fetch time and the catalog key; `--resume` reads that cache instead
 *   of asking again, but refetches an answer of another catalog key or older than `--max-age-hours` (24).
 * - A whole run merges `<out-dir>/verified.json` (default src/packs3) and writes `verified-differences-<lang>-<kind>.md`
 *   beside it. A narrowed run (`--books`) NEVER touches verified.json: it writes the report and
 *   `sweep-partial-<lang>-<kind>.json` only. Zero items for the kind or a resource is an error and writes nothing.
 * - TODO (Task 14): the API's own chapter count of a book is not cheaply available, so chapters come from format 3's
 *   book data (text events, helps rows incl. "front"); a chapter only the API has is not an item, and Task 13 must
 *   serve only the `chapters` an entry lists.
 * - The adapters are opened for the sweep (verified.ts `setSweepOpen`), so
 *   the sweep says what the adapter does on a book, not that it has no proof yet.
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
// `articles` covers both article resources, in the order ta, tw. `search` covers tw only: that is all
// adapters/search.ts serves (types=tw), so a ta entry would claim a proof nothing made.
SUBJECTS.articles = [...SUBJECTS.ta, ...SUBJECTS.tw];
SUBJECTS.search = SUBJECTS.tw;

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

/**
 * A verified.json entry (key `"<lang>|<resource key>|<release>|<kind>"`):
 *   { items: N, exceptions: [item, ...], swept: ISO date,
 *     deps: { "<catalog>|<resource key>": "<release>" },   // every other resource the answers depended on
 *     chapters: { "TIT": [0, 1, 2, "front"] },             // books/chapters swept (passage: items are verses + ranges)
 *     wholeBooks: ["TIT"],                                  // questions: the whole-book item was swept
 *     indexChapters: { "TIT": [0, 1] }, indexWholeBooks: ["TIT"],  // notes/links: the `fields=index` items swept
 *                                                           // (their exceptions are listed as "index:TIT 1")
 *     ids: ["bible/kt/grace"],                              // articles and search: the exact items swept
 *     skippedBooks: ["GEN"] }                               // passage: books the resource lists that are not served (OT)
 * Task 13 serves an item only if it is in that list, is not an exception, and every `deps` release equals the catalog's.
 */
export function buildEntry(results, swept, extra = {}) {
  return { items: new Set(results.map((r) => r.item)).size, exceptions: listExceptions(results), swept, ...extra };
}

/** Only a run over the whole resource may write verified.json: any narrowed run (`--books`) never does. */
export function shouldWriteVerified(opts) {
  return !(opts.books && opts.books.length > 0);
}

/** Keys of the resources that have no item (a whole run with one is an error, not an empty proof). */
export function emptyResources(items, resources) {
  return resources.filter((r) => !items.some((it) => it.res.includes(r.key))).map((r) => r.key);
}

/** Is a cached API answer still usable: same catalog key and fetched less than `maxAgeHours` ago. */
export function cacheFresh(cached, catalogKey, nowMs, maxAgeHours) {
  if (!cached || typeof cached.fetchedAt !== "number" || cached.catalog !== catalogKey) return false;
  return nowMs - cached.fetchedAt <= maxAgeHours * 3600 * 1000;
}

/** `owner/lang/id` keys of the zips named in an answer's `versions[].source` (`.../<owner>/<lang>_<id>/archive/<rel>.zip`). */
export function keysFromVersions(versions) {
  const keys = new Set();
  for (const v of versions ?? []) {
    const m = /^https:\/\/git\.door43\.org\/([^/]+)\/([^/]+)\/archive\//.exec(String(v?.source ?? ""));
    if (!m) continue;
    const i = m[2].indexOf("_");
    if (i > 0) keys.add(`${m[1]}/${m[2].slice(0, i)}/${m[2].slice(i + 1)}`);
  }
  return [...keys].sort();
}

/**
 * The results that count for one resource. An item of the resource's list whose answer did not contain the resource
 * (passage: `used` lists the resources the answer was made of) is an exception for it.
 */
export function resultsForResource(key, results) {
  return results
    .filter((r) => r.res.includes(key))
    .map((r) => (r.used && !r.used.includes(key) ? { ...r, status: "not-in-answer" } : r));
}

const HELPER = { notes: "Translation Academy", links: "Translation Words" };
const ORIGINALS = ["Greek New Testament", "Hebrew Old Testament"];

/**
 * The other resources an answer depended on: `{ "<catalog>|<resource key>": "<release>" }`.
 * `catalogs` is `[{ name, resources }]` (own catalog first, then common). passage: the resources the answers were made of
 * (`usedKeys`); notes/links: the aligned text, the originals and the article resource they take titles from;
 * questions, articles and search stand alone.
 */
export function depsFor(kind, selfKey, catalogs, { alignedKey, usedKeys = [] } = {}) {
  const wanted = (r) => {
    if (r.key === selfKey) return false;
    if (kind === "passage") return usedKeys.includes(r.key);
    if (kind === "notes" || kind === "links") {
      return r.key === alignedKey || ORIGINALS.includes(r.subject) || r.subject === HELPER[kind];
    }
    return false;
  };
  const out = {};
  for (const c of catalogs) for (const r of c.resources ?? []) if (wanted(r)) out[`${c.name}|${r.key}`] = r.release;
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/** What an item list covers: `{ chapters, wholeBooks? }` for items with a book, else `{ ids }`. */
export function coverageOf(items) {
  if (!items.some((i) => i.book)) return { ids: [...new Set(items.map((i) => i.item))].sort() };
  const order = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : typeof a === "number" ? -1 : typeof b === "number" ? 1 : String(a) < String(b) ? -1 : 1);
  const collect = (list) => {
    const chapters = {};
    const whole = new Set();
    for (const i of list) {
      if (i.chapter === undefined) whole.add(i.book);
      else (chapters[i.book] ??= new Set()).add(i.chapter);
    }
    return {
      chapters: Object.fromEntries(Object.keys(chapters).sort().map((b) => [b, [...chapters[b]].sort(order)])),
      whole: [...whole].sort(),
    };
  };
  const plain = collect(items.filter((i) => i.book && !i.index));
  const idx = collect(items.filter((i) => i.book && i.index));
  const hasPlain = items.some((i) => i.book && !i.index);
  const hasIdx = items.some((i) => i.book && i.index);
  return {
    ...(hasPlain || !hasIdx ? { chapters: plain.chapters } : {}),
    ...(plain.whole.length ? { wholeBooks: plain.whole } : {}),
    ...(hasIdx ? { indexChapters: idx.chapters } : {}),
    ...(idx.whole.length ? { indexWholeBooks: idx.whole } : {}),
  };
}

/** The sweep item of an index-shape request: `index:BOOK C` (exceptions carry the same prefix). */
export function indexItem(item) {
  return `index:${item}`;
}

/** `{ chapter: [verse numbers] }` from lists of text events (`[pos, "chapter"|"verse", n]`): union, numeric verses only. */
export function verseMap(eventLists) {
  const map = {};
  for (const events of eventLists) {
    let chapter;
    for (const e of events ?? []) {
      if (e[1] === "chapter") {
        chapter = /^\d+$/.test(String(e[2])) ? Number(e[2]) : undefined;
        if (chapter !== undefined) (map[chapter] ??= new Set());
      } else if (e[1] === "verse" && chapter !== undefined && /^\d+$/.test(String(e[2]))) map[chapter].add(Number(e[2]));
    }
  }
  return Object.fromEntries(
    Object.keys(map).map(Number).sort((a, b) => a - b).map((c) => [c, [...map[c]].sort((a, b) => a - b)]),
  );
}

/** Passage items of a book: `BOOK C:V` for every verse and one `BOOK C:1-N` range per chapter (N > 1). */
export function passageItems(book, verses) {
  const out = [];
  for (const [c, vs] of Object.entries(verses)) {
    for (const v of vs) out.push({ item: `${book} ${c}:${v}`, book, chapter: Number(c) });
    if (vs.length > 1) out.push({ item: `${book} ${c}:1-${vs[vs.length - 1]}`, book, chapter: Number(c) });
  }
  return out;
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

/** Chapters of several lists of chapter strings, unique: numbers ascending (0 is the intro), then names such as "front". */
export function unionChapters(lists) {
  const nums = new Set();
  const names = new Set();
  for (const list of lists) for (const c of list) (/^\d+$/.test(String(c)) ? nums.add(Number(c)) : names.add(String(c)));
  return [...[...nums].sort((a, b) => a - b), ...[...names].sort()];
}

/** `["TIT", "TIT 1", …]` (the whole-book item only where `withBook`). */
export function chapterItems(book, chapters, withBook) {
  return [...(withBook ? [book] : []), ...chapters.map((c) => `${book} ${c}`)];
}

/** The API request of an item; `kind` is a sweep kind or an article sub-kind (`tw`, `ta`). */
export function requestOf(kind, language, item, { index = false } = {}) {
  if (index) {
    if (kind !== "notes" && kind !== "links") throw new Error(`no index shape for ${kind}`);
    const r = requestOf(kind, language, item);
    return { ...r, params: { ...r.params, fields: "index" } };
  }
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
async function apiGet(base, req, cache) {
  const qs = new URLSearchParams(req.params).toString();
  const url = `${base.replace(/\/$/, "")}${req.path}?${qs}`;
  const file = join(cache.dir, createHash("sha1").update(url).digest("hex") + ".json");
  if (cache.resume && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8"));
    if (cacheFresh(cached, cache.catalogKey, Date.now(), cache.maxAgeHours)) return cached.body;
  }
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
    writeFileSync(file, JSON.stringify({ url, status: res.status, fetchedAt: Date.now(), catalog: cache.catalogKey, body }));
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
  const maxAgeHours = Number(arg("max-age-hours") ?? 24);
  const writeVerified = shouldWriteVerified({ books: only });

  const { getCatalogs } = await import("../src/packs3/catalogs.ts");
  const { withReader } = await import("../src/packs3/readers.ts");
  const { attemptPacks3 } = await import("../src/packs3/answer.ts");
  const { BOOKS, FIRST_NT } = await import("../src/packs3/adapters/scripture.ts");
  const { GROUPS, pathOfId } = await import("../src/packs3/adapters/articles.ts");
  const helps = await import("../src/packs3/adapters/helps.ts");
  // The sweep makes the proofs, so the adapters answer without them (scripture and helps: verified.ts).
  const verified = await import("../src/packs3/verified.ts");
  verified.setSweepOpen(true);

  const env = {
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: arg("keys") ?? STAGING_KEY,
    LANGUAGE_PACKS: await localBucket(bucketDir),
  };
  const cats = await getCatalogs(env, lang);
  if (!cats) throw new Error(`no verified catalogs for ${lang} in ${bucketDir}`);
  const own = cats.catalogs.find((c) => c.name !== "common");
  const catList = [own, ...cats.catalogs.filter((c) => c !== own)].map((c) => ({ name: c.name, resources: c.catalog.resources ?? [] }));
  const resources = resourcesOfKind(kind, own.catalog.resources ?? []);
  if (!resources.length) throw new Error(`the ${lang} catalog has no resource for ${kind}`);

  // Items: { res (resource keys they count for), sub (request kind), item, book?, chapter? }.
  const items = [];
  const skippedBooks = new Map(); // resource key -> books it lists that are not served
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
    for (const [i, code] of BOOKS.entries()) {
      const listing = resources.filter((r) => hasBit(r, i));
      if (!listing.length || (only && !only.includes(code))) continue;
      const B = code.toUpperCase();
      if (kind === "passage" && i < FIRST_NT) {
        // The scripture adapter serves the New Testament only; Hebrew is not proven.
        for (const r of listing) skippedBooks.set(r.key, [...(skippedBooks.get(r.key) ?? []), B]);
        continue;
      }
      const res = listing.map((r) => r.key);
      const found = await withReader(env, lang, async (reader) => {
        const data = await reader.book(code);
        const textEvents = (data?.texts ?? []).map((t) => t.events ?? []);
        const orig = await reader.orig(code).catch(() => undefined);
        if (orig?.events) textEvents.push(orig.events);
        const lists = textEvents.map((ev) => ev.filter((e) => e[1] === "chapter").map((e) => e[2]));
        for (const v of Object.values(data ?? {})) {
          if (v && Array.isArray(v.rows)) lists.push(v.rows.map((r) => String(r.ref).split(":")[0]));
        }
        return { chapters: unionChapters(lists), verses: verseMap(textEvents) };
      });
      if (kind === "passage") {
        for (const p of passageItems(B, found?.verses ?? {})) items.push({ ...p, sub: kind, res });
      } else {
        // notes/links: the default whole-book request is not valid on the route, so a whole book is an index item only.
        if (withBook) items.push({ sub: kind, item: indexItem(B), book: B, res, index: true, bare: B });
        for (const c of found?.chapters ?? []) {
          items.push({ sub: kind, item: `${B} ${c}`, book: B, chapter: c, res });
          if (withBook) items.push({ sub: kind, item: indexItem(`${B} ${c}`), book: B, chapter: c, res, index: true, bare: `${B} ${c}` });
        }
      }
    }
  }
  if (!items.length) {
    console.error(`${lang} ${kind}: no items to sweep; nothing written`);
    process.exit(2);
  }
  const empty = emptyResources(items, resources);
  if (empty.length && writeVerified) {
    console.error(`${lang} ${kind}: no items for ${empty.join(", ")}; nothing written`);
    process.exit(2);
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
  const cache = { dir: cacheDir, resume: flag("resume"), catalogKey: cats.key, maxAgeHours };
  const results = await pool(items, 4, async (it) => {
    const req = requestOf(it.sub, lang, it.index ? it.bare : it.item, { index: !!it.index });
    const body = await apiGet(api, req, cache);
    const attempt = await runAdapter(req.path, req.params);
    const used = kind === "passage" && attempt.hit ? keysFromVersions(attempt.value?.versions) : undefined;
    const r = { ...it, ...classifyItem(attempt, body), ...(used ? { used } : {}) };
    if (++done % 100 === 0) console.log(`${done}/${items.length}`);
    return r;
  });

  const swept = new Date().toISOString();
  const entries = {};
  const lines = [`# Sweep differences: ${lang} ${kind}`, "", `Swept ${swept}, API ${api}, catalog ${cats.key}.`, ""];
  const alignedKey = helps.ALIGNED_TEXT.get(lang);
  for (const r of resources) {
    const mine = resultsForResource(r.key, results);
    if (!mine.length) continue; // only a narrowed run gets here with none
    const key = sweepKey(lang, r.key, r.release, kind);
    const usedKeys = [...new Set(mine.flatMap((x) => x.used ?? []))];
    const skipped = skippedBooks.get(r.key);
    entries[key] = buildEntry(mine, swept, {
      deps: depsFor(kind, r.key, catList, { alignedKey, usedKeys }),
      ...coverageOf(items.filter((it) => it.res.includes(r.key))),
      ...(skipped ? { skippedBooks: skipped } : {}),
    });
    const bad = mine.filter((x) => x.status !== "equal");
    const by = {};
    for (const x of bad) {
      const why = x.status === "fallback" ? `fallback ${x.reason}` : x.status;
      by[why] = (by[why] ?? 0) + 1;
    }
    lines.push(`## ${key}`, "", `Items ${entries[key].items}, exceptions ${entries[key].exceptions.length}` +
      (bad.length ? ` (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(", ")})` : "") +
      (writeVerified ? "" : " (narrowed run: not written to verified.json)"), "");
    let listed = 0;
    for (const x of bad) {
      if (x.status === "not-in-answer") continue; // counted above, too many to list
      if (listed++ >= 200) {
        lines.push("- and more (see the counts above)");
        break;
      }
      if (x.status === "differs") {
        lines.push(`- ${x.item}: differs`);
        for (const d of x.diffs.slice(0, 3)) lines.push(`  - ${d.path}: today ${cellOf(d.a)} format 3 ${cellOf(d.b)}`);
        if (x.diffs.length > 3) lines.push(`  - and ${x.diffs.length - 3} more`);
      } else lines.push(`- ${x.item}: ${x.status === "fallback" ? `fallback (${x.reason})` : x.status}`);
    }
    lines.push("");
  }
  const vfile = join(outDir, "verified.json");
  const pfile = join(outDir, `sweep-partial-${lang}-${kind}.json`);
  if (writeVerified) {
    const existing = existsSync(vfile) ? JSON.parse(readFileSync(vfile, "utf8")) : {};
    writeFileSync(vfile, JSON.stringify(mergeVerified(existing, entries), null, 2) + "\n");
  } else {
    writeFileSync(pfile, JSON.stringify(entries, null, 2) + "\n");
  }
  const rfile = join(outDir, `verified-differences-${lang}-${kind}.md`);
  writeFileSync(rfile, lines.join("\n") + "\n");
  for (const [k, e] of Object.entries(entries)) console.log(`${k}: ${e.items} items, ${e.exceptions.length} exceptions`);
  console.log(
    writeVerified
      ? `wrote ${vfile} and ${rfile}`
      : `narrowed run (--books): verified.json NOT written; wrote ${pfile} and ${rfile}`,
  );
}

const self = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (self && pathToFileURL(self).href === import.meta.url) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
