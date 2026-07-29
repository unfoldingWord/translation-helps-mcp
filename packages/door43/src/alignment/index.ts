export { generateSemanticId } from "./semanticId.js";
export {
  tokenizeUsfm,
  getOrParseTokenModel,
  normalizeTokenText,
} from "./usfmTokenizer.js";
export type {
  OptimizedToken,
  OptimizedVerse,
  OptimizedChapter,
} from "./usfmTokenizer.js";
export { QuoteMatcher } from "./quoteMatcher.js";
export type {
  QuoteReference,
  QuoteMatch,
  QuoteMatchResult,
  AlignedTokenMatch,
  AlignmentMatchResult,
} from "./quoteMatcher.js";

/**
 * Convert a raw USFM quote string (with `&` separators for discontiguous spans)
 * to a human-readable display string with `…` separators.
 */
export function formatQuoteDisplay(raw: string): string {
  if (!raw) return raw;
  return raw
    .split("&")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" … ");
}
