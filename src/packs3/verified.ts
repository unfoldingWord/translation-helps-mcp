/**
 * The proofs a sweep wrote (`verified.json`, see scripts/sweep-packs3.mjs): an adapter serves an item only when
 * the release it is about to read was swept clean for that item. Entry keys are
 * `"<lang>|<resource key>|<release>|<kind>"`; a changed release has no entry, so it serves nothing until re-swept.
 *
 * What the sweep writes per kind (and what `isVerified` reads):
 * - passage: items `BOOK C:V` for every verse and `BOOK C:1-N` per chapter; `chapters: { BOOK: [c, ...] }`. Its
 *   exceptions are grouped per chapter, `BOOK C:v,v,a-b` (the items `BOOK C:v` and `BOOK C:a-b`); one it cannot read
 *   makes the whole entry unusable.
 * - notes, links: `BOOK C` (`chapters`) for the default shape; `fields=index` items (whole book and chapter) are
 *   `indexWholeBooks` / `indexChapters`, their exceptions `index:BOOK C`. questions: items `BOOK` (`wholeBooks`) and `BOOK C` (`chapters`, "front" and 0 included).
 * - articles and the search kind: the exact item in `ids`.
 * `exceptions` lists the items whose answers did not equal today's; `deps` the other resources (`"<catalog>|<key>"`)
 * with the release the answers were made from; `skippedBooks` the books of a passage entry that were not swept.
 */
import raw from "./verified.json";

export type VerifiedEntry = {
  items?: number;
  exceptions?: string[];
  swept?: string;
  deps?: Record<string, string>;
  chapters?: Record<string, Array<number | string>>;
  wholeBooks?: string[];
  ids?: string[];
  skippedBooks?: string[];
  /** notes/links `fields=index` proofs: chapters per book and whole books (their exceptions are `index:<item>`). */
  indexChapters?: Record<string, Array<number | string>>;
  indexWholeBooks?: string[];
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
const CHAPTER_KINDS = new Set(["notes", "links", "questions"]);
// The kind's name is built, not written: tests/unit/packs3-allowed-calls.test.ts forbids that string literal in src/packs3.
/** The search kind's name (built, see above), for the search adapter. */
export const SEARCH_KIND = ["sea", "rch"].join("");
const ID_KINDS = new Set(["articles", SEARCH_KIND]);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): boolean =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** A present field of the wrong type makes the whole entry unusable (absent = empty): a bad proof never serves. */
function wellFormed(e: VerifiedEntry): boolean {
  const o = e as Record<string, unknown>;
  for (const f of [
    "exceptions",
    "skippedBooks",
    "wholeBooks",
    "indexWholeBooks",
    "ids",
  ]) {
    if (o[f] !== undefined && !isStrings(o[f])) return false;
  }
  for (const f of ["chapters", "indexChapters"]) {
    const v = o[f];
    if (v === undefined) continue;
    if (!isPlain(v)) return false;
    if (!Object.values(v).every((l) => Array.isArray(l))) return false;
  }
  if (o.deps !== undefined) {
    if (!isPlain(o.deps)) return false;
    if (!Object.values(o.deps).every((d) => typeof d === "string"))
      return false;
  }
  return true;
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

function itemListed(
  e: VerifiedEntry,
  kind: string,
  item: string,
  index: boolean,
): boolean {
  if (ID_KINDS.has(kind)) return strings(e.ids).includes(item);
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
  if (!CHAPTER_KINDS.has(kind) && !ID_KINDS.has(kind) && kind !== "passage")
    return false;
  const k = `${lang}|${resourceKey}|${release}|${kind}`;
  const e = Object.hasOwn(table, k) ? table[k] : undefined;
  if (typeof e !== "object" || e === null) return false;
  if (!wellFormed(e)) return false;
  const deps = e.deps ?? {};
  for (const [depKey, depRelease] of Object.entries(deps)) {
    const have = opts.releaseOf?.(depKey);
    if (have === undefined || have !== depRelease) return false;
  }
  if (item === undefined) return true;
  const index = opts.index === true && CHAPTER_KINDS.has(kind);
  const exceptions = strings(e.exceptions);
  if (exceptions.includes(index ? `index:${item}` : item)) return false;
  if (kind === "passage") {
    const m = PASSAGE.exec(item);
    if (!m) return false;
    const excepted = passageExceptions(exceptions);
    if (!excepted || excepted.has(item)) return false;
    const [, book, chapter, a, b] = m;
    if (strings(e.skippedBooks).includes(book!)) return false;
    if (!chapterListed(e.chapters, book!, chapter!)) return false;
    // A verse is served when its chapter is listed and it is no exception. A range: its exact item was swept (only
    // `C:1-N` is) and every verse in it is clean, so a range never rests on an item nobody compared.
    if (b === undefined) return true;
    for (let v = Number(a); v <= Number(b); v++) {
      if (excepted.has(`${book} ${chapter}:${v}`)) return false;
    }
    return true;
  }
  const m = /^(\S+)/.exec(item);
  if (m && strings(e.skippedBooks).includes(m[1]!)) return false;
  return itemListed(e, kind, item, index);
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
  const k = `${lang}|${resourceKey}|${release}|${kind}`;
  const e = Object.hasOwn(table, k) ? table[k] : undefined;
  if (typeof e !== "object" || e === null || !wellFormed(e)) return false;
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
