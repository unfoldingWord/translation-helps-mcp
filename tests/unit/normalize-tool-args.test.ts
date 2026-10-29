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

  it("maps term_id to path for get_word_article", () => {
    const result = normalizeToolArgs("get_word_article", {
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

// ---------------------------------------------------------------------------
// Class O: OBS story + frame → reference
// ---------------------------------------------------------------------------
describe("Class O: OBS story and frame assembly", () => {
  it("assembles get_obs_story story_number and frame_number into 3:5", () => {
    const result = normalizeToolArgs("get_obs_story", {
      story_number: 3,
      frame_number: 5,
    });
    expect(result).toEqual({ reference: "3:5" });
  });

  it("assembles string story, string frame, and numeric endFrame into a range", () => {
    const result = normalizeToolArgs("get_obs_story", {
      story: "3",
      frame: "5",
      endFrame: 8,
    });
    expect(result).toEqual({ reference: "3:5-8" });
  });

  it("assembles a story number alone", () => {
    expect(normalizeToolArgs("get_obs_story", { story: 3 })).toEqual({
      reference: "3",
    });
  });

  it("keeps language while assembling camelCase story and frame", () => {
    const result = normalizeToolArgs("get_obs_story", {
      storyNumber: 3,
      frameNumber: 5,
      language: "es-419",
    });
    expect(result).toEqual({ reference: "3:5", language: "es-419" });
  });

  it("assembles get_obs_notes the same way", () => {
    expect(
      normalizeToolArgs("get_obs_notes", { story_number: 3, frame_number: 5 }),
    ).toEqual({ reference: "3:5" });
  });

  it("assembles get_obs_questions the same way", () => {
    expect(
      normalizeToolArgs("get_obs_questions", {
        story_number: 3,
        frame_number: 5,
      }),
    ).toEqual({ reference: "3:5" });
  });

  it("assembles get_obs_study_notes and get_obs_study_questions", () => {
    expect(
      normalizeToolArgs("get_obs_study_notes", { story: 2, frame: 4 }),
    ).toEqual({ reference: "2:4" });
    expect(
      normalizeToolArgs("get_obs_study_questions", {
        obs: "7",
        startFrame: 1,
        lastFrame: 3,
      }),
    ).toEqual({ reference: "7:1-3" });
  });

  it("leaves arguments unchanged when reference is already set", () => {
    const input = { reference: "1:1", story: 3 };
    expect(normalizeToolArgs("get_obs_story", input)).toEqual(input);
  });

  it("does not assemble story 0 or story 51", () => {
    expect(normalizeToolArgs("get_obs_story", { story: 0 })).toEqual({
      story: 0,
    });
    expect(normalizeToolArgs("get_obs_story", { story: 51 })).toEqual({
      story: 51,
    });
  });

  it("does not assemble a non-integer story", () => {
    const input = { story: 3.5, frame: 1 };
    expect(normalizeToolArgs("get_obs_story", input)).toEqual(input);
  });

  it("does not assemble a frame without a story", () => {
    expect(normalizeToolArgs("get_obs_story", { frame: 5 })).toEqual({
      frame: 5,
    });
  });

  it("does not assemble an end frame without a start frame", () => {
    const input = { story: 3, endFrame: 8 };
    expect(normalizeToolArgs("get_obs_story", input)).toEqual(input);
  });

  it("assembles frame 0, the story title", () => {
    expect(normalizeToolArgs("get_obs_story", { story: 3, frame: 0 })).toEqual({
      reference: "3:0",
    });
  });

  it("appends a non-integer end frame the way Class C appends a bad endVerse", () => {
    expect(
      normalizeToolArgs("get_passage", {
        book: "JHN",
        chapter: 3,
        verse: 16,
        endVerse: "8x",
      }).reference,
    ).toBe("JHN 3:16-8x");
    expect(
      normalizeToolArgs("get_obs_story", {
        story: 3,
        frame: 5,
        endFrame: "8x",
      }),
    ).toEqual({ reference: "3:5-8x" });
  });

  it("assembles when reference is only whitespace", () => {
    expect(
      normalizeToolArgs("get_obs_story", {
        reference: "   ",
        story_number: 3,
        frame_number: 5,
      }),
    ).toEqual({ reference: "3:5" });
  });

  it("does not assemble book/chapter/verse on an OBS tool", () => {
    const input = { book: "JHN", chapter: 3, verse: 16 };
    expect(normalizeToolArgs("get_obs_story", input)).toEqual(input);
  });

  it("still assembles a Bible reference for get_passage", () => {
    const result = normalizeToolArgs("get_passage", {
      book: "JHN",
      chapter: 3,
      verse: 16,
    });
    expect(result.reference).toBe("JHN 3:16");
    expect(result.book).toBeUndefined();
    expect(result.chapter).toBeUndefined();
    expect(result.verse).toBeUndefined();
  });

  it("does not treat get_obs_notes as a path tool", () => {
    const input = { word_id: "kt/love", reference: "3:5" };
    expect(normalizeToolArgs("get_obs_notes", input)).toEqual(input);
  });
});
