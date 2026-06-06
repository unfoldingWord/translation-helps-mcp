import { describe, it, expect } from "vitest";
import {
  parseReference,
  bookNameToUsfm,
  parseReferenceForTool,
} from "../../src/core/resources/referenceParser.js";

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
