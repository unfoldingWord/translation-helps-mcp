/**
 * `/api/v1/notes` and `/api/v1/word-links` from format 3 books. Like the scripture adapter, it answers only what the
 * routes would answer the same way and gives `undefined` for the rest (see the gaps in the Task 6 report):
 *
 * - Format 3 rewrites a note body's links as ids (`ref:tit 1:5`, `[[ta:…]]`, `[[tw:…]]`); `restoreLinks` gives them
 *   back in the form the en and es-419 notes use (`../01/05.md`, `rc:` links with the `*` language). Another form could have been
 *   written: the sweep proves each chapter, and a body with a form it cannot rebuild is not returned.
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
import { depsCover, isVerified, releaseOfCatalogs } from "../verified";
import { BOOKS, FIRST_NT } from "./scripture";

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
          quoteMissing: missing(row),
        });
      } else if (n === 1 || (at.chapter === "1" && n === 2)) {
        placed.push({
          row,
          chapter: at.chapter,
          verse: "intro",
          kind: "chapter",
          link: linkOf(row) ?? undefined,
          quoteMissing: missing(row),
        });
      } else return undefined;
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

/**
 * The words of the aligned text that translate the original words at `positions`, in the order of the text, with `…` at a
 * gap, as the route's `joinAlignedTokens` gives them. Built once per call for the verses asked.
 */
function alignedOf(
  unit: TextUnit | undefined,
):
  | ((
      chapter: string,
      verse: string,
      pos: number[],
      all?: boolean,
    ) => string | undefined)
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
  return (chapter, verse, pos, all = false) => {
    const set = new Set(pos);
    const inVerse = byVerse.get(`${chapter}:${verse}`) ?? [];
    // `all`: the route looks for the quote in this verse only; a quote with words outside it is not found ("").
    if (all) {
      const covered = new Set(inVerse.flatMap((w) => align[w]));
      if (!pos.every((x) => covered.has(x))) return "";
    }
    const hit = inVerse.filter((w) => align[w].some((x) => set.has(x)));
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
  releaseOf: (depKey: string) => string | undefined;
  /** `release` of each resource of the language's own catalog, by key. */
  releases: Map<string, string>;
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
  const subject =
    kind === "notes" ? "TSV Translation Notes" : "TSV Translation Words Links";
  const answer = await withReader(env, params.language, async (reader, c) => {
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
    // The sweep's items: the whole book (`*`) or one chapter; a verse or a range is served from its chapter's proof.
    // The default shape of a whole book is not a route answer: only `fields=index` has one.
    if (q.chapter === "*" && !q.indexMode) return undefined;
    const item =
      q.chapter === "*"
        ? q.book.toUpperCase()
        : `${q.book.toUpperCase()} ${q.chapter}`;
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
  });
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
  // Aligned words: New Testament only, from the verified text.
  if (BOOKS.indexOf(ctx.book.toLowerCase()) < FIRST_NT) return undefined;
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
    | { key?: string }
    | undefined;
  if (!orig?.key) return undefined;
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
  // Some words placed and some not: the route may find them all, so its words cannot be told.
  if (p.quoteMissing) return undefined;
  const range = /^(\d+)-\d+$/.exec(p.verse);
  if (!range && !/^\d+$/.test(p.verse)) return undefined;
  const pos = positionsOf(p.row);
  if (!pos) return undefined;
  // A quote the builder could not place at all (`Connecting Statement:`): the route's matcher finds none either ("").
  // The sweep proves it chapter by chapter.
  if (pos.length === 0) return "";
  // A range row (`6-7`): the route matches the quote in its first verse only.
  return range
    ? aligned(p.chapter, range[1]!, pos, true)
    : aligned(p.chapter, p.verse, pos);
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
