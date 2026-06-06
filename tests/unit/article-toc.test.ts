import { describe, it, expect } from "vitest";
import { resolveTitleFromToc } from "../../src/core/resources/articleToc.js";

// ---------------------------------------------------------------------------
// Fixture TOC maps
// ---------------------------------------------------------------------------

const taMap = new Map<string, string>([
  ["translate/figs-metaphor", "Metaphor"],
  ["translate/figs-simile", "Simile"],
  ["intro/ta-intro", "Introduction to Translation Academy"],
]);

const twMap = new Map<string, string>([
  ["bible/kt/grace", "Grace"],
  ["bible/kt/god", "God"],
  ["bible/other/heart", "Heart"],
  ["bible/names/moses", "Moses"],
]);

// ---------------------------------------------------------------------------
// resolveTitleFromToc — TA
// ---------------------------------------------------------------------------

describe("resolveTitleFromToc (ta)", () => {
  it("resolves bare slug exactly", () => {
    expect(resolveTitleFromToc(taMap, "translate/figs-metaphor", "ta")).toBe("Metaphor");
  });

  it("resolves rc:// URI", () => {
    expect(resolveTitleFromToc(taMap, "rc://*/ta/man/translate/figs-metaphor", "ta")).toBe("Metaphor");
  });

  it("resolves rc:// URI with specific language code", () => {
    expect(resolveTitleFromToc(taMap, "rc://en/ta/man/translate/figs-simile", "ta")).toBe("Simile");
  });

  it("falls back to last-segment match when full slug is unknown", () => {
    // Only the last segment matches
    expect(resolveTitleFromToc(taMap, "unknown/category/figs-metaphor", "ta")).toBe("Metaphor");
  });

  it("returns null for unrecognised slug", () => {
    expect(resolveTitleFromToc(taMap, "translate/figs-nonexistent", "ta")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolveTitleFromToc(taMap, "", "ta")).toBeNull();
  });

  it("returns null when map is empty", () => {
    expect(resolveTitleFromToc(new Map(), "translate/figs-metaphor", "ta")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveTitleFromToc — TW
// ---------------------------------------------------------------------------

describe("resolveTitleFromToc (tw)", () => {
  it("resolves bare TW slug exactly", () => {
    expect(resolveTitleFromToc(twMap, "bible/kt/grace", "tw")).toBe("Grace");
  });

  it("resolves rc:// URI for TW", () => {
    expect(resolveTitleFromToc(twMap, "rc://*/tw/dict/bible/kt/grace", "tw")).toBe("Grace");
  });

  it("resolves rc:// URI stripping tw/dict/ prefix", () => {
    expect(resolveTitleFromToc(twMap, "rc://en/tw/dict/bible/kt/god", "tw")).toBe("God");
  });

  it("falls back to category/term tail match", () => {
    // Provide just the last two segments
    expect(resolveTitleFromToc(twMap, "other/heart", "tw")).toBe("Heart");
  });

  it("falls back to category/term tail match for names", () => {
    expect(resolveTitleFromToc(twMap, "names/moses", "tw")).toBe("Moses");
  });

  it("returns null for unrecognised TW term", () => {
    expect(resolveTitleFromToc(twMap, "bible/kt/nonexistent", "tw")).toBeNull();
  });

  it("handles .md suffix in input (strips it)", () => {
    expect(resolveTitleFromToc(twMap, "bible/kt/grace.md", "tw")).toBe("Grace");
  });
});
