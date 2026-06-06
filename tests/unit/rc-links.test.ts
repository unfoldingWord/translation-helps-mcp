/**
 * Unit tests for rcLinks.ts — rc:// URI parsing and resolution.
 */

import { describe, it, expect } from "vitest";
import {
  parseRcLink,
  rcToTaPath,
  rcToTwPath,
  extractTaPathsFromNotes,
  extractTwPathsFromLinks,
} from "../../src/core/resources/rcLinks.js";

// ---------------------------------------------------------------------------
// parseRcLink
// ---------------------------------------------------------------------------

describe("parseRcLink", () => {
  it("parses a standard TA link", () => {
    const result = parseRcLink("rc://*/ta/man/translate/figs-metaphor");
    expect(result).not.toBeNull();
    expect(result!.lang).toBe("*");
    expect(result!.resource).toBe("ta");
    expect(result!.type).toBe("man");
    expect(result!.path).toBe("translate/figs-metaphor");
  });

  it("parses a language-specific TA link", () => {
    const result = parseRcLink("rc://en/ta/man/checking/accuracy");
    expect(result).not.toBeNull();
    expect(result!.lang).toBe("en");
    expect(result!.path).toBe("checking/accuracy");
  });

  it("parses a TW dict link", () => {
    const result = parseRcLink("rc://*/tw/dict/bible/kt/grace");
    expect(result).not.toBeNull();
    expect(result!.resource).toBe("tw");
    expect(result!.type).toBe("dict");
    expect(result!.path).toBe("bible/kt/grace");
  });

  it("parses a TW names link", () => {
    const result = parseRcLink("rc://*/tw/dict/bible/names/moses");
    expect(result).not.toBeNull();
    expect(result!.path).toBe("bible/names/moses");
  });

  it("returns null for non-rc URI", () => {
    expect(parseRcLink("https://example.com")).toBeNull();
    expect(parseRcLink("")).toBeNull();
    expect(parseRcLink("rc://ta/man")).toBeNull(); // too short
  });
});

// ---------------------------------------------------------------------------
// rcToTaPath
// ---------------------------------------------------------------------------

describe("rcToTaPath", () => {
  it("resolves a TA link", () => {
    expect(rcToTaPath("rc://*/ta/man/translate/figs-metaphor")).toBe("translate/figs-metaphor");
  });

  it("resolves a checking TA link", () => {
    expect(rcToTaPath("rc://en/ta/man/checking/accuracy")).toBe("checking/accuracy");
  });

  it("returns null for TW link", () => {
    expect(rcToTaPath("rc://*/tw/dict/bible/kt/grace")).toBeNull();
  });

  it("returns null for non-TA link", () => {
    expect(rcToTaPath("rc://*/tn/help/gen/01/02")).toBeNull();
  });

  it("returns null for non-rc URI", () => {
    expect(rcToTaPath("translate/figs-metaphor")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rcToTwPath
// ---------------------------------------------------------------------------

describe("rcToTwPath", () => {
  it("resolves a kt link", () => {
    expect(rcToTwPath("rc://*/tw/dict/bible/kt/grace")).toBe("bible/kt/grace");
  });

  it("resolves an other link", () => {
    expect(rcToTwPath("rc://*/tw/dict/bible/other/sheep")).toBe("bible/other/sheep");
  });

  it("resolves a names link", () => {
    expect(rcToTwPath("rc://*/tw/dict/bible/names/moses")).toBe("bible/names/moses");
  });

  it("returns null for TA link", () => {
    expect(rcToTwPath("rc://*/ta/man/translate/figs-metaphor")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractTaPathsFromNotes
// ---------------------------------------------------------------------------

describe("extractTaPathsFromNotes", () => {
  it("extracts unique TA paths", () => {
    const refs = [
      "rc://*/ta/man/translate/figs-metaphor",
      "rc://*/ta/man/translate/figs-simile",
      "rc://*/ta/man/translate/figs-metaphor", // duplicate
      undefined,
      null,
    ];
    const paths = extractTaPathsFromNotes(refs);
    expect(paths).toEqual(["translate/figs-metaphor", "translate/figs-simile"]);
  });

  it("skips non-TA links", () => {
    const paths = extractTaPathsFromNotes([
      "rc://*/tw/dict/bible/kt/grace",
      "not-an-rc-link",
    ]);
    expect(paths).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractTwPathsFromLinks
// ---------------------------------------------------------------------------

describe("extractTwPathsFromLinks", () => {
  it("extracts unique TW paths", () => {
    const links = [
      "rc://*/tw/dict/bible/kt/grace",
      "rc://*/tw/dict/bible/other/sheep",
      "rc://*/tw/dict/bible/kt/grace", // duplicate
    ];
    const paths = extractTwPathsFromLinks(links);
    expect(paths).toEqual(["bible/kt/grace", "bible/other/sheep"]);
  });

  it("skips non-TW links", () => {
    const paths = extractTwPathsFromLinks([
      "rc://*/ta/man/translate/figs-metaphor",
    ]);
    expect(paths).toEqual([]);
  });
});
