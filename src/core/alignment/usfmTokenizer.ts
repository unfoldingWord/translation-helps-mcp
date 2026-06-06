/**
 * src/core/alignment/usfmTokenizer.ts
 *
 * Lightweight regex-based USFM alignment tokenizer.
 *
 * Produces OptimizedToken arrays from raw USFM strings without requiring
 * usfm-js. Handles two document types:
 *
 *   "original"  — UHB / UGNT USFM with \w tags carrying x-strong, x-lemma,
 *                 x-morph, x-occurrence attributes.
 *   "aligned"   — ULT / UST USFM with \zaln-s milestones wrapping \w tags;
 *                 the milestone carries the original-language semantic IDs.
 *
 * The output types mirror the OptimizedToken / OptimizedChapter interfaces
 * from bt-synergy so that QuoteMatcher can be ported unchanged.
 */

import { generateSemanticId } from "./semanticId.js";

// ---------------------------------------------------------------------------
// Public types (mirrors bt-synergy usfm-processor OptimizedToken etc.)
// ---------------------------------------------------------------------------

export interface OptimizedToken {
  id: number;
  text: string;
  type: "word" | "punctuation" | "number" | "whitespace" | "paragraph-marker";
  /** Semantic IDs of the original-language tokens this token aligns to (aligned lang only). */
  align?: number[];
  strong?: string;
  lemma?: string;
  morph?: string;
  occurrence?: number;
}

export interface OptimizedVerse {
  number: number;
  text: string;
  tokens: OptimizedToken[];
}

export interface OptimizedChapter {
  number: number;
  verseCount: number;
  paragraphCount: number;
  verses: OptimizedVerse[];
}

// ---------------------------------------------------------------------------
// Attribute extraction helpers
// ---------------------------------------------------------------------------

function attr(markup: string, name: string): string {
  const m = markup.match(new RegExp(`x-${name}="([^"]*)"`, "i"));
  if (m) return m[1];
  // Also try without the x- prefix (some resources use plain strong=...)
  const m2 = markup.match(new RegExp(`(?:^| )${name}="([^"]*)"`, "i"));
  return m2 ? m2[1] : "";
}

// ---------------------------------------------------------------------------
// Hebrew / Greek text normalisation (same logic as QuoteMatcher.normalizeText)
// ---------------------------------------------------------------------------

function isHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text);
}

export function normalizeTokenText(text: string): string {
  if (isHebrew(text)) {
    return text
      .replace(/־/g, " ")
      .replace(/[׃׀]/g, "")
      .replace(/[\u0591-\u05AF\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/g, "")
      .replace(/[\u05B0\u05B1\u05B4\u05B5\u05B8\u05B9\u05BB\u05BC]/g, "")
      .replace(/⁠/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Chapter / verse extraction from USFM
// ---------------------------------------------------------------------------

/**
 * Split raw USFM into a map of chapter number → chapter text.
 */
function splitIntoChapters(usfm: string): Map<number, string> {
  const chapters = new Map<number, string>();
  const parts = usfm.split(/(?=\\c\s+\d+)/);
  for (const part of parts) {
    const m = part.match(/^\\c\s+(\d+)/);
    if (!m) continue;
    chapters.set(parseInt(m[1], 10), part);
  }
  return chapters;
}

/**
 * Split a chapter USFM block into a map of verse number → verse text.
 */
function splitIntoVerses(chapterUsfm: string): Map<number, string> {
  const verses = new Map<number, string>();
  const parts = chapterUsfm.split(/(?=\\v\s+\d+)/);
  for (const part of parts) {
    const m = part.match(/^\\v\s+(\d+)/);
    if (!m) continue;
    verses.set(parseInt(m[1], 10), part);
  }
  return verses;
}

// ---------------------------------------------------------------------------
// Token parsers
// ---------------------------------------------------------------------------

/**
 * Parse tokens from an original-language verse (UGNT/UHB).
 * Expects \w … \w* style markup.
 *
 * The verseRef format expected by the QuoteMatcher is e.g. "JHN 3:16".
 */
function parseOriginalVerseTokens(
  verseUsfm: string,
  verseRef: string,
): OptimizedToken[] {
  const tokens: OptimizedToken[] = [];
  // Match \w word|attrs\w*
  const wordRe = /\\w\s+([^|\\]+)(?:\|([^\\]*))?\\w\*/g;
  let m: RegExpExecArray | null;

  // Track occurrence counts per normalised word
  const occurrenceCounts = new Map<string, number>();

  while ((m = wordRe.exec(verseUsfm)) !== null) {
    const wordText = m[1].trim();
    const markup = m[2] ?? "";

    const normalised = wordText.toLowerCase().trim();
    const count = (occurrenceCounts.get(normalised) ?? 0) + 1;
    occurrenceCounts.set(normalised, count);

    // Use x-occurrence if present, else derived count
    const xOcc = markup ? parseInt(attr(markup, "occurrence") || "0", 10) : 0;
    const occurrence = xOcc > 0 ? xOcc : count;

    const id = generateSemanticId(wordText, verseRef, occurrence);

    tokens.push({
      id,
      text: wordText,
      type: "word",
      strong: attr(markup, "strong"),
      lemma: attr(markup, "lemma"),
      morph: attr(markup, "morph"),
      occurrence,
    });
  }

  return tokens;
}

/**
 * Parse tokens from an aligned-language verse (ULT/UST).
 * Expects \zaln-s … \w … \w* … \zaln-e\* style markup.
 *
 * Each gateway word token receives an `align` array containing the
 * semantic IDs of the original tokens it is aligned to.
 */
function parseAlignedVerseTokens(
  verseUsfm: string,
  verseRef: string,
): OptimizedToken[] {
  const tokens: OptimizedToken[] = [];
  let i = 0;
  let tokenId = 1;

  // Current stack of alignment semantic IDs (handles nested \zaln)
  const alignStack: number[][] = [];

  // Patterns
  const zalnStartRe = /\\zaln-s\s*\|([^\\]*)\\\*/;
  const zalnEndRe = /\\zaln-e\\\*/;
  const wordRe = /\\w\s+([^|\\]+)(?:\|([^\\]*))?\\w\*/;

  while (i < verseUsfm.length) {
    // --- \zaln-s ---
    const zalnStartMatch = verseUsfm.slice(i).match(/^\\zaln-s\s*\|([^\\]*)\\\*/);
    if (zalnStartMatch) {
      const markup = zalnStartMatch[1];
      const content = attr(markup, "lemma") || attr(markup, "morph").split(",")[0] || "";
      const occurrence = parseInt(attr(markup, "occurrence") || "1", 10);
      const origWord = content; // use lemma as the canonical form
      const semanticId = generateSemanticId(
        attr(markup, "content") || origWord || "?",
        verseRef,
        occurrence,
      );
      // Start a new alignment group with this semantic ID
      alignStack.push([...(alignStack[alignStack.length - 1] ?? []), semanticId]);
      i += zalnStartMatch[0].length;
      continue;
    }

    // --- \zaln-e\* ---
    const zalnEndMatch = verseUsfm.slice(i).match(/^\\zaln-e\\\*/);
    if (zalnEndMatch) {
      alignStack.pop();
      i += zalnEndMatch[0].length;
      continue;
    }

    // --- \w word|attrs\w* ---
    const wordMatch = verseUsfm.slice(i).match(/^\\w\s+([^|\\]+)(?:\|([^\\]*))?\\w\*/);
    if (wordMatch) {
      const wordText = wordMatch[1].trim();
      const currentAlignIds = alignStack[alignStack.length - 1] ?? [];

      tokens.push({
        id: tokenId++,
        text: wordText,
        type: "word",
        align: currentAlignIds.length > 0 ? [...currentAlignIds] : undefined,
      });
      i += wordMatch[0].length;
      continue;
    }

    i++;
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Detect document type
// ---------------------------------------------------------------------------

type DocType = "original" | "aligned" | "plain";

function detectDocType(usfm: string): DocType {
  if (/\\zaln-s/.test(usfm)) return "aligned";
  if (/\\w\s+[^|\\]+(?:\|[^\\]*)?\\w\*/.test(usfm)) return "original";
  return "plain";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Tokenize a USFM string into an array of {@link OptimizedChapter}s.
 *
 * @param usfm     Raw USFM string (aligned ULT/UST or original UGNT/UHB)
 * @param book     Book code for verse references (e.g. "JHN")
 * @param language Language code for labeling (e.g. "en")
 * @returns        Array of chapter objects with verse token arrays
 */
export function tokenizeUsfm(
  usfm: string,
  book: string,
  language = "",
): OptimizedChapter[] {
  const docType = detectDocType(usfm);
  const chapterMap = splitIntoChapters(usfm);

  const chapters: OptimizedChapter[] = [];

  for (const [chapterNum, chapterUsfm] of chapterMap) {
    const verseMap = splitIntoVerses(chapterUsfm);
    const verses: OptimizedVerse[] = [];

    for (const [verseNum, verseUsfm] of verseMap) {
      const verseRef = `${book} ${chapterNum}:${verseNum}`;

      let tokens: OptimizedToken[];
      if (docType === "original") {
        tokens = parseOriginalVerseTokens(verseUsfm, verseRef);
      } else if (docType === "aligned") {
        tokens = parseAlignedVerseTokens(verseUsfm, verseRef);
      } else {
        tokens = [];
      }

      if (tokens.length === 0) continue;

      // Build plain text from word tokens
      const text = tokens
        .filter((t) => t.type === "word")
        .map((t) => t.text)
        .join(" ");

      verses.push({ number: verseNum, text, tokens });
    }

    chapters.push({
      number: chapterNum,
      verseCount: verses.length,
      paragraphCount: 0,
      verses,
    });
  }

  return chapters;
}

// ---------------------------------------------------------------------------
// Per-request token model cache (avoids N+1 re-parses)
// ---------------------------------------------------------------------------

/** Key = `${resource}:${book}:${version}` */
const TOKEN_MODEL_CACHE = new Map<
  string,
  { chapters: OptimizedChapter[]; ts: number }
>();
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Return a cached token model or parse the USFM and cache the result.
 * Parse-once semantics: subsequent calls with the same key return immediately.
 */
export function getOrParseTokenModel(
  cacheKey: string,
  usfm: string,
  book: string,
  language?: string,
): OptimizedChapter[] {
  const now = Date.now();
  const cached = TOKEN_MODEL_CACHE.get(cacheKey);
  if (cached && now - cached.ts < TOKEN_CACHE_TTL_MS) {
    return cached.chapters;
  }

  const chapters = tokenizeUsfm(usfm, book, language);
  TOKEN_MODEL_CACHE.set(cacheKey, { chapters, ts: now });

  // Evict old entries
  if (TOKEN_MODEL_CACHE.size > 50) {
    const oldestKey = TOKEN_MODEL_CACHE.keys().next().value;
    if (oldestKey) TOKEN_MODEL_CACHE.delete(oldestKey);
  }

  return chapters;
}
