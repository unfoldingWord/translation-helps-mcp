import { describe, it, expect } from "vitest";
import { tokenizeUsfm } from "../../../src/core/alignment/usfmTokenizer.js";

// ---------------------------------------------------------------------------
// Minimal USFM fixtures
// ---------------------------------------------------------------------------

const ORIGINAL_LANG_USFM = `\\id JHN
\\c 1
\\v 1 \\w Ἐν|x-strong="G17220" x-lemma="ἐν" x-morph="Gr,P,,,,D,,," x-occurrence="1" x-occurrences="2"\\w* \\w ἀρχῇ|x-strong="G07460" x-lemma="ἀρχή" x-morph="Gr,N,,,,,DFS," x-occurrence="1" x-occurrences="1"\\w*
\\v 2 \\w οὗτος|x-strong="G37780" x-lemma="οὗτος" x-morph="Gr,RD,,,,NMS," x-occurrence="1" x-occurrences="1"\\w*`;

const ALIGNED_LANG_USFM = `\\id JHN
\\c 1
\\v 1 \\zaln-s |x-strong="G17220" x-lemma="ἐν" x-occurrence="1" x-occurrences="2" x-content="Ἐν"\\*\\w In|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\* \\zaln-s |x-strong="G07460" x-lemma="ἀρχή" x-occurrence="1" x-occurrences="1" x-content="ἀρχῇ"\\*\\w the|x-occurrence="1" x-occurrences="1"\\w* \\w beginning|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*`;

describe("tokenizeUsfm", () => {
  describe("original language (UGNT style)", () => {
    it("parses chapters and verses", () => {
      const chapters = tokenizeUsfm(ORIGINAL_LANG_USFM, "JHN");
      expect(chapters.length).toBe(1);
      expect(chapters[0].number).toBe(1);
      expect(chapters[0].verses.length).toBe(2);
    });

    it("tokenizes words with strong numbers", () => {
      const chapters = tokenizeUsfm(ORIGINAL_LANG_USFM, "JHN");
      const v1 = chapters[0].verses[0];
      expect(v1.tokens.length).toBeGreaterThanOrEqual(2);
      expect(v1.tokens[0].text).toBe("Ἐν");
      expect(v1.tokens[0].strong).toContain("G1722");
      expect(v1.tokens[0].type).toBe("word");
    });

    it("assigns deterministic semantic IDs", () => {
      const chapters = tokenizeUsfm(ORIGINAL_LANG_USFM, "JHN");
      const v1 = chapters[0].verses[0];
      const token = v1.tokens[0];
      expect(typeof token.id).toBe("number");
      expect(token.id).toBeGreaterThanOrEqual(0);
    });
  });

  describe("aligned language (ULT style)", () => {
    it("parses chapters and verses", () => {
      const chapters = tokenizeUsfm(ALIGNED_LANG_USFM, "JHN");
      expect(chapters.length).toBe(1);
      expect(chapters[0].verses.length).toBeGreaterThanOrEqual(1);
    });

    it("assigns alignment IDs to gateway tokens", () => {
      const chapters = tokenizeUsfm(ALIGNED_LANG_USFM, "JHN");
      const v1 = chapters[0].verses[0];
      const wordTokens = v1.tokens.filter((t) => t.type === "word");
      // "In" should have an align array
      expect(wordTokens.length).toBeGreaterThanOrEqual(1);
      const withAlign = wordTokens.filter((t) => t.align && t.align.length > 0);
      expect(withAlign.length).toBeGreaterThan(0);
    });
  });

  describe("empty/invalid input", () => {
    it("returns empty array for empty string", () => {
      const chapters = tokenizeUsfm("", "JHN");
      expect(chapters).toEqual([]);
    });

    it("produces no verse tokens for USFM with no verse markers", () => {
      const chapters = tokenizeUsfm("\\id JHN\n\\c 1\n\\p", "JHN");
      // A chapter with no \\v markers produces zero verses in its verses array
      const totalVerses = chapters.reduce((s, c) => s + c.verses.length, 0);
      expect(totalVerses).toBe(0);
    });
  });
});
