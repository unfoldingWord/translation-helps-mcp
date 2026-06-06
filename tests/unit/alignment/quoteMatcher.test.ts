import { describe, it, expect } from "vitest";
import { QuoteMatcher } from "../../../src/core/alignment/quoteMatcher.js";
import { generateSemanticId } from "../../../src/core/alignment/semanticId.js";
import type { OptimizedChapter, OptimizedToken } from "../../../src/core/alignment/usfmTokenizer.js";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

const BOOK = "JHN";
const VERSE_REF = `${BOOK} 3:16`;

function makeOrigToken(text: string, occurrence = 1): OptimizedToken {
  return {
    id: generateSemanticId(text, VERSE_REF, occurrence),
    text,
    type: "word",
    occurrence,
  };
}

function makeAlignedToken(text: string, alignIds: number[]): OptimizedToken {
  return {
    id: Math.random() * 1000 | 0,
    text,
    type: "word",
    align: alignIds,
  };
}

function chapter(verses: { num: number; tokens: OptimizedToken[] }[]): OptimizedChapter {
  return {
    number: 3,
    verseCount: verses.length,
    paragraphCount: 0,
    verses: verses.map((v) => ({
      number: v.num,
      text: v.tokens.map((t) => t.text).join(" "),
      tokens: v.tokens,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QuoteMatcher", () => {
  const matcher = new QuoteMatcher();

  const ref = { book: BOOK, startChapter: 3, startVerse: 16, endVerse: 16 };

  describe("findOriginalTokens", () => {
    it("finds a simple single word quote", () => {
      const tokens = [makeOrigToken("Θεός"), makeOrigToken("ἀγαπάω"), makeOrigToken("κόσμος")];
      const chapters = [chapter([{ num: 16, tokens }])];

      const result = matcher.findOriginalTokens(chapters, "ἀγαπάω", 1, ref);
      expect(result.success).toBe(true);
      expect(result.totalTokens.length).toBe(1);
      expect(result.totalTokens[0].text).toBe("ἀγαπάω");
    });

    it("returns failure when quote not found", () => {
      const tokens = [makeOrigToken("Θεός")];
      const chapters = [chapter([{ num: 16, tokens }])];

      const result = matcher.findOriginalTokens(chapters, "missing", 1, ref);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("respects occurrence parameter for repeated words", () => {
      const tokens = [
        makeOrigToken("λόγος", 1),
        makeOrigToken("Θεός"),
        makeOrigToken("λόγος", 2),
      ];
      const chapters = [chapter([{ num: 16, tokens }])];

      const first = matcher.findOriginalTokens(chapters, "λόγος", 1, ref);
      const second = matcher.findOriginalTokens(chapters, "λόγος", 2, ref);

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(first.totalTokens[0].occurrence).toBe(1);
      expect(second.totalTokens[0].occurrence).toBe(2);
    });

    it("handles multi-part quotes with &", () => {
      const tokens = [
        makeOrigToken("Θεός"),
        makeOrigToken("ἀγαπάω"),
        makeOrigToken("κόσμος"),
        makeOrigToken("οὕτως"),
      ];
      const chapters = [chapter([{ num: 16, tokens }])];

      const result = matcher.findOriginalTokens(chapters, "Θεός & κόσμος", 1, ref);
      expect(result.success).toBe(true);
      expect(result.totalTokens.length).toBe(2);
      expect(result.totalTokens.map((t) => t.text)).toContain("Θεός");
      expect(result.totalTokens.map((t) => t.text)).toContain("κόσμος");
    });

    it("returns failure for empty quote", () => {
      const chapters = [chapter([{ num: 16, tokens: [makeOrigToken("test")] }])];
      const result = matcher.findOriginalTokens(chapters, "", 1, ref);
      expect(result.success).toBe(false);
    });

    it("returns failure for empty chapters", () => {
      const result = matcher.findOriginalTokens([], "test", 1, ref);
      expect(result.success).toBe(false);
    });
  });

  describe("findAlignedTokens", () => {
    it("finds aligned gateway tokens by semantic ID", () => {
      const origToken = makeOrigToken("Θεός");
      const gatewayToken = makeAlignedToken("God", [origToken.id]);
      const otherToken = makeAlignedToken("loved", [999]);

      const origChapters = [chapter([{ num: 16, tokens: [origToken] }])];
      const targetChapters = [chapter([{ num: 16, tokens: [gatewayToken, otherToken] }])];

      const origResult = matcher.findOriginalTokens(origChapters, "Θεός", 1, ref);
      expect(origResult.success).toBe(true);

      const alignResult = matcher.findAlignedTokens(origResult.totalTokens, targetChapters, ref);
      expect(alignResult.success).toBe(true);
      expect(alignResult.totalAlignedTokens.length).toBe(1);
      expect(alignResult.totalAlignedTokens[0].text).toBe("God");
    });

    it("returns empty aligned tokens when no alignment matches", () => {
      const origToken = makeOrigToken("Θεός");
      const gatewayToken = makeAlignedToken("world", [999]); // wrong ID

      const origChapters = [chapter([{ num: 16, tokens: [origToken] }])];
      const targetChapters = [chapter([{ num: 16, tokens: [gatewayToken] }])];

      const origResult = matcher.findOriginalTokens(origChapters, "Θεός", 1, ref);
      const alignResult = matcher.findAlignedTokens(origResult.totalTokens, targetChapters, ref);

      expect(alignResult.success).toBe(true);
      expect(alignResult.totalAlignedTokens.length).toBe(0);
    });
  });
});
