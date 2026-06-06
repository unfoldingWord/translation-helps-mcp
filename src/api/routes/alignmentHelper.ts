/**
 * src/api/routes/alignmentHelper.ts
 *
 * Batch-compute gateway (aligned) quotes for a list of note/word-link rows.
 *
 * Fetches the original-language USFM (UGNT/UHB) and the first aligned
 * strategic-language USFM (ULT) ONCE per request, then runs QuoteMatcher
 * against the in-memory token models for every row.
 *
 * Returns a Map from `${chapter}:${verse}:${quote}:${occurrence}` to the
 * aligned gateway text (deduped, ellipsis-separated for gaps).
 *
 * On any error the map entry is left absent; callers default to "".
 */

import type { Env } from "../worker.js";
import { makeFetcher, buildBookPaths, zipUrlFromEntry } from "./helpers.js";
import { catalogSearch } from "../../core/resources/dcsClient.js";
import { tokenizeUsfm, QuoteMatcher } from "../../core/alignment/index.js";
import type { QuoteReference, OptimizedToken } from "../../core/alignment/index.js";

// ---------------------------------------------------------------------------
// Public helpers for quote display
// ---------------------------------------------------------------------------

/**
 * Join aligned gateway tokens into a display string.
 *
 * - Deduplicates by token `id` (same id = same gateway word; prevents "God God"
 *   when multiple original tokens align to the same target word).
 * - Sorts by ascending `id` (word-position order).
 * - Inserts `…` between runs where `id` gap > 1 (discontiguous span).
 * - Joins contiguous tokens with a single space.
 */
export function joinAlignedTokens(tokens: OptimizedToken[]): string {
  if (tokens.length === 0) return "";

  // Dedup by id
  const seen = new Set<number>();
  const unique = tokens.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  // Sort ascending by word position
  unique.sort((a, b) => a.id - b.id);

  const parts: string[] = [];
  let prevId: number | null = null;

  for (const tok of unique) {
    if (prevId !== null && tok.id - prevId > 1) {
      parts.push("…");
    }
    parts.push(tok.text);
    prevId = tok.id;
  }

  return parts.join(" ").replace(/ … /g, " … ").replace(/\s+/g, " ").trim();
}

/**
 * Convert a raw original-language quote string (which may contain `&`
 * separators for discontiguous spans) to a human-readable display string
 * with `…` separators.
 *
 * The raw value (with `&`) is kept for `QuoteMatcher` and alignment-key
 * purposes — only the display copy shown in `gatewayQuote.original` changes.
 */
export function formatQuoteDisplay(raw: string): string {
  if (!raw) return raw;
  return raw
    .split("&")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" … ");
}

// ---------------------------------------------------------------------------

const NT_BOOKS = new Set([
  "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL",
  "1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN",
  "3JN","JUD","REV",
]);

function isNtBook(book: string): boolean {
  return NT_BOOKS.has(book.toUpperCase());
}

export interface AlignmentRow {
  chapter: string;
  verse: string;
  quote: string;     // original language quote (from TN `quote` or TWL `origWords`)
  occurrence: string;
}

/**
 * Load, tokenize, and batch-match aligned gateway quotes for `rows`.
 *
 * @param rows     Note/word-link rows that have a `quote` and `occurrence`.
 * @param book     USFM book code (uppercase, e.g. "JHN").
 * @param language Strategic language code for the aligned version (e.g. "en").
 * @param env      Worker environment with cache bindings.
 * @returns        Map from key `"ch:v:quote:occ"` → joined gateway words string.
 */
export async function batchGatewayQuotes(
  rows: AlignmentRow[],
  book: string,
  language: string,
  env: Env,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Only rows with a non-trivial quote
  const active = rows.filter((r) => r.quote && r.quote.trim().length > 0 && r.verse !== "intro");
  if (active.length === 0) return result;

  const fetcher = makeFetcher(env);
  const upperBook = book.toUpperCase();
  const isNt = isNtBook(upperBook);

  // -------------------------------------------------------------------------
  // 1. Fetch and tokenize the original-language USFM (UGNT or UHB)
  // -------------------------------------------------------------------------
  const origSubject = isNt ? "Greek New Testament" : "Hebrew Old Testament";
  const origLang = isNt ? "el-x-koine" : "hbo";

  let origChapters;
  try {
    const origEntries = await catalogSearch({
      lang: origLang,
      subject: origSubject,
      kv: env.TRANSLATION_HELPS_CACHE,
    });
    if (origEntries.length === 0) return result;

    const origEntry = origEntries[0];
    const origZip = await fetcher.getOrDownloadZip(zipUrlFromEntry(origEntry));
    const origPaths = buildBookPaths(origEntry, upperBook, "", ".usfm");

    let origUsfm: string | null = null;
    for (const p of origPaths) {
      origUsfm = await fetcher.extractFileFromZip(origZip, p);
      if (origUsfm) break;
    }
    if (!origUsfm) return result;

    origChapters = tokenizeUsfm(origUsfm, upperBook, origLang);
  } catch {
    return result;
  }

  // -------------------------------------------------------------------------
  // 2. Fetch and tokenize the aligned strategic-language USFM (first ULT/UGT)
  // -------------------------------------------------------------------------
  let alignedChapters;
  try {
    const alignedEntries = await catalogSearch({
      lang: language,
      subject: "Aligned Bible",
      kv: env.TRANSLATION_HELPS_CACHE,
    });
    if (alignedEntries.length === 0) return result;

    const alignedEntry = alignedEntries[0];
    const alignedZip = await fetcher.getOrDownloadZip(zipUrlFromEntry(alignedEntry));
    const alignedPaths = buildBookPaths(alignedEntry, upperBook, "", ".usfm");

    let alignedUsfm: string | null = null;
    for (const p of alignedPaths) {
      alignedUsfm = await fetcher.extractFileFromZip(alignedZip, p);
      if (alignedUsfm) break;
    }
    if (!alignedUsfm) return result;

    alignedChapters = tokenizeUsfm(alignedUsfm, upperBook, language);
  } catch {
    return result;
  }

  // -------------------------------------------------------------------------
  // 3. Match all rows in-memory (no additional network calls)
  // -------------------------------------------------------------------------
  const matcher = new QuoteMatcher();

  for (const row of active) {
    const chNum = parseInt(row.chapter, 10);
    const vNum = parseInt(row.verse, 10);
    const occ = parseInt(row.occurrence || "1", 10);
    if (isNaN(chNum) || isNaN(vNum)) continue;

    const qRef: QuoteReference = {
      book: upperBook,
      startChapter: chNum,
      startVerse: vNum,
      endVerse: vNum,
    };

    try {
      const origResult = matcher.findOriginalTokens(origChapters, row.quote, occ, qRef);
      if (!origResult.success || origResult.totalTokens.length === 0) continue;

      const alignResult = matcher.findAlignedTokens(origResult.totalTokens, alignedChapters, qRef);
      if (!alignResult.success || alignResult.totalAlignedTokens.length === 0) continue;

      const aligned = joinAlignedTokens(alignResult.totalAlignedTokens);
      const key = `${row.chapter}:${row.verse}:${row.quote}:${row.occurrence}`;
      result.set(key, aligned);
    } catch {
      // Silently skip rows that fail — alignment is best-effort
    }
  }

  return result;
}

/** Build a consistent lookup key from a row. */
export function alignmentKey(row: AlignmentRow): string {
  return `${row.chapter}:${row.verse}:${row.quote}:${row.occurrence}`;
}
