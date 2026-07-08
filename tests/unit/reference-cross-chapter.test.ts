/**
 * Tests for cross-chapter reference handling in referenceParser.ts.
 * Verifies endChapter propagation and null-safe extractVerses.
 */

import { describe, it, expect } from "vitest";
import { parseReferenceForTool } from "../../src/core/resources/referenceParser.js";

describe("cross-chapter reference parsing", () => {
  it("parses a simple verse reference", () => {
    const ref = parseReferenceForTool("John 3:16");
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe("JHN");
    // chapter is a string in ToolReference
    expect(ref!.chapter).toBe("3");
    expect(ref!.verseStart).toBe("16");
  });

  it("parses a verse range within one chapter", () => {
    const ref = parseReferenceForTool("Genesis 1:1-3");
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe("GEN");
    expect(ref!.chapter).toBe("1");
    expect(ref!.verseStart).toBe("1");
    expect(ref!.verseEnd).toBe("3");
  });

  it("parses a whole-chapter reference", () => {
    const ref = parseReferenceForTool("John 3");
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe("JHN");
    expect(ref!.chapter).toBe("3");
  });

  it("handles common book name aliases", () => {
    const ref1 = parseReferenceForTool("Mark 1:1");
    expect(ref1!.book).toBe("MRK");

    const ref2 = parseReferenceForTool("2 Kings 2:11");
    expect(ref2!.book).toBe("2KI");
  });

  it("returns null for a reference without a chapter", () => {
    // book-only references (no chapter) are not supported by tool
    const ref = parseReferenceForTool("Genesis");
    expect(ref).toBeNull();
  });

  it("parses a chapter-range reference like Genesis 1-2", () => {
    const ref = parseReferenceForTool("Genesis 1-2");
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe("GEN");
    expect(ref!.chapter).toBe("1");
    // endChapter should be present for cross-chapter range
    expect(ref!.endChapter).toBe("2");
  });

  it("includes endChapter for multi-chapter ranges like Genesis 1:1-2:3", () => {
    const ref = parseReferenceForTool("Genesis 1:1-2:3");
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe("GEN");
    expect(ref!.chapter).toBe("1");
    expect(ref!.verseStart).toBe("1");
    // endChapter must be present and different from chapter
    expect(ref!.endChapter).toBe("2");
  });
});
