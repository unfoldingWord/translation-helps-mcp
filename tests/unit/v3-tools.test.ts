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
        return Response.json(payload(url));
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
    });
    const languages = result.structuredContent?.languages as unknown[];
    expect(languages).toHaveLength(1);
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
  });

  it("forwards a reference filter to the resources route", async () => {
    const { env, calls } = apiEnv(passagePayload);
    await listResourcesV3Tool.handler(
      { language: "en", reference: "JHN 3:16" },
      env,
      "req-ref",
    );
    const resources = calls.find((url) => url.pathname.endsWith("/resources"));
    expect(resources?.searchParams.get("reference")).toBe("JHN 3:16");
  });
});
