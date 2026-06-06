/**
 * GET /api/v1/quote?reference=&language=&quote=&occurrence=
 *
 * Resolves an original-language TSV `quote` field to:
 *   - original[]  — matched tokens from the original-language text (UGNT/UHB),
 *                   each with text, strong, lemma, morph, occurrence, semanticId
 *   - gateway[]   — aligned gateway words per strategic-language version (ULT/UST)
 *
 * Multi-part quotes separated by `&` are supported.
 * The `occurrence` param selects which occurrence of the first quote part to use.
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import {
  requireReferenceAndLanguage,
  makeFetcher,
  zipUrlFromEntry,
  buildBookPaths,
} from "./helpers.js";
import { catalogSearch } from "../../core/resources/dcsClient.js";
import { tokenizeUsfm, QuoteMatcher } from "../../core/alignment/index.js";
import type { QuoteReference } from "../../core/alignment/index.js";
import { joinAlignedTokens } from "./alignmentHelper.js";

const NT_BOOKS = new Set([
  "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL",
  "1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN",
  "3JN","JUD","REV",
]);

function isNtBook(book: string): boolean {
  return NT_BOOKS.has(book.toUpperCase());
}

export async function handleQuote(ctx: RouteContext): Promise<Response> {
  const { url, env } = ctx;

  const quoteRaw = url.searchParams.get("quote");
  const occurrence = parseInt(url.searchParams.get("occurrence") ?? "1", 10);

  let ref: ReturnType<typeof requireReferenceAndLanguage>;
  try {
    ref = requireReferenceAndLanguage(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  if (!quoteRaw) {
    return apiError("BAD_REQUEST", "Missing required param: quote", 400);
  }

  const quote = decodeURIComponent(quoteRaw);
  const { reference, language, book, chapter, verseStart, verseEnd } = ref;

  const startChapter = parseInt(chapter, 10);
  const startVerse = parseInt(verseStart ?? "1", 10);
  const endVerse = verseEnd ? parseInt(verseEnd, 10) : startVerse;

  const qRef: QuoteReference = {
    book: book.toUpperCase(),
    startChapter,
    startVerse,
    endVerse,
  };

  const fetcher = makeFetcher(env);

  // -------------------------------------------------------------------------
  // 1. Discover and fetch original-language USFM (UGNT or UHB)
  // -------------------------------------------------------------------------
  const origSubject = isNtBook(book) ? "Greek New Testament" : "Hebrew Old Testament";
  const origLang = isNtBook(book) ? "el-x-koine" : "hbo";

  const origEntries = await catalogSearch({
    lang: origLang,
    subject: origSubject,
    kv: env.TRANSLATION_HELPS_CACHE,
  });

  if (origEntries.length === 0) {
    return apiError("NOT_FOUND", `No original-language resource found for book "${book}"`, 404);
  }

  const origEntry = origEntries[0];
  const origZipUrl = zipUrlFromEntry(origEntry);
  const origZip = await fetcher.getOrDownloadZip(origZipUrl);
  const origPaths = buildBookPaths(origEntry, book, "", ".usfm");

  let origUsfm: string | null = null;
  for (const p of origPaths) {
    origUsfm = await fetcher.extractFileFromZip(origZip, p);
    if (origUsfm) break;
  }

  if (!origUsfm) {
    return apiError("NOT_FOUND", `Book "${book}" not found in original-language resource`, 404);
  }

  // -------------------------------------------------------------------------
  // 2. Match quote in original-language tokens
  // -------------------------------------------------------------------------
  const origChapters = tokenizeUsfm(origUsfm, book.toUpperCase(), origLang);
  const matcher = new QuoteMatcher();
  const origResult = matcher.findOriginalTokens(origChapters, quote, occurrence, qRef);

  if (!origResult.success) {
    return json({
      reference,
      language,
      quote,
      occurrence,
      original: [],
      gateway: [],
      note: origResult.error ?? "Quote not found in original language",
    });
  }

  const originalOut = origResult.totalTokens.map((t) => ({
    text: t.text,
    strong: t.strong ?? null,
    lemma: t.lemma ?? null,
    morph: t.morph ?? null,
    occurrence: t.occurrence ?? null,
    semanticId: t.id,
  }));

  // -------------------------------------------------------------------------
  // 3. Discover aligned gateway-language USFM (ULT, UST …) and match
  // -------------------------------------------------------------------------
  const gatewayEntries = await catalogSearch({
    lang: language,
    subject: "Aligned Bible",
    kv: env.TRANSLATION_HELPS_CACHE,
  });

  const gatewayOut: Array<{
    version: string;
    words: string[];
    aligned: string;
  }> = [];

  await Promise.allSettled(
    gatewayEntries.map(async (entry) => {
      const zipUrl = zipUrlFromEntry(entry);
      const zip = await fetcher.getOrDownloadZip(zipUrl);
      const bookPaths = buildBookPaths(entry, book, "", ".usfm");

      let usfm: string | null = null;
      for (const p of bookPaths) {
        usfm = await fetcher.extractFileFromZip(zip, p);
        if (usfm) break;
      }
      if (!usfm) return;

      const gwChapters = tokenizeUsfm(usfm, book.toUpperCase(), language);
      const alignResult = matcher.findAlignedTokens(origResult.totalTokens, gwChapters, qRef);

      if (alignResult.success && alignResult.totalAlignedTokens.length > 0) {
        const abbrev = entry.abbreviation ?? entry.repo.replace(/^[a-z]+_/, "");
        gatewayOut.push({
          version: abbrev,
          words: alignResult.totalAlignedTokens.map((t) => t.text),
          aligned: joinAlignedTokens(alignResult.totalAlignedTokens),
        });
      }
    }),
  );

  return json({
    reference,
    language,
    quote,
    occurrence,
    original: originalOut,
    gateway: gatewayOut,
  });
}
