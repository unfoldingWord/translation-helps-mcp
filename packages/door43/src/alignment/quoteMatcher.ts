/**
 * src/core/alignment/quoteMatcher.ts
 *
 * Quote matching system for original-language texts.
 * Ported from bt-synergy: packages/resource-parsers/src/utils/quote-matcher.ts
 *
 * Given a TSV `quote` field and `occurrence` number:
 *   STEP 1: Find the original-language tokens (UGNT/UHB) that match.
 *   STEP 2: Find the aligned gateway-language tokens (ULT/UST) that map to them.
 *
 * Multi-part quotes (separated by `&`) are supported.
 */

import type {
  OptimizedChapter,
  OptimizedToken,
  OptimizedVerse,
} from "./usfmTokenizer.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QuoteReference {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter?: number;
  endVerse?: number;
}

export interface QuoteMatch {
  quote: string;
  occurrence: number;
  tokens: OptimizedToken[];
  verseRef: string;
  startPosition: number;
  endPosition: number;
}

export interface QuoteMatchResult {
  success: boolean;
  matches: QuoteMatch[];
  totalTokens: OptimizedToken[];
  error?: string;
}

export interface AlignedTokenMatch {
  originalToken: OptimizedToken;
  alignedTokens: OptimizedToken[];
  verseRef: string;
}

export interface AlignmentMatchResult {
  success: boolean;
  alignedMatches: AlignedTokenMatch[];
  totalAlignedTokens: OptimizedToken[];
  error?: string;
}

// ---------------------------------------------------------------------------
// QuoteMatcher class
// ---------------------------------------------------------------------------

export class QuoteMatcher {
  /**
   * STEP 1: Find original-language tokens matching a TSV `quote` field.
   *
   * - Splits on `&` to handle multi-part quotes.
   * - First part uses the supplied `occurrence`; subsequent parts use 1.
   */
  findOriginalTokens(
    chapters: OptimizedChapter[],
    quote: string,
    occurrence: number,
    reference: QuoteReference,
  ): QuoteMatchResult {
    try {
      if (!quote || quote.trim().length === 0) {
        return {
          success: false,
          matches: [],
          totalTokens: [],
          error: "Quote cannot be empty",
        };
      }

      const quotes = quote
        .split("&")
        .map((q) => q.trim())
        .filter((q) => q.length > 0);

      if (quotes.length === 0) {
        return {
          success: false,
          matches: [],
          totalTokens: [],
          error: "No valid quotes found after parsing",
        };
      }

      const verses = this.getVersesInRange(chapters, reference);

      if (verses.length === 0) {
        return {
          success: false,
          matches: [],
          totalTokens: [],
          error: `No verses found in range ${this.formatReference(reference)}`,
        };
      }

      const matches: QuoteMatch[] = [];
      let searchStartVerse = 0;
      let searchStartPosition = 0;

      for (let i = 0; i < quotes.length; i++) {
        const currentQuote = quotes[i];
        const targetOccurrence = i === 0 ? occurrence : 1;

        const match = this.findSingleQuoteMatch(
          verses,
          currentQuote,
          targetOccurrence,
          searchStartVerse,
          searchStartPosition,
          reference,
        );

        if (!match) {
          return {
            success: false,
            matches: [],
            totalTokens: [],
            error: `Quote "${currentQuote}" (occurrence ${targetOccurrence}) not found in ${this.formatReference(reference)}`,
          };
        }

        matches.push(match);

        const matchVerseIndex = this.getVerseIndex(verses, match.verseRef);
        if (matchVerseIndex === searchStartVerse) {
          searchStartPosition = match.endPosition;
        } else {
          searchStartVerse = matchVerseIndex + 1;
          searchStartPosition = 0;
        }
      }

      return {
        success: true,
        matches,
        totalTokens: matches.flatMap((m) => m.tokens),
      };
    } catch (err) {
      return {
        success: false,
        matches: [],
        totalTokens: [],
        error: `Error processing quote: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * STEP 2: Find aligned gateway tokens corresponding to original tokens.
   */
  findAlignedTokens(
    originalTokens: OptimizedToken[],
    targetChapters: OptimizedChapter[],
    reference: QuoteReference,
  ): AlignmentMatchResult {
    try {
      const alignedMatches: AlignedTokenMatch[] = [];
      const targetVerses = this.getVersesInRange(targetChapters, reference);

      for (const originalToken of originalTokens) {
        const originalVerseRef = this.constructVerseRef(reference);
        const targetVerse = this.findCorrespondingVerse(
          targetVerses,
          originalVerseRef,
        );

        if (!targetVerse?.tokens) continue;

        const alignedTokens = this.findAlignedTokensInVerse(
          originalToken,
          targetVerse,
        );

        if (alignedTokens.length > 0) {
          alignedMatches.push({
            originalToken,
            alignedTokens,
            verseRef: originalVerseRef,
          });
        }
      }

      return {
        success: true,
        alignedMatches,
        totalAlignedTokens: alignedMatches.flatMap((m) => m.alignedTokens),
      };
    } catch (err) {
      return {
        success: false,
        alignedMatches: [],
        totalAlignedTokens: [],
        error: `Error finding aligned tokens: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private findSingleQuoteMatch(
    verses: OptimizedVerse[],
    quote: string,
    occurrence: number,
    startVerseIndex: number,
    startPosition: number,
    reference: QuoteReference,
  ): QuoteMatch | null {
    const normalizedQuote = this.normalizeText(quote);
    let foundOccurrences = 0;

    for (let i = startVerseIndex; i < verses.length; i++) {
      const verse = verses[i];
      if (!verse.tokens?.length) continue;

      const wordTokens = verse.tokens.filter((t) => t.type === "word");
      const verseText = wordTokens
        .map((t) => this.normalizeText(t.text))
        .join(" ");

      const occurrences = this.findQuoteOccurrencesInText(
        verseText,
        normalizedQuote,
      );

      for (const occ of occurrences) {
        if (i === startVerseIndex && occ.start < startPosition) continue;

        foundOccurrences++;
        if (foundOccurrences === occurrence) {
          const tokens = this.extractTokensForMatch(verse, occ.start, occ.end);
          return {
            quote,
            occurrence,
            tokens,
            verseRef: `${reference.book} ${reference.startChapter}:${verse.number}`,
            startPosition: occ.start,
            endPosition: occ.end,
          };
        }
      }
    }

    return null;
  }

  private findQuoteOccurrencesInText(
    text: string,
    quote: string,
  ): { start: number; end: number }[] {
    const matches: { start: number; end: number }[] = [];
    if (!quote) return matches;

    let startIndex = 0;
    for (;;) {
      const index = text.indexOf(quote, startIndex);
      if (index === -1) break;
      matches.push({ start: index, end: index + quote.length });
      startIndex = index + 1;
    }

    if (matches.length === 0 && this.isHebrewText(quote)) {
      matches.push(...this.findFlexibleHebrewMatches(text, quote));
    }

    return matches;
  }

  private findFlexibleHebrewMatches(
    text: string,
    quote: string,
  ): { start: number; end: number }[] {
    const quoteWords = quote.split(/\s+/).filter((w) => w.length > 0);
    if (quoteWords.length === 0) return [];

    const textWords: { word: string; start: number; end: number }[] = [];
    let currentPos = 0;
    for (const word of text.split(/\s+/)) {
      const ws = text.indexOf(word, currentPos);
      if (ws !== -1) {
        textWords.push({ word, start: ws, end: ws + word.length });
        currentPos = ws + word.length;
      }
    }

    const foundWords = quoteWords
      .map((qw) =>
        textWords.find(
          (tw) => this.normalizeText(tw.word) === this.normalizeText(qw),
        ),
      )
      .filter(Boolean) as typeof textWords;

    if (foundWords.length !== quoteWords.length) return [];
    foundWords.sort((a, b) => a.start - b.start);
    return [
      {
        start: foundWords[0].start,
        end: foundWords[foundWords.length - 1].end,
      },
    ];
  }

  private extractTokensForMatch(
    verse: OptimizedVerse,
    startPos: number,
    endPos: number,
  ): OptimizedToken[] {
    if (!verse.tokens) return [];
    const wordTokens = verse.tokens.filter((t) => t.type === "word");
    const tokens: OptimizedToken[] = [];
    let currentPos = 0;
    const occurrenceCounts = new Map<string, number>();

    for (let i = 0; i < wordTokens.length; i++) {
      const token = wordTokens[i];
      const tokenText = this.normalizeText(token.text);
      const tokenStart = currentPos;
      const tokenEnd = currentPos + tokenText.length;

      const count = (occurrenceCounts.get(token.text) ?? 0) + 1;
      occurrenceCounts.set(token.text, count);

      if (tokenEnd > startPos && tokenStart < endPos) {
        tokens.push({ ...token, occurrence: count });
      }

      currentPos = tokenEnd + (i < wordTokens.length - 1 ? 1 : 0);
    }

    return tokens;
  }

  private constructVerseRef(reference: QuoteReference): string {
    return `${reference.book} ${reference.startChapter}:${reference.startVerse}`;
  }

  private findAlignedTokensInVerse(
    originalToken: OptimizedToken,
    targetVerse: OptimizedVerse,
  ): OptimizedToken[] {
    return (targetVerse.tokens ?? []).filter(
      (t) => t.align && t.align.includes(originalToken.id),
    );
  }

  private getVersesInRange(
    chapters: OptimizedChapter[],
    reference: QuoteReference,
  ): OptimizedVerse[] {
    const verses: OptimizedVerse[] = [];
    const endChapter = reference.endChapter ?? reference.startChapter;
    const endVerse = reference.endVerse ?? reference.startVerse;

    for (const chapter of chapters) {
      if (
        chapter.number < reference.startChapter ||
        chapter.number > endChapter
      )
        continue;

      for (const verse of chapter.verses) {
        if (reference.startChapter === endChapter) {
          if (
            verse.number >= reference.startVerse &&
            verse.number <= endVerse
          ) {
            verses.push(verse);
          }
        } else if (chapter.number === reference.startChapter) {
          if (verse.number >= reference.startVerse) verses.push(verse);
        } else if (chapter.number === endChapter) {
          if (verse.number <= endVerse) verses.push(verse);
        } else {
          verses.push(verse); // Middle chapter
        }
      }
    }

    return verses;
  }

  private findCorrespondingVerse(
    verses: OptimizedVerse[],
    verseRef: string,
  ): OptimizedVerse | null {
    const parts = verseRef.split(" ");
    if (parts.length !== 2) return null;
    const verseNum = parseInt(parts[1].split(":")[1], 10);
    return verses.find((v) => v.number === verseNum) ?? null;
  }

  private getVerseIndex(verses: OptimizedVerse[], verseRef: string): number {
    const parts = verseRef.split(" ");
    if (parts.length !== 2) return -1;
    const verseNum = parseInt(parts[1].split(":")[1], 10);
    return verses.findIndex((v) => v.number === verseNum);
  }

  private normalizeText(text: string): string {
    if (this.isHebrewText(text)) return this.normalizeHebrewText(text);
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isHebrewText(text: string): boolean {
    return /[\u0590-\u05FF]/.test(text);
  }

  private normalizeHebrewText(text: string): string {
    return text
      .replace(/־/g, " ")
      .replace(/[׃׀]/g, "")
      .replace(
        /[\u0591-\u05AF\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/g,
        "",
      )
      .replace(/[\u05B0\u05B1\u05B4\u05B5\u05B8\u05B9\u05BB\u05BC]/g, "")
      .replace(/⁠/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  private formatReference(reference: QuoteReference): string {
    const { book, startChapter, startVerse, endChapter, endVerse } = reference;
    if (endChapter && endChapter !== startChapter) {
      return `${book} ${startChapter}:${startVerse}-${endChapter}:${endVerse ?? ""}`;
    }
    if (endVerse && endVerse !== startVerse) {
      return `${book} ${startChapter}:${startVerse}-${endVerse}`;
    }
    return `${book} ${startChapter}:${startVerse}`;
  }
}
