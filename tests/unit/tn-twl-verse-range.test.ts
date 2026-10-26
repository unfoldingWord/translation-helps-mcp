import { describe, it, expect } from "vitest";
import {
  parseTranslationNotesTsv,
  parseTranslationWordLinksTsv,
} from "@translation-helps/door43";

const NOTES_NEW = [
  "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote",
  "front:intro\tbk\t\t\t\t0\tBook intro.",
  "5:intro\tch5\t\t\t\t0\tChapter 5 intro.",
  "5:12\ta12\t\t\t\t1\tVerse 12.",
  "5:13\ta13\t\t\t\t1\tVerse 13.",
  "5:14\ta14\t\t\t\t1\tVerse 14.",
  "5:14-15\tbr\t\t\t\t1\tBridge 14-15.",
  "5:16\ta16\t\t\t\t1\tVerse 16.",
  "5:17\ta17\t\t\t\t1\tVerse 17.",
  "23:intro\tc23\t\t\t\t0\tChapter 23 intro.",
  "23:49\ta49\t\t\t\t1\tVerse 49.",
  "23:50\ta50\t\t\t\t1\tVerse 50.",
  "23:51\ta51\t\t\t\t1\tVerse 51.",
  "24:intro\tc24\t\t\t\t0\tChapter 24 intro.",
  "24:1\tb1\t\t\t\t1\tVerse 1.",
  "24:12\tb12\t\t\t\t1\tVerse 12.",
  "24:13\tb13\t\t\t\t1\tVerse 13.",
].join("\n");

const NOTES_OLD = [
  "Book\tChapter\tVerse\tID\tSupportReference\tQuote\tOccurrence\tNote",
  "MAT\tfront\tintro\tbk\t\t\t0\tBook intro.",
  "MAT\t5\tintro\tch5\t\t\t0\tChapter 5 intro.",
  "MAT\t5\t12\ta12\t\t\t1\tVerse 12.",
  "MAT\t5\t13\ta13\t\t\t1\tVerse 13.",
  "MAT\t5\t14\ta14\t\t\t1\tVerse 14.",
  "MAT\t5\t16\ta16\t\t\t1\tVerse 16.",
  "MAT\t5\t17\ta17\t\t\t1\tVerse 17.",
].join("\n");

const LINKS_NEW = [
  "Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink",
  "5:12\tw12\t\tsalt\t1\trc://*/tw/dict/bible/other/salt",
  "5:13\tw13\t\tearth\t1\trc://*/tw/dict/bible/other/earth",
  "5:14\tw14\t\tlight\t1\trc://*/tw/dict/bible/other/light",
  "5:16\tw16\t\tgood\t1\trc://*/tw/dict/bible/other/good",
  "5:17\tw17\t\tlaw\t1\trc://*/tw/dict/bible/kt/law",
  "23:49\tw49\t\tknow\t1\trc://*/tw/dict/bible/other/know",
  "23:50\tw50\t\tman\t1\trc://*/tw/dict/bible/kt/man",
  "23:51\tw51\t\tcouncil\t1\trc://*/tw/dict/bible/other/council",
  "24:1\tw01\t\tdawn\t1\trc://*/tw/dict/bible/other/dawn",
  "24:12\tw012\t\tlinen\t1\trc://*/tw/dict/bible/other/linen",
  "24:13\tw013\t\tvillage\t1\trc://*/tw/dict/bible/other/village",
].join("\n");

const LINKS_OLD = [
  "Book\tChapter\tVerse\tID\tSupportReference\tOrigWords\tOccurrence\tTWLink",
  "MAT\t5\t12\tw12\t\tsalt\t1\trc://*/tw/dict/bible/other/salt",
  "MAT\t5\t13\tw13\t\tearth\t1\trc://*/tw/dict/bible/other/earth",
  "MAT\t5\t14\tw14\t\tlight\t1\trc://*/tw/dict/bible/other/light",
  "MAT\t5\t16\tw16\t\tgood\t1\trc://*/tw/dict/bible/other/good",
  "MAT\t5\t17\tw17\t\tlaw\t1\trc://*/tw/dict/bible/kt/law",
].join("\n");

function verseIds(
  rows: Array<{ chapter: string; verse: string; id?: string; twId?: string }>,
): string[] {
  return rows
    .filter((row) => row.verse !== "intro")
    .map((row) => row.id || row.twId || "");
}

describe("parseTranslationNotesTsv verse ranges", () => {
  it("keeps every note in a within-chapter range, including a bridge that overlaps it", () => {
    const rows = parseTranslationNotesTsv(NOTES_NEW, "5", "13", "16");
    expect(verseIds(rows)).toEqual(["a13", "a14", "br", "a16"]);
    expect(
      rows.some((row) => row.chapter === "front" && row.verse === "intro"),
    ).toBe(true);
    expect(
      rows.some((row) => row.chapter === "5" && row.verse === "intro"),
    ).toBe(true);
  });

  it("keeps every note in a within-chapter range in the old column layout", () => {
    const rows = parseTranslationNotesTsv(NOTES_OLD, "5", "13", "16");
    expect(verseIds(rows)).toEqual(["a13", "a14", "a16"]);
  });

  it("keeps notes from both chapters of a cross-chapter range", () => {
    const rows = parseTranslationNotesTsv(NOTES_NEW, "23", "50", "12", "24");
    expect(verseIds(rows)).toEqual(["a50", "a51", "b1", "b12"]);
    expect(
      rows.some((row) => row.chapter === "23" && row.verse === "intro"),
    ).toBe(true);
    expect(
      rows.some((row) => row.chapter === "24" && row.verse === "intro"),
    ).toBe(true);
    expect(
      rows.some((row) => row.chapter === "front" && row.verse === "intro"),
    ).toBe(true);
  });

  it("still returns only the asked verse for a single verse", () => {
    const rows = parseTranslationNotesTsv(NOTES_NEW, "5", "13");
    expect(verseIds(rows)).toEqual(["a13"]);
  });
});

describe("parseTranslationWordLinksTsv verse ranges", () => {
  it("keeps every term in a within-chapter range", () => {
    const rows = parseTranslationWordLinksTsv(LINKS_NEW, "5", "13", "16");
    expect(verseIds(rows)).toEqual(["w13", "w14", "w16"]);
  });

  it("keeps every term in a within-chapter range in the old column layout", () => {
    const rows = parseTranslationWordLinksTsv(LINKS_OLD, "5", "13", "16");
    expect(verseIds(rows)).toEqual(["w13", "w14", "w16"]);
  });

  it("keeps terms from both chapters of a cross-chapter range", () => {
    const rows = parseTranslationWordLinksTsv(
      LINKS_NEW,
      "23",
      "50",
      "12",
      "24",
    );
    expect(verseIds(rows)).toEqual(["w50", "w51", "w01", "w012"]);
  });

  it("still returns only the asked verse for a single verse", () => {
    const rows = parseTranslationWordLinksTsv(LINKS_NEW, "5", "13");
    expect(verseIds(rows)).toEqual(["w13"]);
  });
});
