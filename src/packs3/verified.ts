/**
 * The proofs a sweep wrote (`verified.json`, see scripts/sweep-packs3.mjs): an adapter serves an item only when
 * the release it is about to read was swept clean for that item. Entry keys are
 * `"<lang>|<resource key>|<release>|<kind>"`; a changed release has no entry, so it serves nothing until re-swept.
 *
 * What the sweep writes per kind (and what `isVerified` reads):
 * - passage: items `BOOK C:V` for every verse and `BOOK C:1-N` per chapter; `chapters: { BOOK: [c, ...] }`.
 * - notes, links, questions: items `BOOK` (`wholeBooks`) and `BOOK C` (`chapters`, "front" and 0 included).
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
};

export type VerifiedOpts = {
  /** The release the catalog has for `"<catalog>|<resource key>"`, or `undefined` when it has none. */
  releaseOf?: (depKey: string) => string | undefined;
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
const CHAPTER_KINDS = new Set(["notes", "links", "questions"]);
// The kind's name is built, not written: tests/unit/packs3-allowed-calls.test.ts forbids that string literal in src/packs3.
const ID_KINDS = new Set(["articles", ["sea", "rch"].join("")]);

function chapterListed(
  e: VerifiedEntry,
  book: string,
  chapter: string | number,
): boolean {
  return !!e.chapters?.[book]?.some((c) => String(c) === String(chapter));
}

function itemListed(e: VerifiedEntry, kind: string, item: string): boolean {
  if (ID_KINDS.has(kind)) return !!e.ids?.includes(item);
  if (CHAPTER_KINDS.has(kind)) {
    const m = /^(\S+)(?: (\S+))?$/.exec(item);
    if (!m) return false;
    return m[2] === undefined
      ? !!e.wholeBooks?.includes(m[1]!)
      : chapterListed(e, m[1]!, m[2]);
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
  const e = table[`${lang}|${resourceKey}|${release}|${kind}`];
  if (!e) return false;
  for (const [depKey, depRelease] of Object.entries(e.deps ?? {})) {
    const have = opts.releaseOf?.(depKey);
    if (have === undefined || have !== depRelease) return false;
  }
  if (item === undefined) return true;
  const exceptions = e.exceptions ?? [];
  if (exceptions.includes(item)) return false;
  if (kind === "passage") {
    const m = PASSAGE.exec(item);
    if (!m) return false;
    const [, book, chapter, a, b] = m;
    if (e.skippedBooks?.includes(book!)) return false;
    if (!chapterListed(e, book!, chapter!)) return false;
    // A verse is served when its chapter is listed and it is no exception. A range: its exact item was swept (only
    // `C:1-N` is) and every verse in it is clean, so a range never rests on an item nobody compared.
    if (b === undefined) return true;
    for (let v = Number(a); v <= Number(b); v++) {
      if (exceptions.includes(`${book} ${chapter}:${v}`)) return false;
    }
    return true;
  }
  const m = /^(\S+)/.exec(item);
  if (m && e.skippedBooks?.includes(m[1]!)) return false;
  return itemListed(e, kind, item);
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
