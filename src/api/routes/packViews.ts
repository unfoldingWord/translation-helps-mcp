/**
 * src/api/routes/packViews.ts
 *
 * Notes and word links read from the views made with the language packs
 * (bt-synergy's `packages/resource-pipeline/cli/mcp-views.ts`): one small JSON
 * file per book and chapter, every note and link with its words in the
 * language's literal and simple bridge texts already found, and the titles of
 * the articles they point to. Nothing is downloaded, unzipped or tokenized.
 *
 * When a language or a chapter has no view, the routes go on to Door43 as
 * before: the views are a faster, fuller path, not the only one.
 *
 * Layout (schema 1), under the `LANGUAGE_PACKS` bucket:
 *   v1/{lang}/index.json
 *   v1/{lang}/notes/{BOOK}/{chapter}.json
 *   v1/{lang}/word-links/{BOOK}/{chapter}.json
 */

import type { Env } from "../worker.js";
import { formatQuoteDisplay, resolveTitleFromPath } from "@translation-helps/door43";

/** The schema of the views this server reads. */
export const PACK_VIEWS_SCHEMA = 1;

/** Where views are read from: an R2 bucket in a Worker, a folder in a script. */
export interface PackViews {
  get(path: string): Promise<unknown | null>;
}

/** The views in the `LANGUAGE_PACKS` bucket, or null when the Worker has none. */
export function packViewsOf(env: Env): PackViews | null {
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket) return null;
  return {
    async get(path) {
      const object = await bucket.get(`v1/${path}`);
      return object ? await object.json() : null;
    },
  };
}

/** Regional variants a language's views may be under (es → es-419), as the catalog lookup does. */
const VARIANTS: Record<string, string[]> = {
  es: ["es-419"],
  pt: ["pt-br"],
  zh: ["zh-hans", "zh-tw"],
  ar: ["ar-x-strong"],
};

type Aligned = { literal: string | null; simple: string | null };
type Source = { key: string; title: string; version: string | null } | null;

interface NoteView {
  id: string;
  reference: string;
  verse: number | "intro";
  to?: number;
  intro: "book" | "chapter" | null;
  quote: string;
  occurrence: string;
  note: string;
  tags: string;
  supportReference: string;
  supportReferenceTitle: string | null;
  aligned: Aligned;
}

interface LinkView {
  id: string;
  reference: string;
  verse: number | "intro";
  to?: number;
  origWords: string;
  occurrence: string;
  tags: string;
  twLink: string;
  articlePath: string;
  title: string | null;
  aligned: Aligned;
}

interface ChapterView {
  schema: number;
  language: string;
  book: string;
  chapter: number;
  sources: Record<string, Source>;
}

/** The view of a chapter in the language or its variants, with the language it was found under. */
async function chapterView<T extends ChapterView>(
  views: PackViews,
  kind: "notes" | "word-links",
  language: string,
  book: string,
  chapter: number,
): Promise<T | null> {
  const code = language.toLowerCase();
  for (const lang of [code, ...(VARIANTS[code] ?? [])]) {
    const view = (await views.get(
      `${lang}/${kind}/${book.toUpperCase()}/${chapter}.json`,
    )) as T | null;
    if (view && view.schema === PACK_VIEWS_SCHEMA) return view;
  }
  return null;
}

/** Whether a row's verses meet the verses asked for (a range on either side). */
function inVerses(
  row: { verse: number | "intro"; to?: number },
  verseStart?: string,
  verseEnd?: string,
): boolean {
  if (row.verse === "intro") return false;
  if (!verseStart) return true;
  const from = Number(verseStart);
  const to = verseEnd ? Number(verseEnd) : from;
  return row.verse <= to && (row.to ?? row.verse) >= from;
}

/**
 * The notes of a reference from the views: the book's and the chapter's
 * introductions (as the TSV path always gives them), then the notes of the
 * verses asked for. Each row has the TSV path's fields, with the book filled
 * in, and its words in the literal text (`gatewayQuote.aligned`) and in the
 * simple one (`gatewayQuote.simple`). Null when there is no view.
 */
export async function notesFromViews(
  views: PackViews,
  args: {
    language: string;
    book: string;
    chapter: string;
    verseStart?: string;
    verseEnd?: string;
  },
): Promise<{
  language: string;
  notes: Array<Record<string, unknown>>;
  sources: Record<string, Source>;
} | null> {
  const chapter = Number(args.chapter);
  if (!Number.isInteger(chapter)) return null;
  const view = await chapterView<ChapterView & { notes: NoteView[] }>(
    views,
    "notes",
    args.language,
    args.book,
    chapter,
  );
  if (!view) return null;
  // The book's introduction is kept with chapter 1.
  const first =
    chapter === 1
      ? view
      : await chapterView<ChapterView & { notes: NoteView[] }>(
          views,
          "notes",
          view.language,
          args.book,
          1,
        );
  const rows = [
    ...(first?.notes.filter((n) => n.intro === "book") ?? []),
    ...view.notes.filter((n) => n.intro === "chapter"),
    ...view.notes.filter((n) =>
      inVerses(n, args.verseStart, args.verseEnd),
    ),
  ];
  return {
    language: view.language,
    sources: view.sources,
    notes: rows.map((n) => ({
      book: view.book,
      chapter: n.intro === "book" ? "front" : String(chapter),
      verse: n.verse === "intro" ? "intro" : String(n.verse),
      reference: n.reference,
      id: n.id,
      tags: n.tags,
      supportReference: n.supportReference,
      quote: n.quote,
      occurrence: n.occurrence,
      note: n.note,
      supportReferenceTitle: n.supportReference
        ? (n.supportReferenceTitle ?? resolveTitleFromPath(n.supportReference))
        : null,
      gatewayQuote: {
        original: n.quote ? formatQuoteDisplay(n.quote) : n.quote,
        aligned: n.aligned.literal ?? "",
        simple: n.aligned.simple ?? "",
      },
    })),
  };
}

/** The word links of a reference from the views, as the TSV path gives them, with their words found. */
export async function wordLinksFromViews(
  views: PackViews,
  args: {
    language: string;
    book: string;
    chapter: string;
    verseStart?: string;
    verseEnd?: string;
  },
): Promise<{
  language: string;
  wordLinks: Array<Record<string, unknown>>;
  sources: Record<string, Source>;
} | null> {
  const chapter = Number(args.chapter);
  if (!Number.isInteger(chapter)) return null;
  const view = await chapterView<ChapterView & { links: LinkView[] }>(
    views,
    "word-links",
    args.language,
    args.book,
    chapter,
  );
  if (!view) return null;
  return {
    language: view.language,
    sources: view.sources,
    wordLinks: view.links
      .filter((l) => inVerses(l, args.verseStart, args.verseEnd))
      .map((l) => ({
        book: view.book,
        chapter: String(chapter),
        verse: String(l.verse),
        reference: l.reference,
        twId: l.id,
        supportReference: "",
        tags: l.tags,
        origWords: l.origWords,
        occurrence: l.occurrence,
        twLink: l.twLink,
        wordPath: l.articlePath,
        twTitle: l.title ?? (l.articlePath ? resolveTitleFromPath(l.articlePath) : null),
        gatewayQuote: {
          original: l.origWords ? formatQuoteDisplay(l.origWords) : l.origWords,
          aligned: l.aligned.literal ?? "",
          simple: l.aligned.simple ?? "",
        },
      })),
  };
}
