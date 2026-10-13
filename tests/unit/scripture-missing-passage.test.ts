/**
 * When no version has a passage, the scripture route must say what is missing:
 * the book, the chapter or the verse. "Book not found" for a chapter or verse
 * past the end led a model to tell a translator that the book did not exist.
 */
import { describe, expect, it } from "vitest";
import { usfmExtent } from "@translation-helps/door43";
import { missingPassageMessage } from "../../src/api/routes/scripture.js";

const USFM = [
  "\\id 3JN",
  "\\c 1",
  "\\p",
  "\\v 1 The elder to beloved Gaius.",
  "\\v 2 Beloved, I pray.",
  "\\v 13-14 I had many things to write.",
  "\\v 15 Peace to you.",
].join("\n");

const TWO_CHAPTERS = [
  "\\c 1",
  "\\v 1 One.",
  "\\v 2 Two.",
  "\\c 2",
  "\\v 1 One.",
  "\\v 2 Two.",
  "\\v 3 Three.",
].join("\n");

describe("usfmExtent", () => {
  it("counts the chapters and finds the last verse of the chapter asked for", () => {
    expect(usfmExtent(USFM, "1")).toEqual({ chapters: 1, lastVerse: 15 });
    expect(usfmExtent(TWO_CHAPTERS, "1")).toEqual({
      chapters: 2,
      lastVerse: 2,
    });
    expect(usfmExtent(TWO_CHAPTERS, "2")).toEqual({
      chapters: 2,
      lastVerse: 3,
    });
  });

  it("has no last verse for a chapter the book does not have", () => {
    expect(usfmExtent(USFM, "3")).toEqual({ chapters: 1, lastVerse: null });
    // Chapter 1 must not be found inside "\c 12".
    expect(usfmExtent("\\c 12\n\\v 1 Twelve.", "1")).toEqual({
      chapters: 12,
      lastVerse: null,
    });
  });

  it("takes the end of a verse bridge", () => {
    expect(usfmExtent("\\c 1\n\\v 1 One.\n\\v 2-4 Bridge.", "1")).toEqual({
      chapters: 1,
      lastVerse: 4,
    });
  });

  it("answers for text with no chapters at all", () => {
    expect(usfmExtent("", "1")).toEqual({ chapters: 0, lastVerse: null });
  });
});

describe("missingPassageMessage", () => {
  const base = {
    reference: "John 99",
    book: "JHN",
    chapter: "99",
    language: "en",
  };

  it("says the book is missing only when no version has the book", () => {
    expect(missingPassageMessage({ ...base, extents: [] })).toBe(
      'Book "JHN" not found in any scripture resource for "en"',
    );
  });

  it("says the chapter is past the end of the book", () => {
    expect(
      missingPassageMessage({
        ...base,
        extents: [{ chapters: 21, lastVerse: null }],
      }),
    ).toBe(
      '"John 99" does not exist: JHN has 21 chapters, so there is no chapter 99.',
    );
    expect(
      missingPassageMessage({
        reference: "Jude 2:3",
        book: "JUD",
        chapter: "2",
        verseStart: "3",
        language: "en",
        extents: [{ chapters: 1, lastVerse: null }],
      }),
    ).toBe(
      '"Jude 2:3" does not exist: JUD has 1 chapter, so there is no chapter 2.',
    );
  });

  it("says the verse is past the end of the chapter, by the longest version", () => {
    expect(
      missingPassageMessage({
        reference: "John 3:99",
        book: "JHN",
        chapter: "3",
        verseStart: "99",
        language: "en",
        extents: [
          { chapters: 21, lastVerse: 36 },
          { chapters: 21, lastVerse: 35 },
        ],
      }),
    ).toBe(
      '"John 3:99" does not exist: JHN 3 has 36 verses, so there is no verse 99.',
    );
  });

  it("does not claim a verse is past the end when it is not", () => {
    const message = missingPassageMessage({
      reference: "John 5:4",
      book: "JHN",
      chapter: "5",
      verseStart: "4",
      language: "en",
      extents: [{ chapters: 21, lastVerse: 47 }],
    });
    expect(message).toBe(
      '"John 5:4" has no text in any scripture resource for "en", though JHN 5 exists there.',
    );
  });
});
