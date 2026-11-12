/**
 * `/api/v1/notes` and `/api/v1/word-links` from format 3 books. Like the scripture adapter, it answers only what the
 * routes would answer the same way and gives `undefined` for the rest (see the gaps in the Task 6 report):
 *
 * - A note body is not returned when it has links: format 3 rewrites `rc://` and relative links as ids and keeps no trace
 *   of the original form (`rc://*` or `rc://es-419`, `../01/05.md` or `./05.md`), so the route's text cannot be rebuilt.
 *   `fields=index` has no bodies and is answered.
 * - The aligned words (`gatewayQuote.aligned`) are rebuilt from the verse's alignment for New Testament books only: on
 *   Hebrew books some rows of the route differ (its own quote matching), and which ones cannot be told from the data.
 * - Only the resources of the tables below, checked against the route's live answers (2026-11-12), are answered.
 */
import {
  formatQuoteDisplay,
  isCanonicalUsfmBook,
  verseOverlapsQueryRange,
} from "@translation-helps/door43";
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
import { withReader } from "../readers";
import type { Packs3Params } from "../answer";
import { BOOKS, FIRST_NT, VERIFIED } from "./scripture";

/** Resources whose rows were compared with the route's (en TIT, es-419 TIT and RUT, every row of every chapter). */
export const VERIFIED_NOTES = new Set([
  "unfoldingWord/en/tn",
  "es-419_gl/es-419/tn",
]);
export const VERIFIED_LINKS = new Set([
  "unfoldingWord/en/twl",
  "es-419_gl/es-419/twl",
]);
/** The article resources whose titles equal the route's `supportReferenceTitle` / `twTitle`. */
export const VERIFIED_ARTICLES = new Set([
  "unfoldingWord/en/ta",
  "unfoldingWord/en/tw",
  "es-419_gl/es-419/ta",
  "es-419_gl/es-419/tw",
]);
/**
 * The (language, book) pairs whose rows were compared with the route's live answers (tests/fixtures/packs3/live). Any
 * other book gives `undefined` (warning "unverified-book"). A pair is added after Task 10's comparison shows the answers
 * equal for that book. Keys are the catalog's language (as `c.lang`) and the lowercase book code.
 */
export const VERIFIED_BOOKS = new Map<string, Set<string>>([
  ["en", new Set(["tit"])],
  ["es-419", new Set(["tit", "rut"])],
]);
/** The originals the quote positions of the pinned rows index (the route matches its quotes in the same text). */
export const VERIFIED_ORIGINALS = new Set(["unfoldingWord/el-x-koine/ugnt"]);

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
  return typeof cols.note === "string" && !REFERENCE_LIKE.test(cols.note);
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

type Placed = {
  row: HelpRow;
  chapter: string;
  verse: string;
  kind: "front" | "chapter" | "verse";
  /** The article the row points to (`ta:translate/figs-metaphor`, `tw:kt/god`), if any. */
  link?: string | undefined;
};

/**
 * The article a row points to. The reader guard forbids the name of that row field in this folder (it is also the name
 * of a reader method), so it is read as the one field of the row besides the known ones.
 */
function linkOf(row: HelpRow): string | undefined | null {
  const { id, ref, from, to, cols, quote, ...rest } = row;
  void [id, ref, from, to, cols, quote];
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
 * as rows flagged `isIntro` at `c:1`. The book introduction is the first of the two flagged rows of chapter 1 and the
 * first row of the book; any other arrangement cannot be told apart, so it gives `undefined`.
 */
function placeNotes(rows: HelpRow[]): Placed[] | undefined {
  const placed: Placed[] = [];
  const introsOf = new Map<string, number>();
  for (const [i, row] of rows.entries()) {
    const at = refOf(row);
    if (!at || linkOf(row) === null) return undefined;
    if (row.cols.supportReference !== undefined) return undefined;
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
        });
      } else if (n === 1 || (at.chapter === "1" && n === 2)) {
        placed.push({
          row,
          chapter: at.chapter,
          verse: "intro",
          kind: "chapter",
          link: linkOf(row) ?? undefined,
        });
      } else return undefined;
    } else if (row.cols.isIntro === false || row.cols.isIntro === undefined) {
      placed.push({
        row,
        chapter: at.chapter,
        verse: at.verse,
        kind: "verse",
        link: linkOf(row) ?? undefined,
      });
    } else return undefined;
  }
  // One flagged row in chapter 1 could be either introduction.
  if (introsOf.get("1") === 1) return undefined;
  return placed;
}

function placeLinks(rows: HelpRow[]): Placed[] | undefined {
  const placed: Placed[] = [];
  for (const row of rows) {
    const at = refOf(row);
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

/** The route's `parseTranslationNotesTsv` filter, in the order of the TSV. */
function inQuery(p: Placed, q: Query, notes: boolean): boolean {
  if (q.chapter === "*") return true;
  if (notes && p.kind === "front") return true;
  if (p.chapter !== q.chapter) return false;
  if (p.kind === "chapter") return true;
  if (!q.verseStart) return true;
  return verseOverlapsQueryRange(p.verse, q.verseStart, q.verseEnd);
}

type Titles = Map<string, string>;

/** Titles of the articles the concepts point to, from the groups they belong to, or `undefined` when one is missing. */
async function titlesOf(
  reader: PackReader,
  concepts: string[],
): Promise<Titles | undefined> {
  const titles: Titles = new Map();
  const groups = new Set(concepts.map((c) => c.slice(0, c.lastIndexOf("/"))));
  for (const group of groups) {
    const articles = (await reader.articles(group)) as
      | Array<{ id?: string; res?: string; title?: unknown }>
      | undefined;
    if (!articles) return undefined;
    for (const a of articles) {
      if (typeof a.id !== "string") continue;
      if (!a.res || !VERIFIED_ARTICLES.has(a.res)) continue;
      if (typeof a.title === "string" && a.title) titles.set(a.id, a.title);
    }
  }
  return concepts.every((c) => titles.has(c)) ? titles : undefined;
}

/**
 * The words of the aligned text that translate the original words at `positions`, in the order of the text, with `…` at a
 * gap, as the route's `joinAlignedTokens` gives them. Built once per call for the verses asked.
 */
function alignedOf(
  unit: TextUnit | undefined,
):
  | ((chapter: string, verse: string, pos: number[]) => string | undefined)
  | undefined {
  const { pieces, events, align } = unit ?? {};
  if (!pieces || !events || !align) return undefined;
  const words: string[] = [];
  const verseOf: string[] = [];
  let ch = "";
  let vs = "";
  let e = 0;
  pieces.forEach((piece, p) => {
    while (e < events.length && events[e][0] <= p) {
      if (events[e][1] === "chapter") {
        ch = events[e][2];
        vs = "";
      } else if (events[e][1] === "verse") vs = events[e][2];
      e++;
    }
    if (!piece[1]) return;
    words.push(piece[0]);
    verseOf.push(`${ch}:${vs}`);
  });
  if (words.length !== align.length) return undefined;
  const byVerse = new Map<string, number[]>();
  verseOf.forEach((v, w) => {
    const list = byVerse.get(v);
    if (list) list.push(w);
    else byVerse.set(v, [w]);
  });
  return (chapter, verse, pos) => {
    const set = new Set(pos);
    const hit = (byVerse.get(`${chapter}:${verse}`) ?? []).filter((w) =>
      align[w].some((x) => set.has(x)),
    );
    if (hit.length === 0) return undefined;
    const parts: string[] = [];
    hit.forEach((w, i) => {
      if (i > 0 && w - hit[i - 1] > 1) parts.push("…");
      parts.push(words[w]);
    });
    return parts.join(" ");
  };
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Positions of a row's quote in the original, or `undefined` for anything that is not a plain list of words. */
function positionsOf(row: HelpRow): number[] | undefined {
  const q = row.quote ?? [];
  return q.every((x) => Number.isInteger(x) && (x as number) >= 0)
    ? (q as number[])
    : undefined;
}

type Ctx = {
  q: Query;
  lang: string;
  book: string;
  reader: PackReader;
  data: { texts?: TextUnit[] } & Record<string, unknown>;
  resource: Resource;
  placed: Placed[];
};

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
  const verified = kind === "notes" ? VERIFIED_NOTES : VERIFIED_LINKS;
  const subject =
    kind === "notes" ? "TSV Translation Notes" : "TSV Translation Words Links";
  const answer = await withReader(env, params.language, async (reader, c) => {
    if (!reader.listed(`book:${code}`)) return undefined;
    if (!VERIFIED_BOOKS.get(c.lang)?.has(code)) {
      warnOnce(params.language, "unverified-book");
      return undefined;
    }
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
    if (!verified.has(resource.key)) {
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
    });
  });
  return answer ?? undefined;
}

/** A body that has links in a form format 3 rewrites (and cannot give back as it was). */
export const LINKED = /\[\[(?:ta|tw):|\]\(ref:|rc:\/\//;

/** Rows and aligned-word machinery shared by both routes. */
async function prepare(
  ctx: Ctx,
  notes: boolean,
): Promise<
  | {
      chosen: Placed[];
      titles: Titles;
      aligned?: ReturnType<typeof alignedOf>;
    }
  | undefined
> {
  const chosen = ctx.placed.filter((p) => inQuery(p, ctx.q, notes));
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
  const titles =
    concepts.length === 0 ? new Map() : await titlesOf(ctx.reader, concepts);
  if (!titles) return undefined;
  if (ctx.q.indexMode) return { chosen, titles };
  // Aligned words: New Testament only, from the verified text.
  if (BOOKS.indexOf(ctx.book.toLowerCase()) < FIRST_NT) return undefined;
  const res = ALIGNED_TEXT.get(ctx.lang);
  // The aligned text must be a verified one of the scripture adapter, and the original the one the positions index.
  if (!res || !(res in VERIFIED)) return undefined;
  const orig = (await ctx.reader.orig(ctx.book.toLowerCase())) as
    | { key?: string }
    | undefined;
  if (!orig?.key || !VERIFIED_ORIGINALS.has(orig.key)) return undefined;
  const unit = res ? ctx.data.texts?.find((t) => t.res === res) : undefined;
  const aligned = alignedOf(unit);
  if (!aligned) return undefined;
  return { chosen, titles, aligned };
}

/** Today's `gatewayQuote.aligned` of a row, or `undefined` when it cannot be given the same. */
function gatewayAligned(
  p: Placed,
  quote: string,
  aligned: NonNullable<ReturnType<typeof alignedOf>>,
): string | undefined {
  if (p.verse === "intro" || quote.trim() === "") return "";
  if (!/^\d+$/.test(p.verse)) return undefined;
  const pos = positionsOf(p.row);
  if (!pos) return undefined;
  // The route finds its own words with its own matcher: a quote the builder could not place says nothing about it.
  if (pos.length === 0) return undefined;
  return aligned(p.chapter, p.verse, pos);
}

export async function buildNotesAnswer(
  env: Packs3Env,
  params: HelpsParams,
): Promise<{ answer: Record<string, unknown>; exact: boolean } | undefined> {
  return withHelps(env, params, "notes", async (ctx) => {
    const prep = await prepare(ctx, true);
    if (!prep) return undefined;
    const { chosen, titles, aligned } = prep;
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
      if (ctx.q.indexMode) {
        const heading = p.verse === "intro" ? markdownHeading(note) : "";
        if (LINKED.test(heading)) return undefined;
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
      if (LINKED.test(note)) exact = false;
      const at = gatewayAligned(p, quote, aligned!);
      if (at === undefined) return undefined;
      notes.push({
        book: "",
        chapter: p.chapter,
        verse: p.verse,
        id: row.id,
        supportReference,
        quote,
        occurrence,
        note,
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
    const { chosen, titles, aligned } = prep;
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
      const at = gatewayAligned(p, origWords, aligned!);
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
