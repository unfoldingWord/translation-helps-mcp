import { describe, it, expect } from "vitest";
import { joinAlignedTokens, formatQuoteDisplay } from "../../../src/api/routes/alignmentHelper.js";
import type { OptimizedToken } from "../../../src/core/alignment/usfmTokenizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(id: number, text: string): OptimizedToken {
  return { id, text, type: "word" };
}

// ---------------------------------------------------------------------------
// joinAlignedTokens
// ---------------------------------------------------------------------------

describe("joinAlignedTokens", () => {
  it("returns empty string for empty array", () => {
    expect(joinAlignedTokens([])).toBe("");
  });

  it("joins contiguous tokens with spaces", () => {
    const tokens = [makeToken(1, "God"), makeToken(2, "so"), makeToken(3, "loved")];
    expect(joinAlignedTokens(tokens)).toBe("God so loved");
  });

  it("deduplicates tokens with the same id (prevents 'God God')", () => {
    const tokens = [
      makeToken(5, "God"),
      makeToken(5, "God"), // duplicate id
      makeToken(6, "loved"),
    ];
    expect(joinAlignedTokens(tokens)).toBe("God loved");
  });

  it("inserts … between discontiguous spans (gap > 1 in id)", () => {
    // tokens at positions 1,2 then jump to 5,6
    const tokens = [
      makeToken(1, "God"),
      makeToken(2, "so"),
      makeToken(5, "the"),
      makeToken(6, "world"),
    ];
    expect(joinAlignedTokens(tokens)).toBe("God so … the world");
  });

  it("inserts … for each separate discontiguous span", () => {
    const tokens = [
      makeToken(1, "A"),
      makeToken(3, "B"),
      makeToken(7, "C"),
    ];
    expect(joinAlignedTokens(tokens)).toBe("A … B … C");
  });

  it("handles out-of-order input by sorting by id", () => {
    const tokens = [
      makeToken(3, "loved"),
      makeToken(1, "God"),
      makeToken(2, "so"),
    ];
    expect(joinAlignedTokens(tokens)).toBe("God so loved");
  });

  it("handles a single token", () => {
    expect(joinAlignedTokens([makeToken(1, "grace")])).toBe("grace");
  });
});

// ---------------------------------------------------------------------------
// formatQuoteDisplay
// ---------------------------------------------------------------------------

describe("formatQuoteDisplay", () => {
  it("returns the string unchanged when there is no &", () => {
    expect(formatQuoteDisplay("θεὸς")).toBe("θεὸς");
  });

  it("replaces & with … and trims surrounding whitespace", () => {
    expect(formatQuoteDisplay("θεὸς & ἠγάπησεν")).toBe("θεὸς … ἠγάπησεν");
  });

  it("handles multiple & separators", () => {
    expect(formatQuoteDisplay("a & b & c")).toBe("a … b … c");
  });

  it("handles & without surrounding spaces", () => {
    expect(formatQuoteDisplay("a&b")).toBe("a … b");
  });

  it("returns empty string for empty input", () => {
    expect(formatQuoteDisplay("")).toBe("");
  });

  it("filters out empty segments after splitting on &", () => {
    expect(formatQuoteDisplay("a & ")).toBe("a");
  });
});
