/**
 * Unit tests for parseTranslationNotesTsv
 *
 * Critical regression coverage: context notes (front:intro and {chapter}:intro)
 * MUST be included in the results whenever a verse-level query is made, so that
 * get_passage_context always has book and chapter introductions available.
 */

import { describe, it, expect } from "vitest";
import { parseTranslationNotesTsv } from "../../src/core/parsers/tsv.js";

// Minimal TN TSV fixture in the new Reference format
const FIXTURE_NEW = [
  "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote",
  "front:intro\tt6za\t\t\t\t0\t# Introduction to John\n\nBook intro text here.",
  "3:intro\tjav2\t\t\t\t0\t# John 3 Chapter Introduction\n\nChapter 3 overview.",
  "3:16\tvg6z\t\t\tγὰρ\t1\tHere **For** introduces a reason.",
  "3:17\tabc1\t\t\tγὰρ\t1\tAnother verse note.",
  "4:1\txyz9\t\t\tτότε\t1\tChapter 4 note.",
].join("\n");

// Minimal TN TSV fixture in the old Book/Chapter/Verse format
const FIXTURE_OLD = [
  "Book\tChapter\tVerse\tID\tSupportReference\tQuote\tOccurrence\tNote",
  "JHN\tfront\tintro\tt6za\t\t\t0\tBook intro text.",
  "JHN\t3\tintro\tjav2\t\t\t0\tChapter 3 overview.",
  "JHN\t3\t16\tvg6z\t\t\t1\tVerse note for 3:16.",
  "JHN\t3\t17\tabc1\t\t\t1\tVerse note for 3:17.",
  "JHN\t4\t1\txyz9\t\t\t1\tChapter 4 note.",
].join("\n");

describe("parseTranslationNotesTsv — context note inclusion", () => {
  describe("new Reference format", () => {
    it("includes front:intro and chapter:intro when querying a specific verse", () => {
      const rows = parseTranslationNotesTsv(FIXTURE_NEW, "3", "16");
      const refs = rows.map((r) => `${r.chapter}:${r.verse}`);
      expect(refs).toContain("front:intro");
      expect(refs).toContain("3:intro");
      expect(refs).toContain("3:16");
    });

    it("does NOT include front:intro or chapter:intro when chapter doesn't match", () => {
      const rows = parseTranslationNotesTsv(FIXTURE_NEW, "4");
      const refs = rows.map((r) => `${r.chapter}:${r.verse}`);
      expect(refs).toContain("front:intro"); // book intro always included
      expect(refs).not.toContain("3:intro"); // wrong chapter
      expect(refs).toContain("4:1");
    });

    it("includes front:intro even when verse filter is set to non-matching chapter", () => {
      // If chapter is "2" (which has no notes in fixture), front:intro still appears
      const rows = parseTranslationNotesTsv(FIXTURE_NEW, "2", "1");
      const refs = rows.map((r) => `${r.chapter}:${r.verse}`);
      expect(refs).toContain("front:intro");
      expect(refs).not.toContain("3:16");
    });

    it("returns only verse-level notes + intros (no cross-chapter spillover)", () => {
      const rows = parseTranslationNotesTsv(FIXTURE_NEW, "3", "16");
      const refs = rows.map((r) => `${r.chapter}:${r.verse}`);
      expect(refs).not.toContain("3:17"); // different verse
      expect(refs).not.toContain("4:1"); // different chapter
    });

    it("intro notes have correct fields", () => {
      const rows = parseTranslationNotesTsv(FIXTURE_NEW, "3", "16");
      const bookIntro = rows.find((r) => r.chapter === "front" && r.verse === "intro");
      const chapterIntro = rows.find((r) => r.chapter === "3" && r.verse === "intro");
      expect(bookIntro).toBeDefined();
      expect(bookIntro?.id).toBe("t6za");
      expect(bookIntro?.note).toContain("Introduction to John");
      expect(chapterIntro).toBeDefined();
      expect(chapterIntro?.id).toBe("jav2");
      expect(chapterIntro?.note).toContain("John 3 Chapter Introduction");
    });

    it("chapter-only query (no verse) returns intro + all chapter verses", () => {
      const rows = parseTranslationNotesTsv(FIXTURE_NEW, "3");
      const refs = rows.map((r) => `${r.chapter}:${r.verse}`);
      expect(refs).toContain("front:intro");
      expect(refs).toContain("3:intro");
      expect(refs).toContain("3:16");
      expect(refs).toContain("3:17");
      expect(refs).not.toContain("4:1");
    });
  });

  describe("old Book/Chapter/Verse format", () => {
    it("includes front:intro and chapter:intro when querying a specific verse", () => {
      const rows = parseTranslationNotesTsv(FIXTURE_OLD, "3", "16");
      const refs = rows.map((r) => `${r.chapter}:${r.verse}`);
      expect(refs).toContain("front:intro");
      expect(refs).toContain("3:intro");
      expect(refs).toContain("3:16");
    });

    it("does not include other chapter notes", () => {
      const rows = parseTranslationNotesTsv(FIXTURE_OLD, "3", "16");
      const refs = rows.map((r) => `${r.chapter}:${r.verse}`);
      expect(refs).not.toContain("3:17");
      expect(refs).not.toContain("4:1");
    });
  });
});
