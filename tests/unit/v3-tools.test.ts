/**
 * v3 tools call the same REST routes as the v2 tools they replace.
 * The fake API records the URL; it does not reimplement Door43.
 */
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/mcp/agent.js";
import { normalizeToolArgs } from "../../src/mcp/normalizeToolArgs.js";
import { normalizeV3ToolArgs } from "../../src/mcp/v3/normalizeArgs.js";
import { readReference } from "../../src/mcp/v3/readReference.js";
import { getPassageV3Tool } from "../../src/mcp/v3/tools/getPassage.js";
import { V3_SERVER_INSTRUCTIONS } from "../../src/mcp/v3/instructions.js";
import {
  GET_PASSAGE_INDEX_DESCRIPTION,
  getPassageIndexV3Tool,
} from "../../src/mcp/v3/tools/getPassageIndex.js";
import { getNotesV3Tool } from "../../src/mcp/v3/tools/getNotes.js";
import { getQuestionsV3Tool } from "../../src/mcp/v3/tools/getQuestions.js";
import { listResourcesV3Tool } from "../../src/mcp/v3/tools/listResources.js";

function apiEnv(payload: (url: URL) => unknown): {
  env: Env;
  calls: URL[];
} {
  const calls: URL[] = [];
  const env = {
    API: {
      async fetch(input: RequestInfo | URL) {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(raw);
        calls.push(url);
        if (url.pathname.endsWith("/prefetch")) {
          return new Response(null, { status: 202 });
        }
        const data = await Promise.resolve(payload(url));
        if (data instanceof Response) return data;
        return Response.json(data);
      },
    },
  } as Env;
  return { env, calls };
}

function passagePayload(url: URL): unknown {
  if (url.pathname.endsWith("/scripture")) {
    return {
      reference: url.searchParams.get("reference"),
      language: url.searchParams.get("language"),
      book: "JHN",
      chapter: "3",
      verse: "16",
      versions: [
        {
          resourceType: "ult",
          role: "literal",
          text: "For God so loved the world",
          source: "en_ult",
        },
      ],
    };
  }
  if (url.pathname.endsWith("/obs")) {
    return {
      reference: url.searchParams.get("reference"),
      language: url.searchParams.get("language"),
      story: 3,
      frame: 5,
      frames: [{ index: 5, imageUrl: null, text: "frame text" }],
    };
  }
  if (url.pathname.endsWith("/questions")) {
    return {
      questions: [{ reference: "JHN 3:16", question: "Who?", response: "God" }],
    };
  }
  if (url.pathname.endsWith("/obs-questions")) {
    return { questions: [{ question: "tq", response: "yes" }] };
  }
  if (url.pathname.endsWith("/obs-study-questions")) {
    return { questions: [{ question: "sq", response: "because" }] };
  }
  if (url.pathname.endsWith("/languages")) {
    return {
      languages: [
        { code: "en", name: "English", englishName: "English" },
        { code: "es-419", name: "Español", englishName: "Spanish" },
      ],
    };
  }
  if (url.pathname.endsWith("/resources")) {
    return {
      language: url.searchParams.get("language"),
      available: [
        {
          subject: "Bible",
          abbreviation: "ult",
          role: "literal",
          type: "text",
        },
      ],
    };
  }
  return { error: { code: "NOT_FOUND", message: url.pathname } };
}

describe("normalizeV3ToolArgs", () => {
  it("turns OBS parts into OBS 3:5 on th_get_passage without changing v2", () => {
    const raw = { story: 3, frame: 5, language: "en" };
    // Prefixed names stay out of v2's tool sets. v3 calls the unprefixed
    // normalizer itself, so Class O still does not run for v2 get_passage.
    expect(normalizeToolArgs("get_passage", raw).reference).toBeUndefined();
    expect(normalizeToolArgs("th_get_passage", raw).reference).toBeUndefined();
    expect(normalizeV3ToolArgs("th_get_passage", raw)).toEqual({
      reference: "OBS 3:5",
      language: "en",
    });
  });

  it("turns book, chapter and verse into a Bible reference", () => {
    expect(
      normalizeV3ToolArgs("th_get_passage", {
        book: "JHN",
        chapter: 3,
        verse: 16,
      }),
    ).toEqual({ reference: "JHN 3:16" });
  });

  it("keeps a Bible format when it rebuilds the reference", () => {
    expect(
      normalizeV3ToolArgs("th_get_passage", {
        reference: "JHN 3:16",
        language: "en",
        format: "usfm",
      }),
    ).toEqual({ reference: "JHN 3:16", language: "en", format: "usfm" });
  });

  it("keeps th_get_questions kind beside the normalized reference", () => {
    expect(
      normalizeV3ToolArgs("th_get_questions", {
        story: 1,
        frame: 3,
        kind: "study",
        language: "en",
      }),
    ).toEqual({ reference: "OBS 1:3", language: "en", kind: "study" });
  });

  it("maps language_code on th_list_resources the way v2 does", () => {
    expect(
      normalizeV3ToolArgs("th_list_resources", {
        language_code: "es-419",
        book: "TIT",
      }),
    ).toMatchObject({ language: "es-419", book: "TIT" });
  });

  it("stores an actionable reader error in the reference string", () => {
    const out = normalizeV3ToolArgs("th_get_passage", { frame: 5 });
    expect(String(out.reference).startsWith("\u0000")).toBe(true);
    expect(String(out.reference)).toMatch(/JHN 3:16/);
    expect(String(out.reference)).toMatch(/OBS 3:5/);
  });

  it("repeats that stored error once when the handler reads the object", () => {
    const stored = normalizeV3ToolArgs("th_get_passage", { frame: 5 });
    const again = readReference(stored);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.message.startsWith("\u0000")).toBe(false);
    expect(again.message).toMatch(/JHN 3:16/);
    expect(again.message.split("Accepted forms")).toHaveLength(2);
  });
});

describe("v3 th_get_passage", () => {
  it("is registered under the prefixed name", () => {
    expect(getPassageV3Tool.name).toBe("th_get_passage");
  });

  it("loads scripture versions for a Bible reference", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const result = await getPassageV3Tool.handler(
      { reference: "JHN 3:16", language: "en" },
      env,
      "req",
    );
    const scripture = calls.find((url) => url.pathname.endsWith("/scripture"));
    expect(scripture?.searchParams.get("reference")).toBe("JHN 3:16");
    expect(scripture?.searchParams.get("language")).toBe("en");
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: "bible",
      reference: "JHN 3:16",
      versions: [expect.objectContaining({ role: "literal" })],
    });
  });

  it("keeps the cache name and drops timings", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.endsWith("/scripture")) {
        return {
          ...((passagePayload(url) ?? {}) as Record<string, unknown>),
          meta: { cache: "kv", timings: { zipMs: 4 } },
        };
      }
      return passagePayload(url);
    });
    const result = await getPassageV3Tool.handler(
      { reference: "JHN 3:16", language: "en" },
      env,
      "req",
    );
    expect(result.structuredContent?.meta).toEqual({ cache: "kv" });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /timings|requestId/,
    );
  });

  it("loads OBS frames for an OBS reference", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const result = await getPassageV3Tool.handler(
      { reference: "OBS 3:5", language: "en" },
      env,
      "req",
    );
    const obs = calls.find((url) => url.pathname.endsWith("/obs"));
    expect(obs?.searchParams.get("reference")).toBe("OBS 3:5");
    expect(calls.some((url) => url.pathname.endsWith("/scripture"))).toBe(
      false,
    );
    expect(result.structuredContent).toMatchObject({
      kind: "obs",
      reference: "OBS 3:5",
      frames: [expect.objectContaining({ index: 5, text: "frame text" })],
    });
  });

  it("refuses a book alone and does not call the API", async () => {
    const { env, calls } = apiEnv(passagePayload);
    await expect(
      getPassageV3Tool.handler(
        { reference: "Jonah", language: "en" },
        env,
        "req",
      ),
    ).rejects.toThrow(/th_get_passage_index/);
    expect(calls).toEqual([]);
  });

  it("passes format through to scripture and defaults to text", async () => {
    const { env, calls } = apiEnv(passagePayload);
    await getPassageV3Tool.handler(
      { reference: "JHN 3:16", language: "en", format: "usfm" },
      env,
      "req-usfm",
    );
    const usfm = calls.find((url) => url.pathname.endsWith("/scripture"));
    expect(usfm?.searchParams.get("format")).toBe("usfm");

    await getPassageV3Tool.handler(
      { reference: "GEN 1", language: "en" },
      env,
      "req-text",
    );
    const text = calls.filter((url) => url.pathname.endsWith("/scripture"));
    expect(text.at(-1)?.searchParams.get("format")).toBe("text");
  });

  it("ignores format for an OBS reference", async () => {
    const { env, calls } = apiEnv(passagePayload);
    await getPassageV3Tool.handler(
      { reference: "OBS 3:5", language: "en", format: "usfm" },
      env,
      "req-obs-format",
    );
    const obs = calls.find((url) => url.pathname.endsWith("/obs"));
    expect(obs?.searchParams.get("reference")).toBe("OBS 3:5");
    expect(obs?.searchParams.has("format")).toBe(false);
    expect(calls.some((url) => url.pathname.endsWith("/scripture"))).toBe(
      false,
    );
  });

  it("rejects an introduction and points at th_get_notes", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const message =
      "introductions are notes: use th_get_notes with reference 'JHN 1:intro'";
    await expect(
      getPassageV3Tool.handler(
        { reference: "JHN 1:intro", language: "en" },
        env,
        "req-intro",
      ),
    ).rejects.toThrow(message);
    await expect(
      getPassageV3Tool.handler(
        { reference: "JHN front:intro", language: "en" },
        env,
        "req-front",
      ),
    ).rejects.toThrow(
      "introductions are notes: use th_get_notes with reference 'JHN front:intro'",
    );
    expect(calls).toEqual([]);
  });
});

describe("v3 th_get_questions", () => {
  it("is registered under the prefixed name", () => {
    expect(getQuestionsV3Tool.name).toBe("th_get_questions");
  });

  it("loads Bible translation questions by default", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const result = await getQuestionsV3Tool.handler(
      { reference: "JHN 3:16", language: "en" },
      env,
      "req",
    );
    const questions = calls.find((url) => url.pathname.endsWith("/questions"));
    expect(questions?.pathname.endsWith("/obs-questions")).toBe(false);
    expect(questions?.searchParams.get("reference")).toBe("JHN 3:16");
    expect(result.structuredContent).toMatchObject({
      kind: "bible",
      questionKind: "translation",
      reference: "JHN 3:16",
    });
  });

  it("says Bible study questions are not available and does not fetch", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const result = await getQuestionsV3Tool.handler(
      { reference: "JHN 3:16", language: "en", kind: "study" },
      env,
      "req",
    );
    expect(calls).toEqual([]);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
    });
    expect(JSON.stringify(result.structuredContent)).toMatch(/study/i);
    expect(result.structuredContent).toMatchObject({
      hints: [
        "Run th_list_resources to see what is available for this language.",
      ],
    });
  });

  it("loads OBS translation questions from OBS-TQ", async () => {
    const { env, calls } = apiEnv(passagePayload);
    await getQuestionsV3Tool.handler(
      { reference: "OBS 3:5", language: "en", kind: "translation" },
      env,
      "req",
    );
    expect(calls.map((url) => url.pathname)).toContain("/api/v1/obs-questions");
  });

  it("rejects an introduction with the same th_get_notes message as passage", async () => {
    const { env, calls } = apiEnv(passagePayload);
    await expect(
      getQuestionsV3Tool.handler(
        { reference: "JHN front:intro", language: "en" },
        env,
        "req-front",
      ),
    ).rejects.toThrow(
      "introductions are notes: use th_get_notes with reference 'JHN front:intro'",
    );
    await expect(
      getQuestionsV3Tool.handler(
        { reference: "Jonah 1:intro", language: "en" },
        env,
        "req-chapter",
      ),
    ).rejects.toThrow(
      "introductions are notes: use th_get_notes with reference 'JON 1:intro'",
    );
    expect(calls).toEqual([]);
  });

  it("refuses a book alone with a clear error and does not call the API", async () => {
    const { env, calls } = apiEnv(passagePayload);
    await expect(
      getQuestionsV3Tool.handler(
        { reference: "Jonah", language: "en" },
        env,
        "req-book",
      ),
    ).rejects.toThrow(/book alone/);
    expect(calls).toEqual([]);
  });

  it("loads OBS study questions from OBS-SQ", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const result = await getQuestionsV3Tool.handler(
      { reference: "OBS 1:3", language: "en", kind: "study" },
      env,
      "req",
    );
    const study = calls.find((url) =>
      url.pathname.endsWith("/obs-study-questions"),
    );
    expect(study?.searchParams.get("reference")).toBe("OBS 1:3");
    expect(result.structuredContent).toMatchObject({
      kind: "obs",
      questionKind: "study",
      reference: "OBS 1:3",
    });
  });
});

describe("v3 th_list_resources", () => {
  it("is registered under the prefixed name", () => {
    expect(listResourcesV3Tool.name).toBe("th_list_resources");
  });

  it("lists languages when language is omitted, including filter", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const result = await listResourcesV3Tool.handler(
      { filter: "es" },
      env,
      "req-lang",
    );
    expect(calls.map((url) => url.pathname)).toContain("/api/v1/languages");
    expect(result.structuredContent).toMatchObject({
      languages: [expect.objectContaining({ code: "es-419" })],
      total: 1,
      has_more: false,
    });
    expect(result.structuredContent).not.toHaveProperty("total_count");
    expect(result.structuredContent).not.toHaveProperty("requestId");
    expect(result.structuredContent).not.toHaveProperty("next_offset");
    expect(JSON.stringify(result.content)).not.toMatch(/requestId|total_count/);
    const languages = result.structuredContent?.languages as unknown[];
    expect(languages).toHaveLength(1);
  });

  it("pages the language list with total, has_more and next_offset", async () => {
    const { env } = apiEnv(passagePayload);
    const result = await listResourcesV3Tool.handler(
      { limit: 1, offset: 0 },
      env,
      "req-page",
    );
    expect(result.structuredContent).toMatchObject({
      total: 2,
      has_more: true,
      next_offset: 1,
      limit: 1,
      offset: 0,
    });
    const codes = (
      result.structuredContent?.languages as Array<{ code: string }>
    ).map((language) => language.code);
    expect(codes).toEqual(["en"]);
  });

  it("lists resources for a language and a book", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const result = await listResourcesV3Tool.handler(
      { language: "es-419", book: "TIT" },
      env,
      "req-res",
    );
    const resources = calls.find((url) => url.pathname.endsWith("/resources"));
    expect(resources?.searchParams.get("language")).toBe("es-419");
    expect(resources?.searchParams.get("book")).toBe("TIT");
    expect(result.structuredContent).toMatchObject({
      language: "es-419",
      resources: [expect.objectContaining({ abbreviation: "ult" })],
    });
    expect(result.structuredContent).not.toHaveProperty("requestId");
    expect(JSON.stringify(result.content)).not.toMatch(/requestId/);
  });

  it("turns a reference into the book before calling the resources route", async () => {
    const { env, calls } = apiEnv(passagePayload);
    const args = normalizeV3ToolArgs("th_list_resources", {
      language: "en",
      reference: "JHN 3:16",
    });
    expect(args).toEqual({ language: "en", book: "JHN" });
    await listResourcesV3Tool.handler(
      args as { language: string; book: string },
      env,
      "req-ref",
    );
    const resources = calls.find((url) => url.pathname.endsWith("/resources"));
    expect(resources?.searchParams.get("book")).toBe("JHN");
    expect(resources?.searchParams.get("reference")).toBeNull();
    expect(
      normalizeV3ToolArgs("th_list_resources", {
        language: "en",
        book: "TIT",
        reference: "JHN 3:16",
      }),
    ).toEqual({ language: "en", book: "TIT" });
  });
});

const TA_METAPHOR = "rc://*/ta/man/translate/figs-metaphor";

function indexPayload(url: URL): unknown {
  const reference = url.searchParams.get("reference") ?? "";
  if (url.pathname.endsWith("/notes")) {
    if (reference === "JON") {
      return {
        book: "JON",
        notes: [
          {
            chapter: "front",
            verse: "intro",
            id: "book",
            note: "# Introduction to Jonah\n\nOverview.",
            quote: "",
            supportReference: "",
          },
          {
            chapter: "1",
            verse: "intro",
            id: "ch1",
            note: "# Jonah 1\n\nChapter.",
            quote: "",
            supportReference: "",
          },
          {
            chapter: "1",
            verse: "1",
            id: "a",
            quote: "word of",
            supportReference: TA_METAPHOR,
            supportReferenceTitle: "Metaphor",
            gatewayQuote: { original: "word of", aligned: "word of the Lord" },
          },
          {
            chapter: "2",
            verse: "1",
            id: "b",
            quote: "fish",
            supportReference: TA_METAPHOR,
            supportReferenceTitle: "Metaphor",
            gatewayQuote: { original: "fish", aligned: "" },
          },
        ],
      };
    }
    if (reference === "JON 1") {
      return {
        book: "JON",
        notes: [
          {
            chapter: "front",
            verse: "intro",
            id: "book",
            note: "# Introduction to Jonah\n\nSee [there](../01/29.md).",
            quote: "",
            supportReference: "",
          },
          {
            chapter: "1",
            verse: "intro",
            id: "ch1",
            note: "# Jonah 1\n\nThe prophet.",
            quote: "",
            supportReference: TA_METAPHOR,
            supportReferenceTitle: "Metaphor",
          },
          {
            chapter: "2",
            verse: "intro",
            id: "ch2",
            note: "# Jonah 2\n\nNot this chapter.",
            quote: "",
            supportReference: "",
          },
          {
            chapter: "1",
            verse: "3",
            id: "verse",
            quote: "Tarshish",
            note: "He fled.",
            supportReference: "",
            gatewayQuote: { original: "Tarshish", aligned: "to Tarshish" },
          },
        ],
      };
    }
    return {
      book: "GEN",
      notes: [
        {
          chapter: "front",
          verse: "intro",
          id: "book",
          note: "# Introduction to Genesis\n\nBook.",
          quote: "",
          supportReference: "",
        },
        {
          chapter: "9",
          verse: "intro",
          id: "ch",
          note: "# Genesis 9\n\nChapter.",
          quote: "",
          supportReference: "",
        },
        {
          chapter: "9",
          verse: "9",
          id: "n1",
          quote: "covenant",
          note: "This is my covenant.",
          supportReference: TA_METAPHOR,
          supportReferenceTitle: "Metaphor",
          gatewayQuote: { original: "covenant", aligned: "my covenant" },
        },
        {
          chapter: "9",
          verse: "9",
          id: "n2",
          quote: "seed",
          note: "Your offspring.",
          supportReference: "",
          gatewayQuote: { original: "seed", aligned: "offspring" },
        },
      ],
    };
  }
  if (url.pathname.endsWith("/word-links")) {
    if (reference === "JON") {
      return {
        book: "JON",
        wordLinks: [
          {
            chapter: "1",
            verse: "1",
            origWords: "יהוה",
            wordPath: "bible/kt/yahweh",
            twTitle: "Yahweh",
            gatewayQuote: { original: "יהוה", aligned: "Lord" },
          },
          {
            chapter: "2",
            verse: "1",
            origWords: "דג",
            wordPath: "bible/other/fish",
            twTitle: "Fish",
            gatewayQuote: { original: "דג", aligned: "" },
          },
        ],
      };
    }
    return {
      book: "GEN",
      wordLinks: [
        {
          chapter: "9",
          verse: "9",
          origWords: "ברית",
          wordPath: "bible/kt/covenant",
          twTitle: "Covenant",
          gatewayQuote: { original: "ברית", aligned: "covenant" },
        },
      ],
    };
  }
  if (url.pathname.endsWith("/obs-notes")) {
    return {
      reference,
      notes: [
        {
          reference: "1:3",
          id: "obs-n",
          quote: "created",
          note: "God made it.",
          supportReference: TA_METAPHOR,
          supportReferenceTitle: "Metaphor",
        },
        {
          reference: "1:0",
          id: "title",
          quote: "",
          note: "# The Creation\n\nStory title.",
          supportReference: "",
        },
      ],
    };
  }
  if (url.pathname.endsWith("/obs-word-links")) {
    return {
      reference,
      words: [
        {
          reference: "1:3",
          origWords: "God",
          twArticle: {
            path: "bible/kt/god",
            category: "kt",
            title: "God",
          },
        },
      ],
    };
  }
  if (url.pathname.endsWith("/obs-study-notes")) {
    return {
      reference,
      notes: [
        {
          reference: "1:3",
          id: "sn",
          quote: "",
          note: "Study the creation.",
          supportReference: "",
        },
      ],
    };
  }
  return passagePayload(url);
}

function httpError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code: "UPSTREAM", message } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("normalizeV3ToolArgs for index and notes", () => {
  it("turns a story and frame into OBS 1:3 for the index", () => {
    expect(
      normalizeV3ToolArgs("th_get_passage_index", {
        story: 1,
        frame: 3,
        language: "en",
      }),
    ).toEqual({ reference: "OBS 1:3", language: "en" });
  });

  it("keeps ids, a single id, phrase and kind on th_get_notes", () => {
    expect(
      normalizeV3ToolArgs("th_get_notes", {
        reference: "GEN 9:9",
        language: "en",
        ids: ["n1", "n2"],
        phrase: "covenant",
        kind: "translation",
      }),
    ).toEqual({
      reference: "GEN 9:9",
      language: "en",
      ids: ["n1", "n2"],
      phrase: "covenant",
      kind: "translation",
    });
    expect(
      normalizeV3ToolArgs("th_get_notes", {
        book: "Jonah",
        id: "only",
      }),
    ).toEqual({ reference: "JON", ids: ["only"] });
    expect(
      normalizeV3ToolArgs("th_get_notes", {
        reference: "GEN 9:9",
        ids: ["n1"],
        id: "n2",
        language: "en",
      }),
    ).toEqual({
      reference: "GEN 9:9",
      language: "en",
      ids: ["n1", "n2"],
    });
  });

  it("accepts keyTermsOffset and still accepts rollupOffset", () => {
    expect(
      normalizeV3ToolArgs("th_get_passage_index", {
        reference: "PSA",
        language: "en",
        limit: 50,
        offset: 0,
        keyTermsOffset: 100,
      }),
    ).toEqual({
      reference: "PSA",
      language: "en",
      limit: 50,
      offset: 0,
      keyTermsOffset: 100,
    });
    expect(
      normalizeV3ToolArgs("th_get_passage_index", {
        reference: "PSA",
        language: "en",
        limit: 50,
        offset: 0,
        rollupOffset: 100,
      }),
    ).toEqual({
      reference: "PSA",
      language: "en",
      limit: 50,
      offset: 0,
      keyTermsOffset: 100,
    });
    const both = normalizeV3ToolArgs("th_get_passage_index", {
      reference: "PSA",
      keyTermsOffset: 200,
      rollupOffset: 100,
    });
    expect(both.keyTermsOffset).toBe(200);
    expect(both).not.toHaveProperty("rollupOffset");
  });
});

describe("v3 th_get_passage_index", () => {
  it("is registered under the prefixed name", () => {
    expect(getPassageIndexV3Tool.name).toBe("th_get_passage_index");
  });

  it("sends issue and key-term paths to th_get_article and does not put next on them", () => {
    expect(GET_PASSAGE_INDEX_DESCRIPTION).toMatch(
      /An issue or key term has no next: call th_get_article with its path/,
    );
    expect(GET_PASSAGE_INDEX_DESCRIPTION).toMatch(/PHP 2:1/);
    expect(GET_PASSAGE_INDEX_DESCRIPTION).toMatch(/listed once under issues/);
    expect(GET_PASSAGE_INDEX_DESCRIPTION).toMatch(/keyTermsOffset/);
    expect(GET_PASSAGE_INDEX_DESCRIPTION).not.toMatch(/rollup/i);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/th_get_article/);
    expect(getPassageIndexV3Tool.description).toBe(
      GET_PASSAGE_INDEX_DESCRIPTION,
    );
  });

  it("indexes a Bible verse without note bodies", async () => {
    const { env, calls } = apiEnv(indexPayload);
    const result = await getPassageIndexV3Tool.handler(
      { reference: "GEN 9:9", language: "en" },
      env,
      "req",
    );
    expect(calls.map((url) => url.pathname).sort()).toEqual([
      "/api/v1/notes",
      "/api/v1/word-links",
    ]);
    expect(result.isError).not.toBe(true);
    const data = result.structuredContent ?? {};
    expect(data).toMatchObject({
      kind: "bible",
      reference: "GEN 9:9",
    });
    const notes = data.notes as Array<Record<string, unknown>>;
    expect(notes.map((note) => note.id)).toEqual(["n1", "n2"]);
    expect(notes[0]).toMatchObject({
      reference: "GEN 9:9",
      quote: "my covenant",
      taArticle: { path: "translate/figs-metaphor" },
      next: {
        tool: "th_get_notes",
        args: { reference: "GEN 9:9", ids: ["n1"] },
      },
    });
    expect(notes[0]?.taArticle).not.toHaveProperty("title");
    expect(JSON.stringify(notes[0])).not.toMatch(/This is my covenant/);
    const words = data.words as Array<Record<string, unknown>>;
    expect(words[0]).toMatchObject({
      reference: "GEN 9:9",
      quote: "covenant",
      twArticle: {
        path: "bible/kt/covenant",
        title: "Covenant",
      },
      next: {
        tool: "th_get_article",
        args: { path: "bible/kt/covenant" },
      },
    });
    expect(words[0]?.twArticle).not.toHaveProperty("category");
    expect(data.limit).toBe(200);
    expect(data.issues).toEqual([
      {
        path: "translate/figs-metaphor",
        title: "Metaphor",
        count: 1,
      },
    ]);
    expect(data.keyTerms).toEqual([
      {
        path: "bible/kt/covenant",
        title: "Covenant",
        category: "kt",
        count: 1,
      },
    ]);
    expect(data.introductions).toEqual([
      {
        scope: "book",
        reference: "GEN front:intro",
        title: "Introduction to Genesis",
        next: {
          tool: "th_get_notes",
          args: { reference: "GEN front:intro" },
        },
      },
      {
        scope: "chapter",
        reference: "GEN 9:intro",
        title: "Genesis 9",
        next: {
          tool: "th_get_notes",
          args: { reference: "GEN 9:intro" },
        },
      },
    ]);
  });

  it("indexes a chapter and keeps that chapter's introduction", async () => {
    const { env, calls } = apiEnv(indexPayload);
    const result = await getPassageIndexV3Tool.handler(
      { reference: "JON 1", language: "en" },
      env,
      "req",
    );
    expect(
      calls
        .find((url) => url.pathname.endsWith("/notes"))
        ?.searchParams.get("reference"),
    ).toBe("JON 1");
    const data = result.structuredContent ?? {};
    expect(data.kind).toBe("bible");
    const notes = data.notes as Array<{ id: string }>;
    expect(notes.map((note) => note.id)).toEqual(["verse"]);
    const introductions = data.introductions as Array<{ reference: string }>;
    expect(introductions.map((row) => row.reference)).toEqual([
      "JON front:intro",
      "JON 1:intro",
    ]);
  });

  it("indexes a whole book from one TSV call and pages the rows", async () => {
    const { env, calls } = apiEnv(indexPayload);
    const result = await getPassageIndexV3Tool.handler(
      { reference: "Jonah", language: "en", limit: 1, offset: 0 },
      env,
      "req",
    );
    const notesCalls = calls.filter((url) => url.pathname.endsWith("/notes"));
    expect(notesCalls).toHaveLength(1);
    expect(notesCalls[0]?.searchParams.get("reference")).toBe("JON");
    expect(
      calls.filter((url) => url.pathname.endsWith("/word-links")),
    ).toHaveLength(1);
    const data = result.structuredContent ?? {};
    expect(data.reference).toBe("JON");
    expect(data.kind).toBe("bible");
    const notes = data.notes as Array<{ id: string }>;
    const words = data.words as Array<Record<string, unknown>>;
    expect(notes).toHaveLength(1);
    expect(words).toHaveLength(1);
    expect(data.total).toEqual({ notes: 2, words: 2, keyTerms: 2 });
    expect(data.has_more).toEqual({
      notes: true,
      words: true,
      keyTerms: false,
    });
    expect(data.next_offset).toEqual({ notes: 1, words: 1 });
    expect(data).not.toHaveProperty("keyTermsTotal");
    expect(data.keyTermsOffset).toBe(0);
    expect(data).not.toHaveProperty("rollupOffset");
    expect(data.limit).toBe(1);
    expect(data.offset).toBe(0);
    const issues = data.issues as Array<{ path: string; count: number }>;
    expect(issues).toEqual([
      {
        path: "translate/figs-metaphor",
        title: "Metaphor",
        count: 2,
      },
    ]);
    expect(
      (data.keyTerms as Array<Record<string, unknown>>).every(
        (row) => !("next" in row),
      ),
    ).toBe(true);
    const introductions = data.introductions as Array<{ reference: string }>;
    expect(introductions.map((row) => row.reference)).toEqual([
      "JON front:intro",
    ]);
  });

  it("indexes an OBS frame and a story", async () => {
    const { env, calls } = apiEnv(indexPayload);
    const frame = await getPassageIndexV3Tool.handler(
      { reference: "OBS 1:3", language: "en" },
      env,
      "req-frame",
    );
    expect(
      calls
        .find((url) => url.pathname.endsWith("/obs-notes"))
        ?.searchParams.get("reference"),
    ).toBe("OBS 1:3");
    expect(calls.some((url) => url.pathname.endsWith("/notes"))).toBe(false);
    const data = frame.structuredContent ?? {};
    expect(data.kind).toBe("obs");
    expect(data.reference).toBe("OBS 1:3");
    const notes = data.notes as Array<Record<string, unknown>>;
    expect(notes.map((note) => note.id)).toEqual(["obs-n"]);
    expect(notes[0]).toMatchObject({
      reference: "OBS 1:3",
      quote: "created",
      next: {
        tool: "th_get_notes",
        args: { reference: "OBS 1:3", ids: ["obs-n"] },
      },
    });
    const introductions = data.introductions as Array<Record<string, unknown>>;
    expect(introductions).toEqual([
      expect.objectContaining({
        scope: "story",
        reference: "OBS 1:0",
        title: "The Creation",
        next: {
          tool: "th_get_notes",
          args: { reference: "OBS 1:0" },
        },
      }),
    ]);
    expect(
      calls
        .filter((url) => url.pathname.endsWith("/obs-notes"))
        .map((url) => url.searchParams.get("reference")),
    ).toEqual(["OBS 1:3"]);
    const story = await getPassageIndexV3Tool.handler(
      { reference: "OBS 1", language: "en" },
      env,
      "req-story",
    );
    expect(story.structuredContent?.kind).toBe("obs");
    expect(story.structuredContent?.reference).toBe("OBS 1");
  });

  it("loads a story's front matter when the frame response leaves it out", async () => {
    const { env, calls } = apiEnv((url) => {
      if (url.pathname.endsWith("/obs-word-links")) return { words: [] };
      if (url.pathname.endsWith("/obs-notes")) {
        if (url.searchParams.get("reference") === "OBS 1") {
          return {
            notes: [
              {
                reference: "1:0",
                id: "title",
                quote: "The Creation",
                note: "This title can also be translated as: “How God made the world.”",
                supportReference: "",
              },
            ],
          };
        }
        return {
          notes: [
            {
              reference: "1:3",
              id: "obs-n",
              quote: "created",
              note: "God made it.",
              supportReference: "",
            },
          ],
        };
      }
      return { notes: [] };
    });
    const result = await getPassageIndexV3Tool.handler(
      { reference: "OBS 1:3", language: "en" },
      env,
      "req",
    );
    expect(
      calls
        .filter((url) => url.pathname.endsWith("/obs-notes"))
        .map((url) => url.searchParams.get("reference")),
    ).toEqual(["OBS 1:3", "OBS 1"]);
    expect(
      (result.structuredContent?.notes as Array<{ id?: string }>).map(
        (note) => note.id,
      ),
    ).toEqual(["obs-n"]);
    expect(result.structuredContent?.introductions).toEqual([
      expect.objectContaining({
        scope: "story",
        reference: "OBS 1:0",
        title: "The Creation",
        next: {
          tool: "th_get_notes",
          args: { reference: "OBS 1:0" },
        },
      }),
    ]);
  });

  it("puts a failed side in wordLinksError and keeps the notes", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.endsWith("/word-links")) return httpError(500, "boom");
      return indexPayload(url);
    });
    const result = await getPassageIndexV3Tool.handler(
      { reference: "GEN 9:9", language: "en" },
      env,
      "req",
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.wordLinksError).toMatch(/boom/);
    expect(result.structuredContent?.notesError).toBeUndefined();
    const notes = result.structuredContent?.notes as unknown[];
    expect(notes.length).toBeGreaterThan(0);
    expect(result.structuredContent?.words).toEqual([]);
  });

  it("says the resource is not available when both sides are missing", async () => {
    const { env } = apiEnv((url) => {
      if (
        url.pathname.endsWith("/notes") ||
        url.pathname.endsWith("/word-links")
      ) {
        return {
          available: false,
          message: "No Translation Notes for this language.",
        };
      }
      return indexPayload(url);
    });
    const result = await getPassageIndexV3Tool.handler(
      { reference: "GEN 9:9", language: "zh" },
      env,
      "req",
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
    });
  });

  it("rejects an introduction with the same message as th_get_passage", async () => {
    const { env, calls } = apiEnv(indexPayload);
    await expect(
      getPassageIndexV3Tool.handler(
        { reference: "Jonah 1:intro", language: "en" },
        env,
        "req",
      ),
    ).rejects.toThrow(
      "introductions are notes: use th_get_notes with reference 'JON 1:intro'",
    );
    expect(calls).toEqual([]);
  });

  it("defaults a whole book to 50 rows and keeps 200 for a passage", async () => {
    const { env } = apiEnv(indexPayload);
    const book = await getPassageIndexV3Tool.handler(
      { reference: "Jonah", language: "en" },
      env,
      "req-book",
    );
    expect(book.structuredContent?.limit).toBe(50);
    const passage = await getPassageIndexV3Tool.handler(
      { reference: "GEN 9:9", language: "en" },
      env,
      "req-verse",
    );
    expect(passage.structuredContent?.limit).toBe(200);
  });

  it("asks for index fields on a whole book and not on a passage", async () => {
    const { env, calls } = apiEnv(indexPayload);
    await getPassageIndexV3Tool.handler(
      { reference: "Jonah", language: "en" },
      env,
      "req-book",
    );
    const bookNotes = calls.find((url) => url.pathname.endsWith("/notes"));
    const bookWords = calls.find((url) => url.pathname.endsWith("/word-links"));
    expect(bookNotes?.searchParams.get("fields")).toBe("index");
    expect(bookWords?.searchParams.get("fields")).toBe("index");
    calls.length = 0;
    await getPassageIndexV3Tool.handler(
      { reference: "GEN 9:9", language: "en" },
      env,
      "req-verse",
    );
    expect(
      calls
        .find((url) => url.pathname.endsWith("/notes"))
        ?.searchParams.get("fields"),
    ).toBeNull();
  });

  it("reads an introduction title from heading when the body is absent", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.endsWith("/word-links")) return { wordLinks: [] };
      if (url.pathname.endsWith("/notes")) {
        return {
          book: "JON",
          notes: [
            {
              chapter: "front",
              verse: "intro",
              id: "book",
              heading: "Introduction to Jonah",
              quote: "",
              supportReference: "",
            },
          ],
        };
      }
      return { notes: [] };
    });
    const result = await getPassageIndexV3Tool.handler(
      { reference: "JON", language: "en" },
      env,
      "req",
    );
    expect(result.structuredContent?.introductions).toEqual([
      expect.objectContaining({
        scope: "book",
        reference: "JON front:intro",
        title: "Introduction to Jonah",
      }),
    ]);
  });

  it("keeps every issue sorted by count and pages key terms at 100", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.endsWith("/word-links")) {
        return {
          wordLinks: Array.from({ length: 101 }, (_, i) => ({
            chapter: "1",
            verse: "1",
            origWords: `w${i}`,
            wordPath: `bible/other/t${String(i).padStart(3, "0")}`,
            twTitle: `Term ${i}`,
          })),
        };
      }
      if (url.pathname.endsWith("/notes")) {
        return {
          book: "PSA",
          notes: [
            {
              chapter: "1",
              verse: "1",
              id: "m1",
              quote: "a",
              supportReference: TA_METAPHOR,
              supportReferenceTitle: "Metaphor",
            },
            {
              chapter: "1",
              verse: "2",
              id: "m2",
              quote: "b",
              supportReference: TA_METAPHOR,
              supportReferenceTitle: "Metaphor",
            },
            {
              chapter: "1",
              verse: "3",
              id: "i1",
              quote: "c",
              supportReference: "rc://*/ta/man/translate/figs-idiom",
              supportReferenceTitle: "Idiom",
            },
          ],
        };
      }
      return { notes: [] };
    });
    const first = await getPassageIndexV3Tool.handler(
      { reference: "Psalms", language: "en" },
      env,
      "req-page",
    );
    const data = first.structuredContent ?? {};
    expect(data.issues).toEqual([
      expect.objectContaining({
        path: "translate/figs-metaphor",
        count: 2,
      }),
      expect.objectContaining({ path: "translate/figs-idiom", count: 1 }),
    ]);
    const keyTerms = data.keyTerms as Array<Record<string, unknown>>;
    expect(keyTerms).toHaveLength(100);
    expect(keyTerms[0]?.path).toBe("bible/other/t000");
    expect(Object.keys(keyTerms[0] ?? {}).sort()).toEqual([
      "category",
      "count",
      "path",
      "title",
    ]);
    expect(keyTerms.every((row) => !("next" in row))).toBe(true);
    expect(
      (data.issues as Array<Record<string, unknown>>).every(
        (row) => !("next" in row),
      ),
    ).toBe(true);
    expect(keyTerms[99]?.path).toBe("bible/other/t099");
    expect(data.total).toMatchObject({ keyTerms: 101 });
    expect(data.next_offset).toMatchObject({ keyTerms: 100 });
    expect(data.keyTermsOffset).toBe(0);
    expect(data.has_more).toMatchObject({ keyTerms: true });
    expect(data).not.toHaveProperty("keyTermsTotal");
    expect(data).not.toHaveProperty("rollupOffset");

    const second = await getPassageIndexV3Tool.handler(
      { reference: "Psalms", language: "en", keyTermsOffset: 100 },
      env,
      "req-rest",
    );
    const rest = second.structuredContent?.keyTerms as Array<{ path: string }>;
    expect(rest.map((row) => row.path)).toEqual(["bible/other/t100"]);
    expect(second.structuredContent?.total).toMatchObject({ keyTerms: 101 });
    expect(
      (
        second.structuredContent?.next_offset as
          | { keyTerms?: number }
          | undefined
      )?.keyTerms,
    ).toBeUndefined();
    expect(second.structuredContent?.keyTermsOffset).toBe(100);
    expect(second.structuredContent).not.toHaveProperty("rollupOffset");
    expect(second.structuredContent).not.toHaveProperty("keyTermsTotal");
    expect(second.structuredContent?.has_more).toMatchObject({
      keyTerms: false,
    });
    const issues = second.structuredContent?.issues as unknown[];
    expect(issues).toHaveLength(2);
  });

  it("keeps language on next when it is not the tool default", async () => {
    const { env } = apiEnv(indexPayload);
    const result = await getPassageIndexV3Tool.handler(
      { reference: "GEN 9:9", language: "es" },
      env,
      "req",
    );
    const notes = result.structuredContent?.notes as Array<{
      next?: { args?: Record<string, unknown> };
    }>;
    expect(notes[0]?.next?.args).toEqual({
      reference: "GEN 9:9",
      language: "es",
      ids: ["n1"],
    });
  });

  it("returns both reasons when notes and word links both fail", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.endsWith("/notes")) return httpError(500, "notes down");
      if (url.pathname.endsWith("/word-links")) {
        return httpError(500, "links down");
      }
      return indexPayload(url);
    });
    const result = await getPassageIndexV3Tool.handler(
      { reference: "GEN 9:9", language: "en" },
      env,
      "req",
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.available).not.toBe(false);
    expect(result.structuredContent?.notesError).toMatch(/notes down/);
    expect(result.structuredContent?.wordLinksError).toMatch(/links down/);
    expect(result.structuredContent?.notes).toEqual([]);
    expect(result.structuredContent?.words).toEqual([]);
  });

  it("lists both chapter introductions for a passage across chapters", async () => {
    const { env, calls } = apiEnv((url) => {
      if (url.pathname.endsWith("/word-links")) return { wordLinks: [] };
      if (url.pathname.endsWith("/notes")) {
        return {
          book: "GEN",
          notes: [
            {
              chapter: "front",
              verse: "intro",
              id: "book",
              note: "# Introduction to Genesis\n\nBook.",
              quote: "",
              supportReference: "",
            },
            {
              chapter: "1",
              verse: "intro",
              id: "ch1",
              note: "# Genesis 1\n\nFirst.",
              quote: "",
              supportReference: "",
            },
            {
              chapter: "2",
              verse: "intro",
              id: "ch2",
              note: "# Genesis 2\n\nSecond.",
              quote: "",
              supportReference: "",
            },
            {
              chapter: "3",
              verse: "intro",
              id: "ch3",
              note: "# Genesis 3\n\nNot this range.",
              quote: "",
              supportReference: "",
            },
            {
              chapter: "1",
              verse: "31",
              id: "end",
              quote: "evening",
              note: "The sixth day.",
              supportReference: "",
            },
            {
              chapter: "2",
              verse: "3",
              id: "rest",
              quote: "rested",
              note: "The seventh day.",
              supportReference: "",
            },
          ],
        };
      }
      return { notes: [] };
    });
    const result = await getPassageIndexV3Tool.handler(
      { reference: "GEN 1:31-2:3", language: "en" },
      env,
      "req",
    );
    expect(
      calls
        .find((url) => url.pathname.endsWith("/notes"))
        ?.searchParams.get("reference"),
    ).toBe("GEN 1:31-2:3");
    expect(
      calls
        .find((url) => url.pathname.endsWith("/notes"))
        ?.searchParams.get("fields"),
    ).toBeNull();
    const notes = result.structuredContent?.notes as Array<{
      id: string;
      reference: string;
    }>;
    expect(notes.map((note) => note.id)).toEqual(["end", "rest"]);
    expect(notes.map((note) => note.reference)).toEqual([
      "GEN 1:31",
      "GEN 2:3",
    ]);
    const introductions = result.structuredContent?.introductions as Array<{
      reference: string;
      title: string;
    }>;
    expect(introductions.map((row) => row.reference)).toEqual([
      "GEN front:intro",
      "GEN 1:intro",
      "GEN 2:intro",
    ]);
    expect(introductions.map((row) => row.title)).toEqual([
      "Introduction to Genesis",
      "Genesis 1",
      "Genesis 2",
    ]);
  });
});

describe("v3 th_get_notes", () => {
  it("is registered under the prefixed name", () => {
    expect(getNotesV3Tool.name).toBe("th_get_notes");
  });

  it("returns several notes by ids and accepts a single id", async () => {
    const { env, calls } = apiEnv(indexPayload);
    const many = await getNotesV3Tool.handler(
      { reference: "GEN 9:9", language: "en", ids: ["n2", "n1"] },
      env,
      "req",
    );
    expect(
      calls
        .find((url) => url.pathname.endsWith("/notes"))
        ?.searchParams.get("reference"),
    ).toBe("GEN 9:9");
    expect(many.isError).not.toBe(true);
    const notes = many.structuredContent?.notes as Array<
      Record<string, unknown>
    >;
    expect(notes.map((note) => note.id)).toEqual(["n2", "n1"]);
    expect(notes[0]).toMatchObject({
      reference: "Genesis 9:9",
      quote: "seed",
      alignedQuote: "offspring",
      note: "Your offspring.",
    });
    expect(notes[0]?.next).toBeUndefined();
    expect(notes[0]?.taArticle).toBeUndefined();
    expect(notes[1]).toMatchObject({
      quote: "covenant",
      alignedQuote: "my covenant",
      note: "This is my covenant.",
      taArticle: { path: "translate/figs-metaphor", title: "Metaphor" },
      next: {
        tool: "th_get_article",
        args: { path: "translate/figs-metaphor", language: "en" },
      },
    });

    const one = await getNotesV3Tool.handler(
      getNotesV3Tool.inputSchema.parse(
        normalizeV3ToolArgs("th_get_notes", {
          reference: "GEN 9:9",
          language: "en",
          id: "n2",
        }),
      ),
      env,
      "req-id",
    );
    expect(
      (one.structuredContent?.notes as Array<{ id: string }>).map(
        (note) => note.id,
      ),
    ).toEqual(["n2"]);
  });

  it("filters by phrase in the quote, the aligned quote, or the body", async () => {
    const { env } = apiEnv(indexPayload);
    const quote = await getNotesV3Tool.handler(
      { reference: "GEN 9:9", language: "en", phrase: "COVENANT" },
      env,
      "req-quote",
    );
    expect(
      (quote.structuredContent?.notes as Array<{ id: string }>).map(
        (note) => note.id,
      ),
    ).toEqual(["n1"]);

    const aligned = await getNotesV3Tool.handler(
      { reference: "GEN 9:9", language: "en", phrase: "offspring" },
      env,
      "req-aligned",
    );
    expect(
      (aligned.structuredContent?.notes as Array<{ id: string }>).map(
        (note) => note.id,
      ),
    ).toEqual(["n2"]);

    const body = await getNotesV3Tool.handler(
      { reference: "JON 1", language: "en", phrase: "fled" },
      env,
      "req-body",
    );
    expect(
      (body.structuredContent?.notes as Array<{ id: string }>).map(
        (note) => note.id,
      ),
    ).toEqual(["verse"]);
  });

  it("returns an empty list when the phrase matches nothing", async () => {
    const { env } = apiEnv(indexPayload);
    const result = await getNotesV3Tool.handler(
      { reference: "GEN 9:9", language: "en", phrase: "zzzz nothing" },
      env,
      "req",
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.notes).toEqual([]);
    expect(JSON.stringify(result.structuredContent)).toMatch(/zzzz nothing/);
    expect(JSON.stringify(result.structuredContent)).toMatch(/no notes/i);
  });

  it("uses OBS-TN or OBS-SN from kind, and Bible study is not available", async () => {
    const { env, calls } = apiEnv(indexPayload);
    const study = await getNotesV3Tool.handler(
      { reference: "JHN 3:16", language: "en", kind: "study" },
      env,
      "req-study",
    );
    expect(calls).toEqual([]);
    expect(study.isError).not.toBe(true);
    expect(study.structuredContent).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
    });

    await getNotesV3Tool.handler(
      { reference: "OBS 1:3", language: "en", kind: "translation" },
      env,
      "req-tn",
    );
    await getNotesV3Tool.handler(
      { reference: "OBS 1:3", language: "en", kind: "study" },
      env,
      "req-sn",
    );
    expect(calls.map((url) => url.pathname)).toEqual([
      "/api/v1/obs-notes",
      "/api/v1/obs-study-notes",
    ]);
  });

  it("returns an introduction and a book introduction, with verse links rewritten", async () => {
    const { env, calls } = apiEnv(indexPayload);
    const chapter = await getNotesV3Tool.handler(
      { reference: "JON 1:intro", language: "en" },
      env,
      "req-intro",
    );
    expect(
      calls
        .find((url) => url.pathname.endsWith("/notes"))
        ?.searchParams.get("reference"),
    ).toBe("JON 1");
    const introNotes = chapter.structuredContent?.notes as Array<
      Record<string, unknown>
    >;
    expect(introNotes.map((note) => note.id)).toEqual(["ch1"]);
    expect(introNotes[0]).toMatchObject({
      reference: "JON 1:intro",
      note: "# Jonah 1\n\nThe prophet.",
    });

    const book = await getNotesV3Tool.handler(
      { reference: "Jonah", language: "en" },
      env,
      "req-book",
    );
    const bookCalls = calls.filter((url) => url.pathname.endsWith("/notes"));
    expect(bookCalls.at(-1)?.searchParams.get("reference")).toBe("JON 1");
    const bookNotes = book.structuredContent?.notes as Array<
      Record<string, unknown>
    >;
    expect(bookNotes.map((note) => note.id)).toEqual(["book"]);
    expect(bookNotes[0]?.reference).toBe("JON front:intro");
    expect(bookNotes[0]?.note).toMatch(/Jonah 1:29/);
    expect(String(bookNotes[0]?.note)).not.toMatch(/\.md/);
  });
});
