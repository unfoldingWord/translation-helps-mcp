import { describe, it, expect } from "vitest";
import {
  parseRcUri,
  extractRcPaths,
  normalizeLanguageCode,
  toDoor43LanguageCode,
} from "../../src/services/rag/linkNormalizer.js";

describe("parseRcUri", () => {
  it("parses a TW rc:// URI with dict segment", () => {
    const result = parseRcUri("rc://en/tw/dict/bible/kt/love");
    expect(result).toEqual({
      raw: "rc://en/tw/dict/bible/kt/love",
      language: "en",
      type: "tw",
      path: "bible/kt/love",
    });
  });

  it("parses a TW rc:// URI without dict segment", () => {
    const result = parseRcUri("rc://en/tw/bible/kt/love");
    expect(result).toEqual({
      raw: "rc://en/tw/bible/kt/love",
      language: "en",
      type: "tw",
      path: "bible/kt/love",
    });
  });

  it("parses a TA rc:// URI with man segment", () => {
    const result = parseRcUri("rc://en/ta/man/translate/figs-metaphor");
    expect(result).toEqual({
      raw: "rc://en/ta/man/translate/figs-metaphor",
      language: "en",
      type: "ta",
      path: "translate/figs-metaphor",
    });
  });

  it("parses a TA rc:// URI without man segment", () => {
    const result = parseRcUri("rc://en/ta/translate/figs-metaphor");
    expect(result).toEqual({
      raw: "rc://en/ta/translate/figs-metaphor",
      language: "en",
      type: "ta",
      path: "translate/figs-metaphor",
    });
  });

  it("parses a non-English language TW URI", () => {
    const result = parseRcUri("rc://es/tw/dict/bible/kt/grace");
    expect(result).not.toBeNull();
    expect(result!.language).toBe("es");
    expect(result!.type).toBe("tw");
    expect(result!.path).toBe("bible/kt/grace");
  });

  it("returns null for non-rc:// strings", () => {
    expect(parseRcUri("https://example.com/bible/kt/love")).toBeNull();
    expect(parseRcUri("bible/kt/love")).toBeNull();
    expect(parseRcUri("")).toBeNull();
  });

  it("returns null for malformed rc:// URIs with fewer than 3 segments", () => {
    expect(parseRcUri("rc://en/tw")).toBeNull();
    expect(parseRcUri("rc://en")).toBeNull();
  });

  it("handles unknown types", () => {
    const result = parseRcUri("rc://en/obs/some/path");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("unknown");
    expect(result!.path).toBe("some/path");
  });

  it("returns null when path is empty after stripping", () => {
    // rc://en/tw/dict with no path after dict
    expect(parseRcUri("rc://en/tw/dict")).toBeNull();
  });
});

describe("extractRcPaths", () => {
  it("extracts rc:// URIs from a note text", () => {
    const text = `
      The word love (rc://en/tw/dict/bible/kt/love) refers to God's character.
      See also rc://en/ta/man/translate/figs-metaphor for the translation strategy.
    `;
    const paths = extractRcPaths(text);
    expect(paths).toContain("bible/kt/love");
    expect(paths).toContain("translate/figs-metaphor");
    expect(paths).toHaveLength(2);
  });

  it("deduplicates identical rc:// URIs", () => {
    const text =
      "rc://en/tw/dict/bible/kt/love and also rc://en/tw/dict/bible/kt/love";
    const paths = extractRcPaths(text);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe("bible/kt/love");
  });

  it("returns empty array for text with no rc:// URIs", () => {
    expect(extractRcPaths("no links here")).toEqual([]);
    expect(extractRcPaths("")).toEqual([]);
  });

  it("handles URIs followed by punctuation", () => {
    const text =
      "See (rc://en/tw/dict/bible/kt/love), and also rc://en/ta/man/translate/figs-simile.";
    const paths = extractRcPaths(text);
    expect(paths).toContain("bible/kt/love");
    expect(paths).toContain("translate/figs-simile");
  });
});

describe("normalizeLanguageCode", () => {
  it("converts underscores to hyphens", () => {
    expect(normalizeLanguageCode("es_419")).toBe("es-419");
    expect(normalizeLanguageCode("pt_BR")).toBe("pt-BR");
  });

  it("leaves already hyphenated codes unchanged", () => {
    expect(normalizeLanguageCode("en")).toBe("en");
    expect(normalizeLanguageCode("es-419")).toBe("es-419");
  });
});

describe("toDoor43LanguageCode", () => {
  it("converts hyphens to underscores", () => {
    expect(toDoor43LanguageCode("es-419")).toBe("es_419");
    expect(toDoor43LanguageCode("pt-BR")).toBe("pt_BR");
  });

  it("leaves already underscored codes unchanged", () => {
    expect(toDoor43LanguageCode("en")).toBe("en");
    expect(toDoor43LanguageCode("es_419")).toBe("es_419");
  });
});
