/**
 * GET /api/v1/resources?language=&book=&reference=
 *
 * Returns a cheap availability summary: which resource types/versions exist
 * for a given language. Uses only catalog metadata (no zip fetching).
 * Powers the context availability summary in get_passage_context.
 *
 * Optional `book` or `reference` (USFM book extracted) filters/annotates
 * book-scoped resources so clients are not misled by type-level presence
 * when only a subset of books exists (e.g. hi_tn = ACT only).
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import {
  catalogSearch,
  resolveCatalogLanguage,
  resolveScriptureVersionRole,
  bookCodesFromIngredients,
  bookNameToUsfm,
  parseReference,
} from "@translation-helps/door43";

const ALL_SUBJECTS = [
  { subject: "Aligned Bible,Bible", type: "scripture" as const },
  { subject: "TSV Translation Notes", type: "notes" as const },
  { subject: "TSV Translation Words Links", type: "wordLinks" as const },
  { subject: "Translation Words", type: "words" as const },
  { subject: "Translation Academy", type: "academy" as const },
  { subject: "TSV Translation Questions", type: "questions" as const },
  { subject: "Open Bible Stories", type: "obs" as const },
  { subject: "TSV OBS Translation Notes", type: "obsNotes" as const },
  {
    subject: "TSV OBS Translation Questions",
    type: "obsQuestions" as const,
  },
];

/** Resource types whose catalog ingredients are typically USFM books. */
const BOOK_SCOPED_TYPES = new Set([
  "scripture",
  "notes",
  "wordLinks",
  "questions",
]);

export async function handleResources(ctx: RouteContext): Promise<Response> {
  const { url, env } = ctx;
  const requestedLanguage = url.searchParams.get("language");
  if (!requestedLanguage)
    return apiError("BAD_REQUEST", "Missing required param: language", 400);

  const bookFilter = resolveBookFilter(url);

  // Resolve effective language (variant fallback, e.g. "es" → "es-419").
  // Use the primary scripture subject for the initial resolution so the check
  // is consistent with get_passage; all subjects share the same memoized result.
  const { language } = await resolveCatalogLanguage(requestedLanguage, {
    subject: "Aligned Bible,Bible",
    kv: env.TRANSLATION_HELPS_CACHE,
  });

  const results = await Promise.allSettled(
    ALL_SUBJECTS.map(async ({ subject, type }) => {
      const entries = await catalogSearch({
        lang: language,
        subject,
        kv: env.TRANSLATION_HELPS_CACHE,
      });
      return { type, entries };
    }),
  );

  const available: Array<{
    type: string;
    subject: string;
    abbreviation: string;
    role: string;
    books?: string[];
    bookCount?: number;
    coversBook?: boolean;
    warning?: string;
  }> = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { type, entries } = result.value;
    for (const entry of entries) {
      const abbrev = entry.abbreviation ?? entry.repo.replace(/^[a-z]+_/, "");
      const role =
        type === "scripture" ? resolveScriptureVersionRole(abbrev) : type;
      const books = BOOK_SCOPED_TYPES.has(type)
        ? bookCodesFromIngredients(entry.ingredients)
        : [];
      const coversBook =
        bookFilter && books.length > 0 ? books.includes(bookFilter) : undefined;

      // When a book filter is set and this resource declares books but not
      // the requested one, omit it from available (honest presence check).
      if (bookFilter && books.length > 0 && coversBook === false) {
        continue;
      }

      const item: (typeof available)[number] = {
        type,
        subject: entry.subject ?? "",
        abbreviation: abbrev,
        role,
      };
      if (books.length > 0) {
        item.books = books;
        item.bookCount = books.length;
        // Flag partial Bible coverage without requiring a book filter
        if (books.length < 66) {
          item.warning =
            `Partial book coverage (${books.length} book(s)` +
            `${bookFilter ? `; requested ${bookFilter}` : ""})` +
            " — type-level presence does not guarantee every book.";
        }
      }
      if (coversBook !== undefined) item.coversBook = coversBook;
      available.push(item);
    }
  }

  // Also check if original languages exist (for alignment support)
  const originalLangs = [
    { lang: "el-x-koine", subject: "Greek New Testament", label: "ugnt" },
    { lang: "hbo", subject: "Hebrew Old Testament", label: "uhb" },
  ];

  for (const { lang, subject, label } of originalLangs) {
    const entries = await catalogSearch({
      lang,
      subject,
      kv: env.TRANSLATION_HELPS_CACHE,
    });
    if (entries.length === 0) continue;
    const books = bookCodesFromIngredients(entries[0].ingredients);
    if (bookFilter && books.length > 0 && !books.includes(bookFilter)) {
      continue;
    }
    const item: (typeof available)[number] = {
      type: "scripture",
      subject,
      abbreviation: label,
      role: "original",
    };
    if (books.length > 0) {
      item.books = books;
      item.bookCount = books.length;
      if (bookFilter) item.coversBook = true;
    }
    available.push(item);
  }

  return json({
    language,
    requestedLanguage,
    ...(bookFilter ? { book: bookFilter } : {}),
    available,
    coverage: {
      note:
        "Type-level catalog presence does not guarantee every book. " +
        "Book-scoped entries may include `books` / `bookCount` / `warning`. " +
        "Pass `book=TIT` or `reference=TIT 1` to filter; confirm with get_passage_index.",
      ...(bookFilter ? { filteredByBook: bookFilter } : {}),
    },
  });
}

/** Resolve optional book filter from `book=` or `reference=` query params. */
function resolveBookFilter(url: URL): string | undefined {
  const bookParam = url.searchParams.get("book")?.trim();
  if (bookParam) return bookNameToUsfm(bookParam);

  const reference = url.searchParams.get("reference")?.trim();
  if (!reference) return undefined;

  const parsed = parseReference(reference);
  if (parsed.isValid && parsed.book) return bookNameToUsfm(parsed.book);

  // Bare USFM / short name
  if (/^[1-3]?[A-Za-z]{2,}$/.test(reference)) {
    return bookNameToUsfm(reference);
  }
  return undefined;
}
