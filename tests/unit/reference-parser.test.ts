import { describe, it, expect } from "vitest";
import { parseReference } from "../../src/parsers/referenceParser.js";

describe("parseReference (invariant — must not regress)", () => {
  it("parses a simple chapter:verse reference", () => {
    const result = parseReference("JHN 3:16");
    expect(result.isValid).toBe(true);
    expect(result.book).toMatch(/John/i);
    expect(result.chapter).toBe(3);
    expect(result.verse).toBe(16);
  });

  it("parses a book-only reference", () => {
    const result = parseReference("Genesis");
    expect(result.isValid).toBe(true);
    expect(result.book).toMatch(/Genesis/i);
  });

  it("parses a chapter-only reference", () => {
    const result = parseReference("John 3");
    expect(result.isValid).toBe(true);
    expect(result.chapter).toBe(3);
  });

  it("parses a 3-letter USFM book code", () => {
    const result = parseReference("MAT 5:3");
    expect(result.isValid).toBe(true);
    expect(result.book).toMatch(/Matt/i);
    expect(result.chapter).toBe(5);
    expect(result.verse).toBe(3);
  });

  it("returns isValid=false for empty input", () => {
    const result = parseReference("");
    expect(result.isValid).toBe(false);
  });

  it("preserves the originalText field", () => {
    const ref = "REV 22:21";
    const result = parseReference(ref);
    expect(result.originalText).toBe(ref);
  });

  it("parses 1-letter numbered books", () => {
    const result = parseReference("1 Corinthians 13:4");
    expect(result.isValid).toBe(true);
    expect(result.book).toMatch(/Corinthians/i);
    expect(result.chapter).toBe(13);
    expect(result.verse).toBe(4);
  });

  it("handles leading/trailing whitespace", () => {
    const result = parseReference("  JHN 3:16  ");
    expect(result.isValid).toBe(true);
    expect(result.chapter).toBe(3);
    expect(result.verse).toBe(16);
  });
});
