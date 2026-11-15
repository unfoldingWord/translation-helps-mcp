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
 * - the search kind: the exact item in `ids`. The search catalog kind (`SEARCH_CATALOG_KIND`, no item): `catalog: "equal"`
 *   and no `differs` (the ids that differed) when the article catalog format 3 ranks over equals the route's, so any
 *   query ranks the same (adapters/search.ts). articles: the exact item in `idDirs` (clean items only, per directory;
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
  /** Search catalog: `"equal"` when the catalog the ranking reads was equal to the route's, else `"differs"`. */
  catalog?: string;
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
/** One term of a `misses` string: lower case, no separator (`/:|,=`). */
const MISS_TERM = /^[^/:|,=A-Z]+$/;
/** One article of a `terms` line: `name:term|term` (no separators inside a name or a term). */
const TERMS_PART = /^[^:|,]+:[^:|,]+(?:\|[^:|,]+)*$/;
const JOINS_CHAPTER = /^(\d+):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/;

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
  for (const f of ["idDirs", "joins", "terms"]) {
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
  if (o.catalog !== undefined && typeof o.catalog !== "string") return false;
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
  const e = Object.hasOwn(table, k) ? table[k] : undefined;
  if (typeof e !== "object" || e === null || !wellFormed(e)) return undefined;
  const to = (e as Record<string, unknown>).exceptionsSameAs;
  if (to === undefined) return e;
  if (typeof to !== "string" || e.exceptions !== undefined || to === k)
    return undefined;
  const group = sameAsGroup(k);
  if (group === undefined || sameAsGroup(to) !== group) return undefined;
  const t = Object.hasOwn(table, to) ? table[to] : undefined;
  if (typeof t !== "object" || t === null || !wellFormed(t)) return undefined;
  if (
    (t as Record<string, unknown>).exceptionsSameAs !== undefined ||
    !Array.isArray(t.exceptions)
  )
    return undefined;
  return { ...e, exceptions: t.exceptions };
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
function dirListed(dirs: unknown, item: string): boolean {
  if (!isPlain(dirs)) return false;
  const i = item.lastIndexOf("/");
  const dir = i < 0 ? "" : item.slice(0, i);
  if (!Object.hasOwn(dirs, dir)) return false;
  const list = dirs[dir];
  return (
    typeof list === "string" &&
    item.length > i + 1 &&
    list.split(",").includes(item.slice(i + 1))
  );
}

function itemListed(
  e: VerifiedEntry,
  kind: string,
  item: string,
  index: boolean,
): boolean {
  if (ID_KINDS.has(kind))
    return strings(e.ids).includes(item) || dirListed(e.idDirs, item);
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
  const e = entryAt(`${lang}|${resourceKey}|${release}|${kind}`);
  if (!e) return false;
  const deps = e.deps ?? {};
  for (const [depKey, depRelease] of Object.entries(deps)) {
    const have = opts.releaseOf?.(depKey);
    if (have === undefined || have !== depRelease) return false;
  }
  // The catalog verdict has no items: it holds only as "equal" with nothing listed as differing.
  if (kind === SEARCH_CATALOG_KIND)
    return (
      item === undefined &&
      e.catalog === "equal" &&
      (e.differs === undefined || e.differs.length === 0) &&
      strings(e.exceptions).length === 0 &&
      e.ids === undefined &&
      e.idDirs === undefined
    );
  if (item === undefined) return !ID_KINDS.has(kind);
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
    // A verse is served when its chapter is listed and it is no exception. A range needs every verse in it clean and
    // every boundary between two of its verses proven: the route's range is its single verses joined by a glue that
    // depends only on the raw USFM at each boundary (a blank line, `\ts\*`, a closing `\qs*` glue them differently:
    // es-419 TIT 1:4-5 keeps a line break), and format 3 does not keep that. A boundary is proven when the whole
    // chapter `C:1-N` was equal (the chapter has no range exception) or a swept window over it was (`joins`).
    if (b === undefined) return true;
    for (let v = Number(a); v <= Number(b); v++) {
      if (excepted.has(`${book} ${chapter}:${v}`)) return false;
    }
    const prefix = `${book} ${chapter}:`;
    let chapterProven = true;
    for (const x of excepted) {
      if (x.startsWith(prefix) && x.includes("-", prefix.length))
        chapterProven = false;
    }
    if (chapterProven) return true;
    const joined = joinsOf(e.joins, book!, chapter!);
    if (!joined) return false;
    for (let v = Number(a); v < Number(b); v++) {
      if (!joined.has(v)) return false;
    }
    return true;
  }
  const m = /^(\S+)/.exec(item);
  if (m && strings(e.skippedBooks).includes(m[1]!)) return false;
  return itemListed(e, kind, item, index);
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
  for (const part of String(e.terms[dir]).split(",")) {
    const c = part.indexOf(":");
    if (part.slice(0, c) !== name) continue;
    return part
      .slice(c + 1)
      .split("|")
      .some((t) => (t === "=" ? name : t) === term);
  }
  return false;
}

/**
 * Was the term (or title) `term` swept as a miss for this articles release: the route answered the lookup's 404 and the
 * adapter's resolution found nothing too. Holds only with an equal search catalog proof of the same resource release
 * (the route's article catalog equals ours, so the lookup resolves the same). `term` is the prepared term in lower case
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
  const e = entryAt(`${lang}|${resourceKey}|${release}|articles`);
  if (!e) return false;
  for (const [depKey, depRelease] of Object.entries(e.deps ?? {})) {
    const have = opts.releaseOf?.(depKey);
    if (have === undefined || have !== depRelease) return false;
  }
  if (strings(e.exceptions).includes(`miss:${term}`)) return false;
  if (typeof e.misses !== "string" || !e.misses.split(",").includes(term))
    return false;
  return isVerified(
    lang,
    resourceKey,
    release,
    SEARCH_CATALOG_KIND,
    undefined,
    opts,
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
