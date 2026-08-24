/**
 * Unit tests for parseTranslationQuestionsTsv verse-range filtering.
 *
 * Regression: get_questions for "JON 1:1-3" returned 0 because the parser
 * exact-matched only verseStart ("1"), and Jonah has no TQ on 1:1 (first is 1:2).
 */

import { describe, it, expect } from "vitest";
import {
  parseTranslationQuestionsTsv,
  verseOverlapsQueryRange,
} from "@translation-helps/door43";

/** Minimal Jonah ch.1 TQ fixture mirroring real en_tq (no 1:1 row). */
const FIXTURE_JON = [
  "Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse",
  "1:2\tblwz\t\t\t0\tWhat did Yahweh tell Jonah to do?\tYahweh told Jonah to go to Nineveh.",
  "1:3\tdxw8\t\t\t0\tWhat did Jonah do after Yahweh told him?\tJonah fled toward Tarshish.",
  "1:4\tgiq9\t\t\t0\tWhat did Yahweh do to the ship?\tYahweh sent a great storm.",
  "2:1\tlrhn\t\t\t0\tWhat did Jonah do in the belly of the fish?\tJonah prayed.",
].join("\n");

/** Titus ch.1-style fixture with several verse-1 questions + later verses. */
const FIXTURE_TIT = [
  "Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse",
  "1:1\ta001\t\t\t0\tWho wrote this letter?\tPaul.",
  "1:1\ta002\t\t\t0\tTo whom did Paul write?\tTitus.",
  "1:2\tb001\t\t\t0\tWhat hope does Paul mention?\tEternal life.",
  "1:5\tc001\t\t\t0\tWhy was Titus left in Crete?\tTo appoint elders.",
  "1:1-3\td001\t\t\t0\tWhat is the theme of the greeting?\tPaul’s apostleship for the faith.",
  "2:1\te001\t\t\t0\tWhat should Titus teach?\tSound doctrine.",
].join("\n");

describe("verseOverlapsQueryRange", () => {
  it("matches a single verse inside a query range", () => {
    expect(verseOverlapsQueryRange("2", "1", "3")).toBe(true);
    expect(verseOverlapsQueryRange("1", "1", "3")).toBe(true);
    expect(verseOverlapsQueryRange("3", "1", "3")).toBe(true);
  });

  it("rejects verses outside the query range", () => {
    expect(verseOverlapsQueryRange("4", "1", "3")).toBe(false);
    expect(verseOverlapsQueryRange("1", "2", "3")).toBe(false);
  });

  it("matches when a TSV bridge overlaps the query range", () => {
    expect(verseOverlapsQueryRange("1-3", "1", "3")).toBe(true);
    expect(verseOverlapsQueryRange("1-2", "2", "4")).toBe(true);
    expect(verseOverlapsQueryRange("3-5", "1", "3")).toBe(true);
  });

  it("treats missing verseEnd as a single-verse query", () => {
    expect(verseOverlapsQueryRange("1", "1")).toBe(true);
    expect(verseOverlapsQueryRange("2", "1")).toBe(false);
    expect(verseOverlapsQueryRange("1-3", "2")).toBe(true);
  });

  it("rejects non-numeric TSV verses under a verse filter", () => {
    expect(verseOverlapsQueryRange("intro", "1", "3")).toBe(false);
  });
});

describe("parseTranslationQuestionsTsv — verse ranges", () => {
  it("JON 1:1-3 includes questions for verses 2 and 3 (not only verse 1)", () => {
    const rows = parseTranslationQuestionsTsv(FIXTURE_JON, "1", "1", "3");
    const verses = rows.map((r) => r.verse);
    expect(verses).toEqual(["2", "3"]);
    expect(rows).toHaveLength(2);
  });

  it("JON 1 (chapter) returns all chapter-1 questions", () => {
    const rows = parseTranslationQuestionsTsv(FIXTURE_JON, "1");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.verse)).toEqual(["2", "3", "4"]);
  });

  it("TIT 1 (chapter) returns every chapter-1 question including bridges", () => {
    const rows = parseTranslationQuestionsTsv(FIXTURE_TIT, "1");
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.verse)).toEqual(["1", "1", "2", "5", "1-3"]);
  });

  it("TIT 1:1 returns only verse-1 rows and overlapping bridges", () => {
    const rows = parseTranslationQuestionsTsv(FIXTURE_TIT, "1", "1");
    expect(rows.map((r) => r.verse)).toEqual(["1", "1", "1-3"]);
    expect(rows).toHaveLength(3);
  });

  it("does not spill into other chapters", () => {
    const jon = parseTranslationQuestionsTsv(FIXTURE_JON, "1", "1", "3");
    expect(jon.every((r) => r.chapter === "1")).toBe(true);
    expect(jon.some((r) => r.verse === "1" && r.chapter === "2")).toBe(false);

    const tit = parseTranslationQuestionsTsv(FIXTURE_TIT, "1");
    expect(tit.every((r) => r.chapter === "1")).toBe(true);
  });
});
