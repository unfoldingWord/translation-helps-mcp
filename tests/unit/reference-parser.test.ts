import { describe, it, expect } from "vitest";
import {
  parseReference,
  bookNameToUsfm,
  parseReferenceForTool,
} from "@translation-helps/door43";

describe("bookNameToUsfm", () => {
  it("maps full book names to USFM codes", () => {
    expect(bookNameToUsfm("Genesis")).toBe("GEN");
    expect(bookNameToUsfm("John")).toBe("JHN");
    expect(bookNameToUsfm("Revelation")).toBe("REV");
    expect(bookNameToUsfm("Matthew")).toBe("MAT");
    expect(bookNameToUsfm("Psalms")).toBe("PSA");
    expect(bookNameToUsfm("1 Corinthians")).toBe("1CO");
    expect(bookNameToUsfm("Song of Songs")).toBe("SNG");
  });

  it("passes through USFM codes unchanged (uppercased)", () => {
    expect(bookNameToUsfm("JHN")).toBe("JHN");
    expect(bookNameToUsfm("GEN")).toBe("GEN");
  });

  it("uppercases unknown inputs", () => {
    expect(bookNameToUsfm("xyz")).toBe("XYZ");
  });
});

describe("parseReferenceForTool", () => {
  it("parses USFM code references", () => {
    const result = parseReferenceForTool("JHN 3:16");
    expect(result).not.toBeNull();
    expect(result!.book).toBe("JHN");
    expect(result!.chapter).toBe("3");
    expect(result!.verseStart).toBe("16");
  });

  it("parses full book name references", () => {
    const result = parseReferenceForTool("John 3:16");
    expect(result).not.toBeNull();
    expect(result!.book).toBe("JHN");
    expect(result!.chapter).toBe("3");
    expect(result!.verseStart).toBe("16");
  });

  it("parses Genesis references", () => {
    const result = parseReferenceForTool("Genesis 1:1");
    expect(result).not.toBeNull();
    expect(result!.book).toBe("GEN");
    expect(result!.chapter).toBe("1");
    expect(result!.verseStart).toBe("1");
  });

  it("parses verse ranges", () => {
    const result = parseReferenceForTool("GEN 1:1-3");
    expect(result).not.toBeNull();
    expect(result!.verseStart).toBe("1");
    expect(result!.verseEnd).toBe("3");
  });

  it("parses chapter-only references", () => {
    const result = parseReferenceForTool("MAT 5");
    expect(result).not.toBeNull();
    expect(result!.book).toBe("MAT");
    expect(result!.chapter).toBe("5");
    expect(result!.verseStart).toBeUndefined();
  });

  it("returns null for book-only references (no chapter)", () => {
    const result = parseReferenceForTool("Genesis");
    expect(result).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseReferenceForTool("")).toBeNull();
  });

  it("returns null for book-only input (no chapter number)", () => {
    // A string with no digit has no chapter, so parseReferenceForTool returns null
    expect(parseReferenceForTool("invalidreference")).toBeNull();
  });

  it("handles Revelation (long name)", () => {
    const result = parseReferenceForTool("Revelation 22:13");
    expect(result).not.toBeNull();
    expect(result!.book).toBe("REV");
    expect(result!.chapter).toBe("22");
    expect(result!.verseStart).toBe("13");
  });

  it("handles numbered books", () => {
    const result1 = parseReferenceForTool("1 Corinthians 13:4");
    expect(result1).not.toBeNull();
    expect(result1!.book).toBe("1CO");

    const result2 = parseReferenceForTool("2 Timothy 3:16");
    expect(result2).not.toBeNull();
    expect(result2!.book).toBe("2TI");
  });

  it("parses 2KGS (LLM-generated non-standard code) as 2KI", () => {
    const result = parseReferenceForTool("2KGS 12:8");
    expect(result).not.toBeNull();
    expect(result!.book).toBe("2KI");
    expect(result!.chapter).toBe("12");
    expect(result!.verseStart).toBe("8");
  });

  it("parses 1KGS as 1KI", () => {
    const result = parseReferenceForTool("1KGS 5:1");
    expect(result).not.toBeNull();
    expect(result!.book).toBe("1KI");
  });

  it("parses MAR (Spanish/LLM abbreviation for Mark) as MRK", () => {
    const result = parseReferenceForTool("MAR 1:1");
    expect(result).not.toBeNull();
    expect(result!.book).toBe("MRK");
    expect(result!.chapter).toBe("1");
    expect(result!.verseStart).toBe("1");
  });
});

describe("parseReference (existing behaviour)", () => {
  it("parses standard references", () => {
    const ref = parseReference("John 3:16");
    expect(ref.isValid).toBe(true);
    expect(ref.chapter).toBe(3);
    expect(ref.verse).toBe(16);
  });

  it("returns isValid false for empty string", () => {
    const ref = parseReference("");
    expect(ref.isValid).toBe(false);
  });
});

describe("one-chapter books", () => {
  it("reads a bare number as a verse of chapter 1", () => {
    const cases: [string, string, string][] = [
      ["Obadiah 4", "OBA", "4"],
      ["Philemon 6", "PHM", "6"],
      ["2 John 5", "2JN", "5"],
      ["3 John 15", "3JN", "15"],
      ["Jude 3", "JUD", "3"],
    ];
    for (const [reference, book, verse] of cases) {
      const result = parseReferenceForTool(reference);
      expect(result, reference).toEqual({
        book,
        chapter: "1",
        verseStart: verse,
        verseEnd: undefined,
      });
    }
  });

  it("reads a bare range as verses of chapter 1, not as chapters", () => {
    const result = parseReferenceForTool("Jude 3-5");
    expect(result).toEqual({
      book: "JUD",
      chapter: "1",
      verseStart: "3",
      verseEnd: "5",
    });
    expect(parseReferenceForTool("Philemon 1-7")).toEqual({
      book: "PHM",
      chapter: "1",
      verseStart: "1",
      verseEnd: "7",
    });
  });

  it("accepts the codes, abbreviations and Spanish names of those books", () => {
    for (const reference of ["JUD 3", "jud 3", "Judas 3"]) {
      const result = parseReferenceForTool(reference);
      expect(result?.book, reference).toBe("JUD");
      expect(result?.chapter, reference).toBe("1");
      expect(result?.verseStart, reference).toBe("3");
    }
    expect(parseReferenceForTool("3JN 15")?.verseStart).toBe("15");
    expect(parseReferenceForTool("Filemon 6")?.verseStart).toBe("6");
    expect(parseReferenceForTool("Abdias 4")?.verseStart).toBe("4");
  });

  it("keeps 'Jude 1' as the whole chapter", () => {
    const result = parseReferenceForTool("Jude 1");
    expect(result?.chapter).toBe("1");
    expect(result?.verseStart).toBeUndefined();
  });

  it("leaves a reference that names its chapter as written", () => {
    expect(parseReferenceForTool("Jude 1:3")).toEqual({
      book: "JUD",
      chapter: "1",
      verseStart: "3",
      verseEnd: undefined,
    });
    // A chapter that does not exist is the caller's mistake to report, not ours to guess at.
    expect(parseReferenceForTool("Jude 2:3")?.chapter).toBe("2");
  });

  it("does not touch books with more than one chapter", () => {
    const john = parseReferenceForTool("John 3");
    expect(john?.chapter).toBe("3");
    expect(john?.verseStart).toBeUndefined();
    // 1 John has five chapters; only 2 John and 3 John have one.
    expect(parseReferenceForTool("1 John 3")?.chapter).toBe("3");
    expect(parseReferenceForTool("Genesis 1-3")?.endChapter).toBe("3");
  });

  it("gives parseReference callers the same reading", () => {
    const ref = parseReference("Jude 3-5");
    expect(ref.chapter).toBe(1);
    expect(ref.verse).toBe(3);
    expect(ref.endVerse).toBe(5);
    expect(ref.endChapter).toBeUndefined();
  });
});
