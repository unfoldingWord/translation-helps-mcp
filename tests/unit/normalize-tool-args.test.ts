/**
 * Unit tests for normalizeToolArgs — upstream DoD shapes from issues #24/#28.
 *
 * Each test case is taken directly from the upstream production-error log
 * that motivated the normalization layer.
 */

import { describe, it, expect } from "vitest";
import { normalizeToolArgs } from "../../src/mcp/normalizeToolArgs.js";

// ---------------------------------------------------------------------------
// Class H: null / array / primitive → {}
// ---------------------------------------------------------------------------
describe("Class H: coerce bad arg types to {}", () => {
  it("coerces null to {}", () => {
    expect(normalizeToolArgs("get_passage", null)).toEqual({});
  });

  it("coerces undefined to {}", () => {
    expect(normalizeToolArgs("get_passage", undefined)).toEqual({});
  });

  it("coerces array to {}", () => {
    expect(normalizeToolArgs("get_passage", ["JHN 3:16", "en"])).toEqual({});
  });

  it("coerces string to {}", () => {
    expect(normalizeToolArgs("get_passage", "JHN 3:16")).toEqual({});
  });

  it("coerces number to {}", () => {
    expect(normalizeToolArgs("get_passage", 42)).toEqual({});
  });

  it("passes a normal object through unchanged when no rules apply", () => {
    const input = { reference: "JHN 3:16", language: "en" };
    expect(normalizeToolArgs("get_passage", input)).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// Class B: path synonyms
// ---------------------------------------------------------------------------
describe("Class B: path synonyms", () => {
  it("maps word_id to path for get_word_article", () => {
    const result = normalizeToolArgs("get_word_article", {
      word_id: "love",
      language: "en",
    });
    expect(result.path).toBe("love");
    expect(result.word_id).toBeUndefined();
  });

  it("maps article_id to path for get_academy_article", () => {
    const result = normalizeToolArgs("get_academy_article", {
      article_id: "figs-activepassive",
      language: "en",
    });
    expect(result.path).toBe("figs-activepassive");
    expect(result.article_id).toBeUndefined();
  });

  it("maps term_id to path for fetch_translation_word", () => {
    const result = normalizeToolArgs("fetch_translation_word", {
      term_id: "faith",
      language: "en",
    });
    expect(result.path).toBe("faith");
    expect(result.term_id).toBeUndefined();
  });

  it("maps bare term to path", () => {
    const result = normalizeToolArgs("get_word_article", {
      term: "grace",
      language: "en",
    });
    expect(result.path).toBe("grace");
  });

  it("maps word to path (camelCase wordId)", () => {
    const result = normalizeToolArgs("get_word_article", {
      wordId: "sheep",
      language: "en",
    });
    expect(result.path).toBe("sheep");
    expect(result.wordId).toBeUndefined();
  });

  it("does NOT consume uuid — uuid stays untouched and does not become path", () => {
    const input = { uuid: "x", word: "love", language: "en" };
    const result = normalizeToolArgs("get_word_article", input);
    expect(result.path).toBe("love");
    expect(result.uuid).toBe("x");
  });

  it("does not apply path synonym logic to reference tools", () => {
    const input = { word: "love", reference: "JHN 3:16", language: "en" };
    const result = normalizeToolArgs("get_passage", input);
    expect(result.path).toBeUndefined();
    expect(result.word).toBe("love"); // untouched for non-path tools
  });

  it("does not overwrite an existing path", () => {
    const input = { path: "bible/kt/grace", word: "grace", language: "en" };
    const result = normalizeToolArgs("get_word_article", input);
    expect(result.path).toBe("bible/kt/grace");
  });
});

// ---------------------------------------------------------------------------
// Class C: decomposed reference assembly
// ---------------------------------------------------------------------------
describe("Class C: decomposed reference assembly", () => {
  it("assembles {book, chapter, verse} into reference", () => {
    const result = normalizeToolArgs("get_passage", {
      book: "1CO",
      chapter: 15,
      verse: 58,
    });
    expect(result.reference).toBe("1CO 15:58");
    expect(result.book).toBeUndefined();
    expect(result.chapter).toBeUndefined();
    expect(result.verse).toBeUndefined();
  });

  it("assembles {book, chapter} without verse", () => {
    const result = normalizeToolArgs("get_passage", {
      book: "JHN",
      chapter: 3,
    });
    expect(result.reference).toBe("JHN 3");
  });

  it("assembles with endVerse into range", () => {
    const result = normalizeToolArgs("get_passage", {
      book: "GEN",
      chapter: 1,
      verse: 1,
      endVerse: 3,
    });
    expect(result.reference).toBe("GEN 1:1-3");
  });

  it("does not overwrite an existing reference", () => {
    const input = { reference: "JHN 3:16", book: "GEN", chapter: 1, verse: 1 };
    const result = normalizeToolArgs("get_passage", input);
    expect(result.reference).toBe("JHN 3:16");
  });

  it("does not apply decomposed logic to path tools", () => {
    const input = { book: "wisdom", language: "en" };
    const result = normalizeToolArgs("get_word_article", input);
    expect(result.reference).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Class D: language alias
// ---------------------------------------------------------------------------
describe("Class D: language alias", () => {
  it("maps language_code to language", () => {
    const result = normalizeToolArgs("get_passage", {
      reference: "JHN 3:16",
      language_code: "fr",
    });
    expect(result.language).toBe("fr");
    expect(result.language_code).toBeUndefined();
  });

  it("maps lang to language", () => {
    const result = normalizeToolArgs("get_passage", {
      reference: "JHN 3:16",
      lang: "es",
    });
    expect(result.language).toBe("es");
    expect(result.lang).toBeUndefined();
  });

  it("does not overwrite an existing language", () => {
    const result = normalizeToolArgs("get_passage", {
      reference: "JHN 3:16",
      language: "en",
      lang: "fr",
    });
    expect(result.language).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------
describe("Combined normalization", () => {
  it("normalizes word_id + language_code + path tool together", () => {
    const result = normalizeToolArgs("get_word_article", {
      word_id: "grace",
      language_code: "es",
    });
    expect(result.path).toBe("grace");
    expect(result.language).toBe("es");
    expect(result.word_id).toBeUndefined();
    expect(result.language_code).toBeUndefined();
  });

  it("normalizes decomposed ref + lang alias together", () => {
    const result = normalizeToolArgs("get_passage", {
      book: "MAT",
      chapter: 5,
      verse: 1,
      lang: "de",
    });
    expect(result.reference).toBe("MAT 5:1");
    expect(result.language).toBe("de");
  });
});
