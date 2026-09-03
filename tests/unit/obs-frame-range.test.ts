/**
 * Regression tests for OBS frame ranges and ISO 639-2 language aliases (issue #39).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseObsReference,
  formatObsReferenceLabel,
  parseObsStoryMarkdown,
  parseObsNotesTsv,
  parseObsQuestionsTsv,
  filterObsStoryFrames,
  normalizeCatalogLanguageCode,
  resolveCatalogLanguage,
  clearCatalogProcessCache,
} from "@translation-helps/door43";

const SAMPLE_OBS_MARKDOWN = `# Story Three

![Image: obs-03-01](https://cdn.example/03-01.jpg)

Frame one text.

![Image: obs-03-02](https://cdn.example/03-02.jpg)

Frame two text.

![Image: obs-03-03](https://cdn.example/03-03.jpg)

Frame three text.

![Image: obs-03-04](https://cdn.example/03-04.jpg)

Frame four text.

_A Bible story from: Genesis_
`;

const SAMPLE_TN_TSV = `Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote
3:1\tn1\t\t\t\t\tNote for frame 1.
3:2\tn2\t\t\t\t\tNote for frame 2.
3:3\tn3\t\t\t\t\tNote for frame 3.
3:4\tn4\t\t\t\t\tNote for frame 4.
3:1-3\tnRange\t\t\t\t\tNote spanning frames 1-3.
`;

const SAMPLE_TQ_TSV = `Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse
3:1\tq1\t\t\t\tQ frame 1?\tA1
3:2\tq2\t\t\t\tQ frame 2?\tA2
3:3\tq3\t\t\t\tQ frame 3?\tA3
3:4\tq4\t\t\t\tQ frame 4?\tA4
`;

describe("parseObsReference frame ranges", () => {
  it("parses 3:1-3 with frame and frameEnd", () => {
    const ref = parseObsReference("3:1-3");
    expect(ref).toMatchObject({
      story: 3,
      frame: 1,
      frameEnd: 3,
      canonical: "3:1-3",
    });
  });

  it("parses OBS 3:1-3 with prefix stripped", () => {
    const ref = parseObsReference("OBS 3:1-3");
    expect(ref).toMatchObject({ story: 3, frame: 1, frameEnd: 3 });
  });

  it("rejects inverted ranges", () => {
    expect(parseObsReference("3:5-2")).toBeNull();
  });

  it("still parses single frame 3:1", () => {
    const ref = parseObsReference("3:1");
    expect(ref).toMatchObject({ story: 3, frame: 1, canonical: "3:1" });
    expect(ref!.frameEnd).toBeUndefined();
  });

  it("still parses whole story 3", () => {
    const ref = parseObsReference("3");
    expect(ref).toMatchObject({ story: 3, frame: null, canonical: "3" });
  });
});

describe("formatObsReferenceLabel frame ranges", () => {
  it("formats range without double OBS prefix", () => {
    expect(formatObsReferenceLabel("3:1-3")).toBe("OBS 3:1-3");
    expect(formatObsReferenceLabel("OBS 3:1-3")).toBe("OBS 3:1-3");
  });
});

describe("filterObsStoryFrames", () => {
  it("returns frames 1-3 only for story 3 range reference", () => {
    const story = parseObsStoryMarkdown(3, SAMPLE_OBS_MARKDOWN);
    const ref = parseObsReference("3:1-3")!;
    const frames = filterObsStoryFrames(story.frames, ref);
    expect(frames.map((f) => f.index)).toEqual([1, 2, 3]);
    expect(frames[0].text).toContain("Frame one");
    expect(frames[2].text).toContain("Frame three");
  });

  it("returns all content frames for whole story", () => {
    const story = parseObsStoryMarkdown(3, SAMPLE_OBS_MARKDOWN);
    const ref = parseObsReference("3")!;
    const frames = filterObsStoryFrames(story.frames, ref);
    expect(frames.map((f) => f.index)).toEqual([1, 2, 3, 4]);
  });

  it("returns single frame for 3:1", () => {
    const story = parseObsStoryMarkdown(3, SAMPLE_OBS_MARKDOWN);
    const ref = parseObsReference("3:1")!;
    const frames = filterObsStoryFrames(story.frames, ref);
    expect(frames.map((f) => f.index)).toEqual([1]);
  });
});

describe("parseObsNotesTsv frame range overlap", () => {
  it("matches notes for each frame in 3:1-3", () => {
    const ref = parseObsReference("3:1-3")!;
    const notes = parseObsNotesTsv(SAMPLE_TN_TSV, ref);
    const ids = notes.map((n) => n.id).sort();
    expect(ids).toEqual(["n1", "n2", "n3", "nRange"]);
  });

  it("returns empty notes when no rows match (catalog gap / soft-NA path)", () => {
    const ref = parseObsReference("3:99")!;
    const notes = parseObsNotesTsv(SAMPLE_TN_TSV, ref);
    expect(notes).toEqual([]);
  });
});

describe("parseObsQuestionsTsv frame range overlap", () => {
  it("matches questions for frames 1-3", () => {
    const ref = parseObsReference("3:1-3")!;
    const questions = parseObsQuestionsTsv(SAMPLE_TQ_TSV, ref);
    expect(questions.map((q) => q.id).sort()).toEqual(["q1", "q2", "q3"]);
  });
});

describe("normalizeCatalogLanguageCode", () => {
  it("maps spa to es", () => {
    expect(normalizeCatalogLanguageCode("spa")).toBe("es");
    expect(normalizeCatalogLanguageCode("SPA")).toBe("es");
  });

  it("passes through BCP-47 codes unchanged", () => {
    expect(normalizeCatalogLanguageCode("es-419")).toBe("es-419");
    expect(normalizeCatalogLanguageCode("hi")).toBe("hi");
  });
});

describe("resolveCatalogLanguage spa alias", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearCatalogProcessCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves spa to es catalog resources (then es-419 variant when needed)", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("catalog/search") && url.includes("lang=spa")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, data: [] }),
        });
      }
      if (
        url.includes("catalog/search") &&
        url.includes("lang=es") &&
        !url.includes("es-419")
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, data: [] }),
        });
      }
      if (url.includes("catalog/search") && url.includes("es-419")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              ok: true,
              data: [
                {
                  name: "es-419_obs",
                  owner: "unfoldingWord",
                  abbreviation: "obs",
                  ingredients: [],
                  catalog: {
                    prod: { zipball_url: "https://example.com/es-419_obs.zip" },
                  },
                },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, data: [] }),
      });
    }) as unknown as typeof fetch;

    const { language, entries } = await resolveCatalogLanguage("spa", {
      subject: "Open Bible Stories",
    });
    expect(language).toBe("es-419");
    expect(entries.length).toBeGreaterThan(0);
  });
});
