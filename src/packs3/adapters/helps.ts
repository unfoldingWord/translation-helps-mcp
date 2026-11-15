/**
 * `/api/v1/notes` and `/api/v1/word-links` from format 3 books. Like the scripture adapter, it answers only what the
 * routes would answer the same way and gives `undefined` for the rest (see the gaps in the Task 6 report):
 *
 * - Format 3 rewrites a note body's links as ids (`ref:tit 1:5`, `[[ta:…]]`, `[[tw:…]]`); `restoreLinks` gives them
 *   back in the form the en and es-419 notes use (`../01/05.md`, `rc:` links with the `*` language). Another form could have been
 *   written: the sweep proves each chapter, and a body with a form it cannot rebuild is not returned.
 * - The aligned words (`gatewayQuote.aligned`) of notes and word links, every book, come from the route's own quote
 *   matcher over the verse's words and alignment. Where the route answers otherwise, the sweep keeps the chapter as an
 *   exception.
 * - Only the resources of the tables below, checked against the route's live answers (2026-11-12), are answered.
 */
import {
  formatQuoteDisplay,
  isCanonicalUsfmBook,
  QuoteMatcher,
  verseOverlapsQueryRange,
} from "@translation-helps/door43";
import { joinAlignedTokens } from "../../api/routes/alignmentHelper";
import type { PackReader } from "../../../vendor/language-pack-client/index.js";
import { resolveNotesQuery } from "../../api/routes/helpers";
import { markdownHeading } from "../../api/routes/notes";
import {
  PACK_VIEWS_SCHEMA,
  sourceFromPackView,
  VARIANTS,
} from "../../api/routes/packViews";
import type { Packs3Env } from "../catalogs";
import { warnOnce } from "../keys";
import { withReader, type SizeProbe } from "../readers";
import type { Packs3Params } from "../answer";
import { depsCover, isVerified, releaseOfCatalogs } from "../verified";
import { bookBytes } from "./scripture";

/**
 * The route's `supportReference` of a row with no article link in format 3 is "" only if the builder did not drop an
 * unresolved reference (it keeps no trace of one). What can be shown from the data: the row has only the known columns
 * (an extra one could be a reference) and its body has no text that looks like a reference to an article. That is a
 * test, not a proof: see Gaps in the Task 6 report.
 */
const KNOWN_COLS = new Set(["note", "tags", "quote", "isIntro", "occurrence"]);
const REFERENCE_LIKE =
  /rc:\/\/|\[\[|ta\/man|(translate|checking|process|intro)\/[a-z0-9-]+|(figs|grammar|writing|translate|guidelines|bible|kt|names|other)-[a-z]{3,}/i;
export function proofOfNoLink(cols: Cols): boolean {
  if (Object.keys(cols).some((k) => !KNOWN_COLS.has(k))) return false;
  if (cols.tags !== undefined && cols.tags !== "") return false;
  // A body link format 3 rewrote (`[[tw:kt/lord]]`, `](ref:…)`) is part of the text, not a dropped reference.
  return (
    typeof cols.note === "string" &&
    !REFERENCE_LIKE.test(cols.note.replace(REWRITTEN_G, ""))
  );
}

/** Whether the route would answer this chapter from v1 views (same bucket, same keys), which have another shape. */
async function viewsExist(
  env: Packs3Env,
  q: Query,
  language: string,
  kind: "notes" | "links",
): Promise<boolean> {
  if (q.indexMode || !Number.isInteger(Number(q.chapter))) return false;
  const code = language.toLowerCase();
  for (const lang of [code, ...(VARIANTS[code] ?? [])]) {
    const object = await env.LANGUAGE_PACKS?.get(
      `v1/${lang}/${kind === "notes" ? "notes" : "word-links"}/${q.book.toUpperCase()}/${Number(q.chapter)}.json`,
    );
    if (!object) continue;
    const view = (await object.json()) as { schema?: number } | null;
    if (view && view.schema === PACK_VIEWS_SCHEMA) return true;
  }
  return false;
}

/** The text whose alignment the route uses for `gatewayQuote.aligned`, by language. */
export const ALIGNED_TEXT = new Map([
  ["en", "unfoldingWord/en/ult"],
  ["es-419", "es-419_gl/es-419/glt"],
]);

type Cols = Record<string, unknown>;
type HelpRow = {
  id: string;
  ref: string;
  from: number;
  to: number;
  cols: Cols;
  quote?: unknown[];
};
type Table = { res?: string; rows?: HelpRow[] };
type Piece = [string, boolean];
type Event = [number, string, string];
type TextUnit = {
  res?: string;
  pieces?: Piece[];
  events?: Event[];
  align?: number[][];
};
type Resource = { key: string; subject: string; release: string };

export type HelpsParams = {
  reference: string;
  language: string;
  fields?: string;
};

type Query = {
  reference: string;
  book: string;
  chapter: string;
  verseStart?: string;
  verseEnd?: string;
  indexMode: boolean;
};

/** The proof item of a verse or range request: `BOOK C:V`, or `BOOK C:V-W` when the end differs. */
export function verseItem(
  book: string,
  chapter: string,
  verseStart: string,
  verseEnd?: string,
): string {
  const at = `${book.toUpperCase()} ${chapter}:${verseStart}`;
  return verseEnd && verseEnd !== verseStart ? `${at}-${verseEnd}` : at;
}

function queryOf(params: HelpsParams): Query | undefined {
  try {
    const url = new URL("https://packs3.invalid/api/v1/notes");
    url.searchParams.set("reference", params.reference);
    url.searchParams.set("language", params.language);
    if (params.fields !== undefined)
      url.searchParams.set("fields", params.fields);
    const q = resolveNotesQuery(url);
    // A range across chapters stays with the route.
    if (q.endChapter) return undefined;
    if (!isCanonicalUsfmBook(q.book)) return undefined;
    return {
      reference: q.reference,
      book: q.book,
      chapter: q.chapter,
      verseStart: q.verseStart,
      verseEnd: q.verseEnd,
      indexMode: q.indexMode,
    };
  } catch {
    return undefined;
  }
}

export type Placed = {
  row: HelpRow;
  /** The builder could not place some words of the quote (`quoteMissing`): its aligned words are not the route's. */
  quoteMissing?: boolean;
  chapter: string;
  verse: string;
  kind: "front" | "chapter" | "verse";
  /** The article the row points to (`ta:translate/figs-metaphor`, `tw:kt/god`), if any. */
  link?: string | undefined;
  /** The reference is not a single `c:v` or `c:a-b` (en PSA `5:1,3,8,12`): its chapter and the whole book give no answer. */
  unplaced?: boolean;
};

/**
 * The article a row points to. The reader guard forbids the name of that row field in this folder (it is also the name
 * of a reader method), so it is read as the one field of the row besides the known ones.
 */
function linkOf(row: HelpRow): string | undefined | null {
  const { id, ref, from, to, cols, quote, quoteMissing, ...rest } =
    row as HelpRow & { quoteMissing?: unknown };
  void [id, ref, from, to, cols, quote, quoteMissing];
  const values = Object.values(rest);
  if (values.length === 0) return undefined;
  // More than one extra field, or one that is not text: it cannot be told which is the link.
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

const REF = /^(\d+):(\d+)(?:-(\d+))?$/;

/** A row's chapter and verse text, or `undefined` when its reference is not a single canonical `c:v` or `c:a-b`. */
export function refOf(
  row: HelpRow,
): { chapter: string; verse: string } | undefined {
  const m = REF.exec(row.ref);
  if (!m) return undefined;
  const first = Number(m[2]);
  const last = m[3] === undefined ? first : Number(m[3]);
  if (
    !Number.isInteger(row.from) ||
    !Number.isInteger(row.to) ||
    Math.floor(row.from / 1000) % 1000 !== Number(m[1]) ||
    row.from % 1000 !== first ||
    row.to % 1000 !== last
  )
    return undefined;
  return { chapter: m[1], verse: row.ref.slice(m[1].length + 1) };
}

/**
 * The route's rows of the TSV: the book introduction (`front:intro`) and the chapter introductions are kept in format 3
 * as rows flagged `isIntro` at `c:1`. The book introduction is the first flagged row of chapter 1 and the first row of
 * the book (a book such as 3JN has no chapter introduction, so one flagged row there is the book's); the sweep proves it.
 */
export function placeNotes(rows: HelpRow[]): Placed[] | undefined {
  const missing = (row: HelpRow) =>
    (row as { quoteMissing?: unknown }).quoteMissing !== undefined;
  const placed: Placed[] = [];
  const introsOf = new Map<string, number>();
  for (const [i, row] of rows.entries()) {
    const at = refOf(row);
    if (linkOf(row) === null) return undefined;
    if (row.cols.supportReference !== undefined) return undefined;
    if (!at) {
      // Only that row's chapter is unanswerable, when its verse numbers name one chapter.
      const chapter = Math.floor(row.from / 1000) % 1000;
      if (
        !Number.isInteger(row.from) ||
        !Number.isInteger(row.to) ||
        Math.floor(row.to / 1000) % 1000 !== chapter ||
        !row.ref.startsWith(`${chapter}:`)
      )
        return undefined;
      placed.push({
        row,
        chapter: String(chapter),
        verse: row.ref.slice(String(chapter).length + 1),
        kind: "verse",
        link: linkOf(row) ?? undefined,
        quoteMissing: missing(row),
        unplaced: true,
      });
      continue;
    }
    if (row.cols.isIntro === true) {
      if (row.ref !== `${at.chapter}:1`) return undefined;
      const n = (introsOf.get(at.chapter) ?? 0) + 1;
      introsOf.set(at.chapter, n);
      if (at.chapter === "1" && n === 1) {
        if (i !== 0) return undefined;
        placed.push({
          row,
          chapter: "front",
          verse: "intro",
          kind: "front",
          link: linkOf(row) ?? undefined,
          quoteMissing: missing(row),
        });
      } else {
        // A chapter may have several (en ZEC 6: "Introduction" and "General Notes"); the route lists each as `c:intro`.
        placed.push({
          row,
          chapter: at.chapter,
          verse: "intro",
          kind: "chapter",
          link: linkOf(row) ?? undefined,
          quoteMissing: missing(row),
        });
      }
    } else if (row.cols.isIntro === false || row.cols.isIntro === undefined) {
      placed.push({
        row,
        chapter: at.chapter,
        verse: at.verse,
        kind: "verse",
        link: linkOf(row) ?? undefined,
        quoteMissing: missing(row),
      });
    } else return undefined;
  }
  return placed;
}

/**
 * A `c:front` row (en Psalms superscriptions in word links): format 3 keeps it at verse 0 of its chapter. The route lists
 * it as verse "front" (in its chapter and the whole book, never in a verse query; its aligned words are "").
 */
function frontOf(row: HelpRow): { chapter: string; verse: string } | undefined {
  const m = /^(\d+):front$/.exec(row.ref);
  if (
    !m ||
    !Number.isInteger(row.from) ||
    row.to !== row.from ||
    row.from % 1000 !== 0 ||
    Math.floor(row.from / 1000) % 1000 !== Number(m[1])
  )
    return undefined;
  return { chapter: m[1], verse: "front" };
}

export function placeLinks(rows: HelpRow[]): Placed[] | undefined {
  const placed: Placed[] = [];
  for (const row of rows) {
    const at = refOf(row) ?? frontOf(row);
    if (!at || linkOf(row) === null) return undefined;
    if (row.cols.isIntro === true || row.cols.twLink !== undefined)
      return undefined;
    placed.push({
      row,
      chapter: at.chapter,
      verse: at.verse,
      kind: "verse",
      link: linkOf(row) ?? undefined,
    });
  }
  return placed;
}

/**
 * The rows of a query, or `undefined` when one of them is `unplaced` (a whole-book query, or a query in its chapter:
 * its place among the verses is not known).
 */
export function chosenRows(
  placed: Placed[],
  q: Pick<Query, "chapter" | "verseStart" | "verseEnd">,
  notes: boolean,
): Placed[] | undefined {
  if (
    placed.some(
      (p) => p.unplaced && (q.chapter === "*" || p.chapter === q.chapter),
    )
  )
    return undefined;
  return placed.filter((p) => inQuery(p, q, notes));
}

/** The route's `parseTranslationNotesTsv` filter, in the order of the TSV. */
function inQuery(
  p: Placed,
  q: Pick<Query, "chapter" | "verseStart" | "verseEnd">,
  notes: boolean,
): boolean {
  if (q.chapter === "*") return true;
  if (notes && p.kind === "front") return true;
  if (p.chapter !== q.chapter) return false;
  if (p.kind === "chapter") return true;
  if (!q.verseStart) return true;
  return verseOverlapsQueryRange(p.verse, q.verseStart, q.verseEnd);
}

type Titles = Map<string, string> & { resources?: Set<string> };

/**
 * Titles of the articles the concepts point to, from the groups they belong to, or `undefined` when one is missing.
 * `resources` is every article resource a used title came from (it must be proven, see `prepare`).
 */
async function titlesOf(
  reader: PackReader,
  concepts: string[],
): Promise<Titles | undefined> {
  const titles: Titles = new Map();
  const used = new Set(concepts);
  const resources = new Set<string>();
  titles.resources = resources;
  const groups = new Set(concepts.map((c) => c.slice(0, c.lastIndexOf("/"))));
  for (const group of groups) {
    const articles = (await reader.articles(group)) as
      | Array<{ id?: string; res?: string; title?: unknown }>
      | undefined;
    if (!articles) return undefined;
    for (const a of articles) {
      if (typeof a.id !== "string") continue;
      if (typeof a.title === "string" && a.title) {
        if (used.has(a.id)) {
          if (typeof a.res !== "string") return undefined;
          resources.add(a.res);
        }
        titles.set(a.id, a.title);
      }
    }
  }
  return concepts.every((c) => titles.has(c)) ? titles : undefined;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

type Ctx = {
  q: Query;
  lang: string;
  book: string;
  reader: PackReader;
  data: { texts?: TextUnit[] } & Record<string, unknown>;
  resource: Resource;
  placed: Placed[];
  releaseOf: (depKey: string) => string | undefined;
  /** `release` of each resource of the language's own catalog, by key. */
  releases: Map<string, string>;
};

/**
 * The compressed bytes a helps call opens: the book, plus its originals when aligned words are built (default shape).
 * Over READER_BYTE_BUDGET (en Psalms, Genesis…) the call runs in an exclusive reader; over its cap it gives `null`.
 * Notes and word links alike.
 */
export function helpsNeed(
  reader: SizeProbe,
  code: string,
  indexMode: boolean,
  kind: "notes" | "links" = "notes",
): number {
  void kind;
  if (!indexMode) return bookBytes(reader, code);
  const unit = reader.unitOf("book", code);
  return unit ? reader.size(unit) : 0;
}

async function withHelps<T>(
  env: Packs3Env,
  params: HelpsParams,
  kind: "notes" | "links",
  use: (ctx: Ctx) => Promise<T | undefined>,
): Promise<T | undefined> {
  const q = queryOf(params);
  if (!q) return undefined;
  const code = q.book.toLowerCase();
  // The route answers from views, with another shape (reference, tags, sources, simple), when they have the chapter.
  if (await viewsExist(env, q, params.language, kind)) return undefined;
  const subject =
    kind === "notes" ? "TSV Translation Notes" : "TSV Translation Words Links";
  const answer = await withReader(
    env,
    params.language,
    async (reader, c) => {
      if (!reader.listed(`book:${code}`)) return undefined;
      const own = c.catalogs.find((x) => x.name !== "common");
      const resources = ((own?.catalog as { resources?: Resource[] })
        ?.resources ?? []) as Resource[];
      const data = (await reader.book(code)) as Ctx["data"] | undefined;
      const table = data?.[kind] as Table | undefined;
      if (!data || !table?.res || !Array.isArray(table.rows)) return undefined;
      const resource = resources.find(
        (r) => r.key === table.res && r.subject === subject,
      );
      if (!resource) return undefined;
      const releaseOf = releaseOfCatalogs(c.catalogs);
      // The sweep's items: the whole book (`*`) or one chapter; a default-shape verse or range (`BOOK C:V`,
      // `BOOK C:V-W`) is served only on its chapter's swept verse/range samples (verified.ts `isVerified`).
      // The default shape of a whole book is not a route answer: only `fields=index` has one.
      if (q.chapter === "*" && !q.indexMode) return undefined;
      const item =
        q.chapter === "*"
          ? q.book.toUpperCase()
          : q.indexMode || !q.verseStart
            ? `${q.book.toUpperCase()} ${q.chapter}`
            : verseItem(q.book, q.chapter, q.verseStart, q.verseEnd);
      if (
        !isVerified(c.lang, resource.key, resource.release, kind, item, {
          releaseOf,
          index: q.indexMode,
        })
      ) {
        warnOnce(params.language, "unverified-resource");
        return undefined;
      }
      const placed =
        kind === "notes" ? placeNotes(table.rows) : placeLinks(table.rows);
      if (!placed) return undefined;
      return use({
        q,
        lang: c.lang,
        book: q.book,
        reader,
        data,
        resource,
        placed,
        releaseOf,
        releases: new Map(resources.map((r) => [r.key, r.release])),
      });
    },
    { need: (r) => helpsNeed(r, code, q.indexMode, kind) },
  );
  return answer ?? undefined;
}

/** A body that has links in a form format 3 rewrites. */
export const LINKED = /\[\[(?:ta|tw):|\]\(ref:|rc:\/\//;
/** The links format 3 wrote (`[[ta:…]]`, `[[tw:…]]`, `](ref:…)`, and an id link such as `](ta:…)`). */
const REWRITTEN = /\[\[(?:ta|tw):|\]\((?:ref|ta|tw):/;
const REWRITTEN_G = /\[\[(?:ta|tw):[^\]]*\]\]|\]\((?:ref|ta|tw):[^)]*\)/g;

/**
 * A note body with the links format 3 rewrote given back in the notes' form: `](ref:rom 3:23)` is `](../03/23.md)` in
 * the same book and `](../../rom/03/23.md)` in another (Psalms: three digits); `[[ta:x]]` and `[[tw:x]]` are the `rc:`
 * links of language `*` (`ta/man/x`, `tw/dict/bible/x`). `undefined` when a rewritten link has another form.
 */
export function restoreLinks(text: string, book: string): string | undefined {
  const own = book.toLowerCase();
  const pad = (b: string, n: string) => n.padStart(b === "psa" ? 3 : 2, "0");
  const out = text
    .replace(
      /\]\(ref:([a-z0-9]{3}) (\d+):(\d+)\)/g,
      (_m, b: string, c: string, v: string) =>
        b === own
          ? `](../${pad(b, c)}/${pad(b, v)}.md)`
          : `](../../${b}/${pad(b, c)}/${pad(b, v)}.md)`,
    )
    .replace(/\[\[ta:([^\]\s]+)\]\]/g, "[[rc://*/ta/man/$1]]")
    .replace(/\[\[tw:([^\]\s]+)\]\]/g, "[[rc://*/tw/dict/bible/$1]]");
  return REWRITTEN.test(out) ? undefined : out;
}

/** Rows and aligned-word machinery shared by both routes. */
async function prepare(
  ctx: Ctx,
  notes: boolean,
): Promise<
  | {
      chosen: Placed[];
      titles: Titles;
      /** By the route's own quote matcher (notes and word links). */
      matched?: ReturnType<typeof routeMatcherOf>;
    }
  | undefined
> {
  const chosen = chosenRows(ctx.placed, ctx.q, notes);
  if (!chosen) return undefined;
  const concepts: string[] = [];
  for (const { link, row, kind } of chosen) {
    if (link === undefined) {
      if (notes && kind === "verse" && !proofOfNoLink(row.cols))
        return undefined;
      continue;
    }
    if (!link.startsWith(notes ? "ta:" : "tw:")) return undefined;
    concepts.push(link);
  }
  const titles: Titles | undefined =
    concepts.length === 0 ? new Map() : await titlesOf(ctx.reader, concepts);
  if (!titles) return undefined;
  if (
    !depsCover(
      ctx.lang,
      ctx.resource.key,
      ctx.resource.release,
      notes ? "notes" : "links",
      titles.resources ?? [],
      ctx.releaseOf,
    )
  ) {
    warnOnce(ctx.lang, "unproven-article-resource");
    return undefined;
  }
  if (ctx.q.indexMode) return { chosen, titles };
  // Aligned words, from the verified text, every book (the Hebrew original too; the sweep proves each chapter, and a
  // chapter where the route's matcher answers otherwise is an exception).
  const res = ALIGNED_TEXT.get(ctx.lang);
  // The aligned text must have been swept as passages (the same release the notes were swept with), and the original
  // is one of the entry's `deps`, so a changed release of it has no proof.
  const alignedRelease = res ? ctx.releases.get(res) : undefined;
  if (
    !res ||
    alignedRelease === undefined ||
    !isVerified(ctx.lang, res, alignedRelease, "passage", undefined, {
      releaseOf: ctx.releaseOf,
    })
  )
    return undefined;
  const orig = (await ctx.reader.orig(ctx.book.toLowerCase())) as
    | ({ key?: string } & TextUnit)
    | undefined;
  if (!orig?.key) return undefined;
  const unit = res ? ctx.data.texts?.find((t) => t.res === res) : undefined;
  const matched = routeMatcherOf(ctx.book, orig, unit, versesOf(chosen));
  return matched ? { chosen, titles, matched } : undefined;
}

/** The verses (`c:v`, as the route's `parseInt` reads them) whose words the rows' aligned words come from. */
function versesOf(chosen: Placed[]): Set<string> {
  const keys = new Set<string>();
  for (const p of chosen) {
    const c = parseInt(p.chapter, 10);
    const v = parseInt(p.verse, 10);
    if (!isNaN(c) && !isNaN(v)) keys.add(`${c}:${v}`);
  }
  return keys;
}

/** Recorded only once a test asked (never in the Worker, where it would grow with every call). */
let tokenised: string[] | undefined;
/** The verses tokenised since the last call (`orig c:v`, `text c:v`), and records from now on; for tests. */
export function tokenisedForTests(): string[] {
  const out = tokenised ?? [];
  tokenised = [];
  return out;
}

type Token = { id: number; text: string; type: "word"; align?: number[] };

/**
 * The word tokens of each verse (`c:v`, numbers as the route's `parseInt` reads them) as the route's USFM tokenizer
 * gives them: the `\w` words after a `\v`, not the words of a footnote (`\+w`). Original tokens are numbered by their
 * place among the unit's words (the numbers the alignment uses); aligned tokens from 1 in each verse, with the original
 * places they translate. A verse number met twice, apart, is `doubtful` (the route keeps only its last part).
 */
function verseTokens(
  unit: TextUnit | undefined,
  aligned: boolean,
  wanted: Set<string>,
): { verses: Map<string, Token[]>; doubtful: Set<string> } | undefined {
  const { pieces, events, align } = unit ?? {};
  if (!pieces || !events || (aligned && !align)) return undefined;
  const verses = new Map<string, Token[]>();
  const doubtful = new Set<string>();
  const open: string[] = [];
  let ch = "";
  let vs = "";
  let last = "";
  let e = 0;
  let w = 0;
  for (let p = 0; p < pieces.length; p++) {
    while (e < events.length && events[e][0] <= p) {
      const [, kind, name] = events[e];
      if (kind === "chapter") {
        ch = name;
        vs = "";
      } else if (kind === "verse") vs = name;
      else if (kind === "open") open.push(name);
      else if (kind === "close") open.pop();
      e++;
    }
    if (!pieces[p][1]) continue;
    const id = w++;
    if (open.some((n) => n.startsWith("note:"))) continue;
    const c = /^\d+/.exec(ch);
    const v = /^\d+/.exec(vs);
    if (!c || !v) continue;
    const key = `${Number(c[0])}:${Number(v[0])}`;
    // Every verse word's alignment is checked, as when the whole book was built, so the same units are refused.
    if (aligned && !Array.isArray(align![id])) return undefined;
    const prev = last;
    last = key;
    // Tokens only for the verses asked: a whole book (Psalms) would be tens of thousands of objects.
    if (!wanted.has(key)) continue;
    let list = verses.get(key);
    if (!list) {
      verses.set(key, (list = []));
      tokenised?.push(`${aligned ? "text" : "orig"} ${key}`);
    } else if (key !== prev) doubtful.add(key);
    const text = pieces[p][0];
    if (!aligned) list.push({ id, text, type: "word" });
    else {
      const to = align![id] as number[];
      list.push({
        id: list.length + 1,
        text,
        type: "word",
        ...(to.length ? { align: [...to] } : {}),
      });
    }
  }
  if (aligned && w !== align!.length) return undefined;
  return { verses, doubtful };
}

/**
 * The route's `gatewayQuote.aligned` (`batchGatewayQuotes`): its own `QuoteMatcher` finds the quote's words in the
 * original verse (by text and occurrence, not by the builder's placement), then the aligned words that translate them,
 * joined by `joinAlignedTokens`. `undefined` for a verse whose words cannot be told the same.
 */
export function routeMatcherOf(
  book: string,
  orig: TextUnit | undefined,
  text: TextUnit | undefined,
  wanted: Set<string>,
):
  | ((
      chapter: string,
      verse: string,
      quote: string,
      occurrence: string,
    ) => string | undefined)
  | undefined {
  const o = verseTokens(orig, false, wanted);
  const t = verseTokens(text, true, wanted);
  if (!o || !t) return undefined;
  const matcher = new QuoteMatcher();
  const upper = book.toUpperCase();
  return (chapter, verse, quote, occurrence) => {
    if (verse === "intro" || quote.trim().length === 0) return "";
    const c = parseInt(chapter, 10);
    const v = parseInt(verse, 10);
    if (isNaN(c) || isNaN(v)) return "";
    const key = `${c}:${v}`;
    if (o.doubtful.has(key) || t.doubtful.has(key)) return undefined;
    const chapters = (tokens: Token[] | undefined) =>
      tokens
        ? [
            {
              number: c,
              verseCount: 1,
              paragraphCount: 0,
              verses: [
                {
                  number: v,
                  text: tokens.map((x) => x.text).join(" "),
                  tokens,
                },
              ],
            },
          ]
        : [];
    const ref = { book: upper, startChapter: c, startVerse: v, endVerse: v };
    try {
      const found = matcher.findOriginalTokens(
        chapters(o.verses.get(key)),
        quote,
        parseInt(occurrence || "1", 10),
        ref,
      );
      if (!found.success || found.totalTokens.length === 0) return "";
      const hit = matcher.findAlignedTokens(
        found.totalTokens,
        chapters(t.verses.get(key)),
        ref,
      );
      if (!hit.success || hit.totalAlignedTokens.length === 0) return "";
      return joinAlignedTokens(hit.totalAlignedTokens);
    } catch {
      return "";
    }
  };
}

export async function buildNotesAnswer(
  env: Packs3Env,
  params: HelpsParams,
): Promise<{ answer: Record<string, unknown>; exact: boolean } | undefined> {
  return withHelps(env, params, "notes", async (ctx) => {
    const prep = await prepare(ctx, true);
    if (!prep) return undefined;
    const { chosen, titles, matched } = prep;
    let exact = true;
    const notes: Array<Record<string, unknown>> = [];
    for (const p of chosen) {
      const { row } = p;
      const note = str(row.cols.note);
      const quote = str(row.cols.quote);
      const occurrence = str(row.cols.occurrence);
      if (note === undefined || quote === undefined || occurrence === undefined)
        return undefined;
      const supportReference = p.link ? `rc://*/ta/man/${p.link.slice(3)}` : "";
      const supportReferenceTitle = p.link
        ? (titles.get(p.link) ?? null)
        : null;
      const body = restoreLinks(note, ctx.book);
      if (ctx.q.indexMode) {
        const heading =
          p.verse === "intro" ? markdownHeading(body ?? note) : "";
        if (body === undefined && LINKED.test(heading)) return undefined;
        notes.push({
          book: "",
          chapter: p.chapter,
          verse: p.verse,
          id: row.id,
          supportReference,
          supportReferenceTitle,
          quote: quote ? formatQuoteDisplay(quote) : quote,
          occurrence,
          ...(heading ? { heading } : {}),
        });
        continue;
      }
      if (body === undefined) exact = false;
      const at = matched!(p.chapter, p.verse, quote, occurrence);
      if (at === undefined) return undefined;
      notes.push({
        book: "",
        chapter: p.chapter,
        verse: p.verse,
        id: row.id,
        supportReference,
        quote,
        occurrence,
        note: body ?? note,
        supportReferenceTitle,
        gatewayQuote: {
          original: quote ? formatQuoteDisplay(quote) : quote,
          aligned: at,
        },
      });
    }
    const source = sourceFromPackView(
      {
        notes: {
          key: ctx.resource.key,
          title: "",
          version: ctx.resource.release,
        },
      },
      "notes",
    );
    if (!source) return undefined;
    return {
      answer: {
        reference: ctx.q.reference,
        language: ctx.lang,
        book: ctx.q.book,
        chapter: ctx.q.chapter,
        verse: ctx.q.verseStart ?? null,
        notes,
        source,
        meta: { cache: "pack" },
      },
      exact,
    };
  });
}

export async function notesFromPacks3(
  env: Packs3Env,
  params: HelpsParams,
): Promise<Record<string, unknown> | undefined> {
  const built = await buildNotesAnswer(env, params);
  if (!built) return undefined;
  if (!built.exact) {
    warnOnce(params.language, "note-links");
    return undefined;
  }
  return built.answer;
}

export async function wordLinksFromPacks3(
  env: Packs3Env,
  params: HelpsParams,
): Promise<Record<string, unknown> | undefined> {
  return withHelps(env, params, "links", async (ctx) => {
    const prep = await prepare(ctx, false);
    if (!prep) return undefined;
    const { chosen, titles, matched } = prep;
    const wordLinks: Array<Record<string, unknown>> = [];
    for (const p of chosen) {
      const { row } = p;
      const origWords = str(row.cols.origWords);
      const occurrence = str(row.cols.occurrence);
      const wordPath = str(row.cols.articlePath);
      if (
        origWords === undefined ||
        occurrence === undefined ||
        wordPath === undefined ||
        p.link === undefined ||
        p.link !== `tw:${wordPath.replace(/^bible\//, "")}`
      )
        return undefined;
      const twTitle = titles.get(p.link);
      if (twTitle === undefined) return undefined;
      const base = {
        book: "",
        chapter: p.chapter,
        verse: p.verse,
        twId: row.id,
        supportReference: "",
        origWords:
          ctx.q.indexMode && origWords
            ? formatQuoteDisplay(origWords)
            : origWords,
        occurrence,
        twLink: `rc://*/tw/dict/${wordPath}`,
        wordPath,
        twTitle,
      };
      if (ctx.q.indexMode) {
        wordLinks.push(base);
        continue;
      }
      const at = matched!(p.chapter, p.verse, origWords, occurrence);
      if (at === undefined) return undefined;
      wordLinks.push({
        ...base,
        gatewayQuote: {
          original: origWords ? formatQuoteDisplay(origWords) : origWords,
          aligned: at,
        },
      });
    }
    return {
      reference: ctx.q.reference,
      language: ctx.lang,
      book: ctx.q.book,
      chapter: ctx.q.chapter,
      verse: ctx.q.verseStart ?? null,
      wordLinks,
      meta: { cache: "pack" },
    };
  });
}

/** Registered in `ADAPTERS` for `/api/v1/notes` and `/api/v1/word-links`. */
export function helpsAdapterParams(params: Packs3Params): HelpsParams {
  return {
    reference: String(params.reference ?? ""),
    language: String(params.language ?? ""),
    fields: params.fields === undefined ? undefined : String(params.fields),
  };
}
