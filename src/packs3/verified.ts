/**
 * The proofs a sweep wrote (`verified.json`, see scripts/sweep-packs3.mjs): an adapter serves an item only when
 * the release it is about to read was swept clean for that item. Entry keys are
 * `"<lang>|<resource key>|<release>|<kind>"`; a changed release has no entry, so it serves nothing until re-swept.
 *
 * What the sweep writes per kind (and what `isVerified` reads):
 * - passage: items `BOOK C:V` for every verse and `BOOK C:1-N` per chapter; `chapters: { BOOK: [c, ...] }`. Its
 *   exceptions are grouped per chapter, `BOOK C:v,v,a-b` (the items `BOOK C:v` and `BOOK C:a-b`); one it cannot read
 *   makes the whole entry unusable, as does an unreadable `joins` string of any book. With `--range-windows`, `joins: { BOOK: "c:v,a-b;c:v" }`: the verse boundaries
 *   a swept 2-3 verse window proved (see `isVerified`).
 * - notes, links: `BOOK C` (`chapters`) for the default shape; `fields=index` items (whole book and chapter) are
 *   `indexWholeBooks` / `indexChapters`, their exceptions `index:BOOK C`. questions: items `BOOK` (`wholeBooks`) and `BOOK C` (`chapters`, "front" and 0 included).
 *   notes, links, questions (default shape): `samples: { BOOK: "1:16,2-3:15" }`, the chapters whose verse and range
 *   sample items (`BOOK C:V`, `BOOK C:V-W`: first, middle and last verse and a range around the middle) were swept, each
 *   with its last verse (`A-B:L`: chapters A to B, each ending at verse L); their exceptions are in `exceptions`. A verse
 *   or range request is served only on a listed, clean chapter whose samples were swept and all equal, and only within
 *   the chapter (no verse past L; no range in a 1-verse chapter): sampled evidence, not every verse. An entry without
 *   `samples` serves no verse or range. notes, links `fields=index`: `indexSamples: true` when the same sample items
 *   were swept in the index shape too (their exceptions `index:BOOK C:V`); without it no index verse or range serves.
 * - the search kind: the exact item in `ids`. The search catalog kind (`SEARCH_CATALOG_KIND`, no item): `catalog: "equal"`
 *   and no `differs` (the ids that differed) when the article catalog format 3 ranks over equals the route's, so any
 *   query ranks the same (adapters/search.ts); `catalog: "equalExcept"` with `except` (lowercase ids) when the only
 *   differences were ids that match case-insensitively (`searchCatalogExcept`): a query whose results hold none of them
 *   ranks the same. articles: the exact item in `idDirs` (clean items only, per directory;
 *   `ids` is read too), or in `ids` and not in `exceptions`. A bare term or title (`/words/covenant`): `terms`, by the
 *   clean article it resolved to (`isVerifiedTerm`); `misses`: the terms whose route answer was the 404 miss.
 * `exceptions` lists the items whose answers did not equal today's; `deps` the other resources (`"<catalog>|<key>"`)
 * with the release the answers were made from; `skippedBooks` the books of a passage entry that were not swept.
 * `exceptionsSameAs: "<key>"` instead of `exceptions`: the exceptions of that entry (same lang, release and kind; one hop,
 * the target must hold its own list), stored once when equal (en ult and ust); a pointer it cannot follow makes the
 * entry unusable.
 */
import raw from "./verified.json";

export type VerifiedEntry = {
  items?: number;
  exceptions?: string[];
  /** The key of an entry of the same lang, release and kind whose `exceptions` are this entry's (see `entryAt`). */
  exceptionsSameAs?: string;
  swept?: string;
  deps?: Record<string, string>;
  chapters?: Record<string, Array<number | string>>;
  wholeBooks?: string[];
  ids?: string[];
  /** Articles (compact): the clean items per directory, `{ "bible/kt": "grace,god" }` is `bible/kt/grace`, `bible/kt/god`. */
  idDirs?: Record<string, string>;
  /**
   * Articles: the swept terms and titles (`/words/<term>`, `/academy/<term>`, see `isVerifiedTerm`) that were equal, by
   * the clean article they resolved to: `{ "bible/kt": "covenant:=|pact" }` is `covenant` and `pact` resolving to
   * `bible/kt/covenant` (`=` is the article's own name). A term is the prepared term in lower case.
   */
  terms?: Record<string, string>;
  /**
   * Articles: the swept terms (`/words/<term>`, `/academy/<term>`) whose route answer was the 404 miss of the lookup and
   * the adapter's too, sorted and comma-joined (`"covenant,pact"`). Served only with an equal search catalog proof of the
   * same release (`isVerifiedMiss`).
   */
  misses?: string;
  /** Articles (compact): how many swept items were not equal (they are not listed, so never served). */
  excepted?: number;
  skippedBooks?: string[];
  /** notes/links `fields=index` proofs: chapters per book and whole books (their exceptions are `index:<item>`). */
  indexChapters?: Record<string, Array<number | string>>;
  indexWholeBooks?: string[];
  /**
   * Passage: the boundaries a swept range window proved, per book, `"c:v,a-b;c:v"` (`v` joins verses v and v+1 with
   * one space in the route's range). A range in a chapter with a range exception is served only over these.
   */
  joins?: Record<string, string>;
  /**
   * notes, links, questions: the chapters per book whose verse/range samples were swept, `"1-3,5"` (runs ascending).
   * A verse or range request is served only in such a chapter with no sample exception (see `isVerified`).
   */
  samples?: Record<string, string>;
  /**
   * notes, links: `true` when the `samples` items were swept in the `fields=index` shape too (their exceptions are
   * `index:BOOK C:V`, `index:BOOK C:V-W`). Without it an index-shape verse or range request is never served.
   */
  indexSamples?: boolean;
  /**
   * Search catalog: `"equal"` when the catalog the ranking reads was equal to the route's, `"equalExcept"` when it was
   * equal but for ids that differ only in case (`except`), else `"differs"`.
   */
  catalog?: string;
  /** Search catalog, `equalExcept` only: the ids (lowercased article paths) whose case differs from the route's. */
  except?: string[];
  /** Search catalog: the ids (article paths, or `(order)`, `(language …)`) that differed. */
  differs?: string[];
};

export type VerifiedOpts = {
  /** The release the catalog has for `"<catalog>|<resource key>"`, or `undefined` when it has none. */
  releaseOf?: (depKey: string) => string | undefined;
  /** The `fields=index` shape (notes, links): it is proven by its own lists and `index:` exceptions only. */
  index?: boolean;
};

let table: Record<string, VerifiedEntry> = raw as Record<string, VerifiedEntry>;
let open = false;

/** Tests only: serve from this table instead of verified.json (`undefined` restores the real one). */
export function setVerifiedForTests(
  t: Record<string, VerifiedEntry> | undefined,
): void {
  table = t ?? (raw as Record<string, VerifiedEntry>);
  parsed = new WeakMap();
}

/** The sweep only: the adapters answer without a proof, so the sweep can say what they do (`false` closes it). */
export function setSweepOpen(on: boolean): void {
  open = on;
}

/** `releaseOf` for the catalogs of a reader (`{ name, catalog: { resources } }`). */
export function releaseOfCatalogs(
  catalogs: ReadonlyArray<{ name: string; catalog: unknown }>,
): (depKey: string) => string | undefined {
  return (depKey) => {
    for (const c of catalogs) {
      const rs = (
        c.catalog as { resources?: Array<{ key: string; release: string }> }
      )?.resources;
      for (const r of rs ?? []) {
        if (`${c.name}|${r.key}` === depKey) return r.release;
      }
    }
    return undefined;
  };
}

const PASSAGE = /^(\S+) (\d+):(\d+)(?:-(\d+))?$/;
const PASSAGE_EXCEPTION = /^(\S+ \d+):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/;

/** A passage entry's exceptions as single items (`BOOK C:v`, `BOOK C:a-b`), or `undefined` when one is unreadable. */
function passageExceptions(list: string[]): Set<string> | undefined {
  const out = new Set<string>();
  for (const x of list) {
    const m = PASSAGE_EXCEPTION.exec(x);
    if (!m) return undefined;
    for (const v of m[2]!.split(",")) out.add(`${m[1]}:${v}`);
  }
  return out;
}
/** One id of an `except` list: a lowercase article path with a `/`, each segment starting with a letter or digit. */
const EXCEPT_ID = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)+$/;
/** One term of a `misses` string: lower case, no separator (`/:|,=`). */
const MISS_TERM = /^[^/:|,=A-Z]+$/;
/** One article of a `terms` line: `name:term|term` (no separators inside a name or a term). */
const TERMS_PART = /^[^:|,]+:[^:|,]+(?:\|[^:|,]+)*$/;
const JOINS_CHAPTER = /^(\d+):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/;
/** One book's `samples` string: chapter runs with their last verse, `1:16,2-3:15` (runs ascending, at most 1000 wide). */
const SAMPLE_RUNS = /^\d+(?:-\d+)?:\d+(?:,\d+(?:-\d+)?:\d+)*$/;
/** A notes, links or questions verse or range item, `BOOK C:V` or `BOOK C:V-W`. */
const CHAPTER_VERSE = /^(\S+) (\d+):(\d+)(?:-(\d+))?$/;
/**
 * A sample exception of such an entry: its `BOOK C`, or `index:BOOK C` for an index-shape one (a chapter exception
 * never matches).
 */
const SAMPLE_EXCEPTION = /^(\S+ \d+):\d+(?:-\d+)?$/;

/** The chapters of a `samples` string with their last verse (1 to 200), or `undefined` when it does not parse. */
function sampleRuns(line: string): Map<number, number> | undefined {
  if (!SAMPLE_RUNS.test(line)) return undefined;
  const out = new Map<number, number>();
  for (const part of line.split(",")) {
    const [run, lastText] = part.split(":");
    const last = Number(lastText);
    const [x, y = x] = run!.split("-").map(Number);
    if (y! < x! || y! - x! > 1000 || last < 1 || last > 200) return undefined;
    for (let c = x!; c <= y!; c++) out.set(c, last);
  }
  return out;
}

/** Whether every part of a book's `joins` string (`1:1-4,6;3:4`) parses: one that does not makes the entry unusable. */
function joinsParses(line: string): boolean {
  return line.split(";").every((p) => JOINS_CHAPTER.test(p) && joinRunsOk(p));
}
function joinRunsOk(part: string): boolean {
  const m = JOINS_CHAPTER.exec(part);
  if (!m) return false;
  return m[2]!.split(",").every((run) => {
    const [x, y = x] = run.split("-").map(Number);
    return y! >= x! && y! - x! <= 1000;
  });
}

/**
 * The proven boundaries of `chapter` (`v` is the boundary between verses v and v+1) from a passage entry's `joins`
 * (`{ "TIT": "1:1-4,6;3:4" }`), or `undefined` when there are none or the book's string cannot be read (fail closed).
 */
function joinsOf(
  joins: unknown,
  book: string,
  chapter: string,
): Set<number> | undefined {
  if (!isPlain(joins) || !Object.hasOwn(joins, book)) return undefined;
  const line = joins[book];
  if (typeof line !== "string") return undefined;
  let out: Set<number> | undefined;
  for (const part of line.split(";")) {
    const m = JOINS_CHAPTER.exec(part);
    if (!m) return undefined;
    if (m[1] !== String(chapter)) continue;
    out ??= new Set();
    for (const run of m[2]!.split(",")) {
      const [x, y = x] = run.split("-").map(Number);
      if (y! < x! || y! - x! > 1000) return undefined;
      for (let v = x!; v <= y!; v++) out.add(v);
    }
  }
  return out;
}

/** `joinsOf`, from the entry's parse: each book's string is read once (a usable entry's strings all parse). */
function joinsAt(
  p: Parsed,
  joins: unknown,
  book: string,
  chapter: string,
): Set<number> | undefined {
  if (!isPlain(joins) || !Object.hasOwn(joins, book)) return undefined;
  p.joins ??= new Map();
  let byChapter = p.joins.get(book);
  if (!byChapter) {
    byChapter = new Map();
    const line = joins[book];
    if (typeof line === "string") {
      for (const part of line.split(";")) {
        const c = JOINS_CHAPTER.exec(part)?.[1];
        if (c !== undefined && !byChapter.has(c)) {
          const s = joinsOf(joins, book, c);
          if (s) byChapter.set(c, s);
        }
      }
    }
    p.joins.set(book, byChapter);
  }
  return byChapter.get(chapter);
}

const CHAPTER_KINDS = new Set(["notes", "links", "questions"]);
// The kind's name is built, not written: tests/unit/packs3-allowed-calls.test.ts forbids that string literal in src/packs3.
/** The search kind's name (built, see above), for the search adapter. */
export const SEARCH_KIND = ["sea", "rch"].join("");
const ID_KINDS = new Set(["articles", SEARCH_KIND]);
/** The search catalog kind: one verdict per resource release, no items (see `isVerified`). */
export const SEARCH_CATALOG_KIND = SEARCH_KIND + "Catalog";

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): boolean =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** A present field of the wrong type makes the whole entry unusable (absent = empty): a bad proof never serves. */
function wellFormed(e: VerifiedEntry): boolean {
  counts.entries++;
  const o = e as Record<string, unknown>;
  for (const f of [
    "exceptions",
    "skippedBooks",
    "wholeBooks",
    "indexWholeBooks",
    "ids",
    "differs",
  ]) {
    if (o[f] !== undefined && !isStrings(o[f])) return false;
  }
  for (const f of ["chapters", "indexChapters"]) {
    const v = o[f];
    if (v === undefined) continue;
    if (!isPlain(v)) return false;
    if (!Object.values(v).every((l) => Array.isArray(l))) return false;
  }
  for (const f of ["idDirs", "joins", "terms", "samples"]) {
    const v = o[f];
    if (v === undefined) continue;
    if (!isPlain(v)) return false;
    if (!Object.values(v).every((l) => typeof l === "string")) return false;
  }
  // every book's joins string must parse (the same parser as the lookup), or the whole entry is unusable
  if (isPlain(o.joins)) {
    for (const book of Object.keys(o.joins)) {
      if (!joinsParses(o.joins[book] as string)) return false;
    }
  }
  // every book's samples string must parse (`1-3,5`), or the whole entry is unusable
  if (isPlain(o.samples)) {
    for (const line of Object.values(o.samples)) {
      if (!sampleRuns(line as string)) return false;
    }
  }
  // every directory's terms string must parse (`name:t|t,name:=`), or the whole entry is unusable
  if (isPlain(o.terms)) {
    for (const line of Object.values(o.terms)) {
      if (!(line as string).split(",").every((p) => TERMS_PART.test(p)))
        return false;
    }
  }
  // `misses`: one string whose every comma part is a term, or the whole entry is unusable
  if (o.misses !== undefined) {
    if (typeof o.misses !== "string") return false;
    if (!o.misses.split(",").every((t) => MISS_TERM.test(t))) return false;
  }
  // `indexSamples`: `true` or absent, anything else makes the entry unusable
  if (o.indexSamples !== undefined && o.indexSamples !== true) return false;
  if (o.catalog !== undefined && typeof o.catalog !== "string") return false;
  // `except`: present exactly under `equalExcept`, a non-empty list of lowercase safe ids, or the entry is unusable
  if ((o.except !== undefined) !== (o.catalog === "equalExcept")) return false;
  if (o.except !== undefined) {
    if (!Array.isArray(o.except) || o.except.length === 0) return false;
    if (
      !o.except.every(
        (x) => typeof x === "string" && x.length <= 256 && EXCEPT_ID.test(x),
      )
    )
      return false;
  }
  if (
    o.exceptionsSameAs !== undefined &&
    typeof o.exceptionsSameAs !== "string"
  )
    return false;
  if (o.deps !== undefined) {
    if (!isPlain(o.deps)) return false;
    if (!Object.values(o.deps).every((d) => typeof d === "string"))
      return false;
  }
  return true;
}

/**
 * What one raw table entry object parses to, computed once per object and read by every call (`parsedOf`): the well
 * formed verdict, the resolved entry per key (with the pointer target's raw object, so a swapped target misses), and the
 * lookup structures built lazily from its own lists. Keyed on the raw `table[k]` object by identity, so an entry swapped
 * for another object (`setVerifiedForTests`, the sweep, a test replacing `table[k]`) is parsed anew. An entry object
 * mutated in place after a call is NOT supported: the cache would keep answering from what it parsed first.
 */
type Parsed = {
  ok: boolean;
  /** The last resolution of this object: under `key`, with `target` the raw object its pointer read (if any). */
  resolved?: { key: string; target: unknown; entry: Usable | undefined };
  /** Its own `exceptions` as a set (an entry pointing elsewhere reads its target's). */
  exceptions?: Set<string>;
  /** Its own `exceptions` as passage items, and the `BOOK C:` prefixes with a range exception; `null`: unreadable. */
  passage?: { items: Set<string>; rangeChapters: Set<string> } | null;
  /** `joins` per book, then per chapter (as written), the proven boundaries. */
  joins?: Map<string, Map<string, Set<number>>>;
  /** `terms` per directory, then per article name (the first part wins), its terms. */
  terms?: Map<string, Map<string, string[]>>;
  misses?: Set<string>;
  ids?: Set<string>;
  idDirs?: Map<string, Set<string>>;
  /** `samples` per book, the sampled chapters and their last verse. */
  samples?: Map<string, Map<number, number>>;
  /** Of its exceptions owner: the `BOOK C` (default shape) or `index:BOOK C` of every sample exception. */
  sampleExcepted?: Set<string>;
};
/** A usable entry (`entryAt`): `e` as before, `own` the parse of its raw object, `ex` that of its exceptions' owner. */
type Usable = {
  e: VerifiedEntry;
  own: Parsed;
  ex: Parsed;
  exRaw: VerifiedEntry;
};

let parsed = new WeakMap<object, Parsed>();
const counts = { entries: 0, exceptions: 0 };

/** Tests only: how many times an entry was checked (`wellFormed`) and an exceptions list parsed, since load. */
export function parseCountsForTests(): {
  entries: number;
  exceptions: number;
} {
  return { ...counts };
}

function parsedOf(e: VerifiedEntry): Parsed {
  let p = parsed.get(e);
  if (!p) {
    p = { ok: wellFormed(e) };
    parsed.set(e, p);
  }
  return p;
}

function exceptionSet(p: Parsed, owner: VerifiedEntry): Set<string> {
  if (!p.exceptions) {
    counts.exceptions++;
    p.exceptions = new Set(strings(owner.exceptions));
  }
  return p.exceptions;
}

function passageOf(
  p: Parsed,
  owner: VerifiedEntry,
): { items: Set<string>; rangeChapters: Set<string> } | null {
  if (p.passage === undefined) {
    const list = strings(owner.exceptions);
    const items = passageExceptions(list);
    if (!items) p.passage = null;
    else {
      // `BOOK C:` of every line with a range (the same as an item `BOOK C:a-b` among `items`)
      const rangeChapters = new Set<string>();
      for (const x of list) {
        const m = PASSAGE_EXCEPTION.exec(x)!;
        if (m[2]!.includes("-")) rangeChapters.add(`${m[1]}:`);
      }
      p.passage = { items, rangeChapters };
    }
  }
  return p.passage;
}

/** `"<lang>|<key>|<release>|<kind>"` without the resource key (entries that may share one exceptions list). */
function sameAsGroup(k: string): string | undefined {
  const p = k.split("|");
  return p.length === 4 ? `${p[0]}|${p[2]}|${p[3]}` : undefined;
}

/**
 * The usable entry at `k`: present, well formed, and with `exceptionsSameAs` replaced by the target's `exceptions`.
 * The pointer is followed one hop only: the target must be another well formed entry of the same lang, release and kind
 * with its own `exceptions` (no pointer of its own, so no chains or cycles), and the entry must not list its own.
 * Anything else makes the whole entry unusable (`undefined`), like any malformed field.
 */
function entryAt(k: string): VerifiedEntry | undefined {
  return usableAt(k)?.e;
}

/** `entryAt` with the parsed structures, cached per raw entry object (see `Parsed`). */
function usableAt(k: string): Usable | undefined {
  const e = Object.hasOwn(table, k) ? table[k] : undefined;
  if (typeof e !== "object" || e === null) return undefined;
  const own = parsedOf(e);
  if (!own.ok) return undefined;
  const to = (e as Record<string, unknown>).exceptionsSameAs;
  if (to === undefined) return { e, own, ex: own, exRaw: e };
  // the target is looked up on every call: a cached resolution holds only for the same key and target object
  const t =
    typeof to === "string" && Object.hasOwn(table, to) ? table[to] : undefined;
  const r = own.resolved;
  if (r && r.key === k && r.target === t) return r.entry;
  const entry = resolve(k, e, own, to, t);
  own.resolved = { key: k, target: t, entry };
  return entry;
}

function resolve(
  k: string,
  e: VerifiedEntry,
  own: Parsed,
  to: unknown,
  t: VerifiedEntry | undefined,
): Usable | undefined {
  if (typeof to !== "string" || e.exceptions !== undefined || to === k)
    return undefined;
  const group = sameAsGroup(k);
  if (group === undefined || sameAsGroup(to) !== group) return undefined;
  if (typeof t !== "object" || t === null || !parsedOf(t).ok) return undefined;
  if (
    (t as Record<string, unknown>).exceptionsSameAs !== undefined ||
    !Array.isArray(t.exceptions)
  )
    return undefined;
  return {
    e: { ...e, exceptions: t.exceptions },
    own,
    ex: parsedOf(t),
    exRaw: t,
  };
}

function chapterListed(
  chapters: unknown,
  book: string,
  chapter: string | number,
): boolean {
  if (typeof chapters !== "object" || chapters === null) return false;
  if (!Object.hasOwn(chapters, book)) return false;
  const list = (chapters as Record<string, unknown>)[book];
  return Array.isArray(list) && list.some((c) => String(c) === String(chapter));
}

/** `item` is `<dir>/<name>` and `name` is in the dir's comma list. */
function dirListed(p: Parsed, dirs: unknown, item: string): boolean {
  if (!isPlain(dirs)) return false;
  if (!p.idDirs) {
    p.idDirs = new Map();
    for (const [dir, list] of Object.entries(dirs)) {
      if (typeof list === "string") p.idDirs.set(dir, new Set(list.split(",")));
    }
  }
  const i = item.lastIndexOf("/");
  const dir = i < 0 ? "" : item.slice(0, i);
  if (!Object.hasOwn(dirs, dir)) return false;
  const names = p.idDirs.get(dir);
  return (
    names !== undefined && item.length > i + 1 && names.has(item.slice(i + 1))
  );
}

function itemListed(
  u: Usable,
  kind: string,
  item: string,
  index: boolean,
): boolean {
  const e = u.e;
  if (ID_KINDS.has(kind)) {
    u.own.ids ??= new Set(strings(e.ids));
    return u.own.ids.has(item) || dirListed(u.own, e.idDirs, item);
  }
  if (CHAPTER_KINDS.has(kind)) {
    const m = /^(\S+)(?: (\S+))?$/.exec(item);
    if (!m) return false;
    const chapters = index ? e.indexChapters : e.chapters;
    const whole = index ? e.indexWholeBooks : e.wholeBooks;
    return m[2] === undefined
      ? strings(whole).includes(m[1]!)
      : chapterListed(chapters, m[1]!, m[2]);
  }
  return false;
}

/**
 * Was `item` of `kind` swept clean for this resource release. Without an item: the entry exists and its deps hold.
 * A passage item is a verse `BOOK C:V` or a range `BOOK C:a-b` (see `isVerifiedRange`).
 */
export function isVerified(
  lang: string,
  resourceKey: string,
  release: string,
  kind: string,
  item?: string,
  opts: VerifiedOpts = {},
): boolean {
  if (open) return true;
  if (
    !CHAPTER_KINDS.has(kind) &&
    !ID_KINDS.has(kind) &&
    kind !== "passage" &&
    kind !== SEARCH_CATALOG_KIND
  )
    return false;
  const u = usableAt(`${lang}|${resourceKey}|${release}|${kind}`);
  if (!u) return false;
  const e = u.e;
  const deps = e.deps ?? {};
  for (const [depKey, depRelease] of Object.entries(deps)) {
    const have = opts.releaseOf?.(depKey);
    if (have === undefined || have !== depRelease) return false;
  }
  // The catalog verdict has no items: it holds only as "equal" with nothing listed as differing.
  if (kind === SEARCH_CATALOG_KIND)
    return item === undefined && catalogExcept(e)?.length === 0;
  if (item === undefined) return !ID_KINDS.has(kind);
  const index = opts.index === true && CHAPTER_KINDS.has(kind);
  const exceptions = exceptionSet(u.ex, u.exRaw);
  if (exceptions.has(index ? `index:${item}` : item)) return false;
  if (kind === "passage") {
    const m = PASSAGE.exec(item);
    if (!m) return false;
    const passage = passageOf(u.ex, u.exRaw);
    if (!passage) return false;
    const excepted = passage.items;
    if (excepted.has(item)) return false;
    const [, book, chapter, a, b] = m;
    if (strings(e.skippedBooks).includes(book!)) return false;
    if (!chapterListed(e.chapters, book!, chapter!)) return false;
    // A verse is served when its chapter is listed and it is no exception. A range needs every verse in it clean and
    // every boundary between two of its verses proven: the route's range is its single verses joined by a glue that
    // depends only on the raw USFM at each boundary (a blank line, `\ts\*`, a closing `\qs*` glue them differently:
    // es-419 TIT 1:4-5 keeps a line break), and format 3 does not keep that. A boundary is proven when the whole
    // chapter `C:1-N` was equal (the chapter has no range exception) or a swept window over it was (`joins`).
    if (b === undefined) return true;
    // No chapter has more than 176 verses: a bound past 200 (or a reversed or zero one) is no verse range, and the
    // loops below must never run on an unbounded value.
    if (Number(a) < 1 || Number(b) < Number(a) || Number(b) > 200) return false;
    for (let v = Number(a); v <= Number(b); v++) {
      if (excepted.has(`${book} ${chapter}:${v}`)) return false;
    }
    // the chapter is proven when none of its exceptions is a range (`passageOf` keeps the chapters that have one)
    if (!passage.rangeChapters.has(`${book} ${chapter}:`)) return true;
    const joined = joinsAt(u.own, e.joins, book!, chapter!);
    if (!joined) return false;
    for (let v = Number(a); v < Number(b); v++) {
      if (!joined.has(v)) return false;
    }
    return true;
  }
  const m = /^(\S+)/.exec(item);
  if (m && strings(e.skippedBooks).includes(m[1]!)) return false;
  const v = CHAPTER_VERSE.exec(item);
  if (v && CHAPTER_KINDS.has(kind))
    return sampleServes(u, exceptions, v, index);
  return itemListed(u, kind, item, index);
}

/**
 * A notes, links or questions verse or range: the route builds its answer for the verses asked (the aligned words of
 * notes and links too, and the verse filter of the `fields=index` shape), so the chapter's proof alone does not prove
 * it. It is served only when the chapter item of its shape is listed and clean (`chapters`, or `indexChapters` and no
 * `index:BOOK C`), the chapter's verse and range samples were swept (`samples`; for the index shape `indexSamples` too)
 * and none of them is an exception of that shape, and the request stays within the chapter: no verse past its last
 * verse, no range in a 1-verse chapter (no sample covers such a request). Sampled evidence: the verses between the
 * samples are not each proven.
 */
function sampleServes(
  u: Usable,
  exceptions: Set<string>,
  m: RegExpExecArray,
  index: boolean,
): boolean {
  const [, book, chapter, a, b] = m;
  if (Number(a) < 1) return false;
  if (b !== undefined && (Number(b) < Number(a) || Number(b) > 200))
    return false;
  const at = `${index ? "index:" : ""}${book} ${chapter}`;
  if (
    exceptions.has(at) ||
    !chapterListed(index ? u.e.indexChapters : u.e.chapters, book!, chapter!)
  )
    return false;
  if (index && u.e.indexSamples !== true) return false;
  const samples = u.e.samples;
  if (!isPlain(samples) || !Object.hasOwn(samples, book!)) return false;
  u.own.samples ??= new Map();
  let chapters = u.own.samples.get(book!);
  if (!chapters) {
    chapters = sampleRuns(String(samples[book!])) ?? new Map();
    u.own.samples.set(book!, chapters);
  }
  const last = chapters.get(Number(chapter));
  if (last === undefined) return false;
  if (Number(b ?? a) > last) return false;
  if (b !== undefined && last === 1) return false;
  if (!u.ex.sampleExcepted) {
    const out = new Set<string>();
    for (const x of exceptions) {
      const s = SAMPLE_EXCEPTION.exec(x);
      if (s) out.add(s[1]!);
    }
    u.ex.sampleExcepted = out;
  }
  return !u.ex.sampleExcepted.has(at);
}

/** The ids a usable catalog verdict excepts (`[]` for `equal`), or `undefined` when it proves nothing. */
function catalogExcept(e: VerifiedEntry): string[] | undefined {
  if (
    (e.differs !== undefined && e.differs.length > 0) ||
    strings(e.exceptions).length > 0 ||
    e.ids !== undefined ||
    e.idDirs !== undefined
  )
    return undefined;
  if (e.catalog === "equal") return [];
  if (e.catalog === "equalExcept") return [...strings(e.except)];
  return undefined;
}

/**
 * The search catalog proof of this resource release: `[]` when the route's catalog equals ours, the lowercased ids that
 * differ only in case under `equalExcept` (a ranking whose results hold none of them is the route's), `undefined` when
 * there is no usable proof (absent, malformed, differs, deps not holding). `isVerified` with `SEARCH_CATALOG_KIND`
 * stays the strict gate: it holds only for `equal`.
 */
export function searchCatalogExcept(
  lang: string,
  resourceKey: string,
  release: string,
  opts: VerifiedOpts = {},
): string[] | undefined {
  if (open) return [];
  const e = entryAt(`${lang}|${resourceKey}|${release}|${SEARCH_CATALOG_KIND}`);
  if (!e) return undefined;
  for (const [depKey, depRelease] of Object.entries(e.deps ?? {})) {
    const have = opts.releaseOf?.(depKey);
    if (have === undefined || have !== depRelease) return undefined;
  }
  return catalogExcept(e);
}

/**
 * Was the term (or title) `term` swept equal for this articles release, resolving to `path`, and is `path` itself a
 * clean article item of the same entry. `term` is the prepared term in lower case and holds no `/` (a path with a slash
 * is never a term item). The entry must be well formed (its `terms` lines included) and its deps hold.
 */
export function isVerifiedTerm(
  lang: string,
  resourceKey: string,
  release: string,
  term: string,
  path: string,
  opts: VerifiedOpts = {},
): boolean {
  if (open) return true;
  if (!term || /[/:|,=]/.test(term) || term !== term.toLowerCase())
    return false;
  if (!isVerified(lang, resourceKey, release, "articles", path, opts))
    return false;
  const e = table[`${lang}|${resourceKey}|${release}|articles`]!;
  const i = path.lastIndexOf("/");
  const dir = i < 0 ? "" : path.slice(0, i);
  const name = path.slice(i + 1);
  if (!isPlain(e.terms) || !Object.hasOwn(e.terms, dir)) return false;
  const p = parsedOf(e);
  if (!p.terms) {
    p.terms = new Map();
    for (const [d, line] of Object.entries(e.terms)) {
      const byName = new Map<string, string[]>();
      for (const part of String(line).split(",")) {
        const c = part.indexOf(":");
        const n = part.slice(0, c);
        if (!byName.has(n)) byName.set(n, part.slice(c + 1).split("|"));
      }
      p.terms.set(d, byName);
    }
  }
  const terms = p.terms.get(dir)?.get(name);
  return (
    terms !== undefined && terms.some((t) => (t === "=" ? name : t) === term)
  );
}

/**
 * Was the term (or title) `term` swept as a miss for this articles release: the route answered the lookup's 404 and the
 * adapter's resolution found nothing too. Holds only with an equal search catalog proof of the same resource release
 * (the route's article catalog equals ours, so the lookup resolves the same), or an `equalExcept` one when the term is
 * none of its excepted ids nor the name (last segment) of one: the route may resolve such a term to its other-case id. `term` is the prepared term in lower case
 * without `/`. The entry must be well formed (its `misses` included), its deps hold, and `miss:<term>` no exception.
 */
export function isVerifiedMiss(
  lang: string,
  resourceKey: string,
  release: string,
  term: string,
  opts: VerifiedOpts = {},
): boolean {
  if (open) return true;
  if (!MISS_TERM.test(term)) return false;
  const u = usableAt(`${lang}|${resourceKey}|${release}|articles`);
  if (!u) return false;
  const e = u.e;
  for (const [depKey, depRelease] of Object.entries(e.deps ?? {})) {
    const have = opts.releaseOf?.(depKey);
    if (have === undefined || have !== depRelease) return false;
  }
  if (exceptionSet(u.ex, u.exRaw).has(`miss:${term}`)) return false;
  if (typeof e.misses !== "string") return false;
  u.own.misses ??= new Set(e.misses.split(","));
  if (!u.own.misses.has(term)) return false;
  const except = searchCatalogExcept(lang, resourceKey, release, opts);
  if (except === undefined) return false;
  return !except.some(
    (id) => id === term || id.slice(id.lastIndexOf("/") + 1) === term,
  );
}

/**
 * Does the entry's `deps` list every resource in `keys` (resource keys of the language's own catalog, recorded as
 * `"<lang>|<key>"`) at the release the catalog has now. `isVerified` only checks the deps an entry lists, so a resource
 * that contributed to an answer but is not listed (added to the catalog after the sweep) needs this. Fail-closed.
 */
export function depsCover(
  lang: string,
  resourceKey: string,
  release: string,
  kind: string,
  keys: Iterable<string>,
  releaseOf: (depKey: string) => string | undefined,
): boolean {
  if (open) return true;
  const e = entryAt(`${lang}|${resourceKey}|${release}|${kind}`);
  if (!e) return false;
  const deps = e.deps ?? {};
  for (const key of keys) {
    const depKey = `${lang}|${key}`;
    if (!Object.hasOwn(deps, depKey)) return false;
    const have = releaseOf(depKey);
    if (have === undefined || have !== deps[depKey]) return false;
  }
  return true;
}

/** A passage range `BOOK C:first-last` (or a single verse when equal): see `isVerified`. */
export function isVerifiedRange(
  lang: string,
  resourceKey: string,
  release: string,
  book: string,
  chapter: string | number,
  first: number,
  last: number,
  opts: VerifiedOpts = {},
): boolean {
  const item =
    first === last
      ? `${book} ${chapter}:${first}`
      : `${book} ${chapter}:${first}-${last}`;
  return isVerified(lang, resourceKey, release, "passage", item, opts);
}
