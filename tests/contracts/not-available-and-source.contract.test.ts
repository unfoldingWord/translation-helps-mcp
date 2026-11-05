/**
 * /v2/mcp and /v3/mcp, through the Worker fetch.
 * Missing books are RESOURCE_NOT_AVAILABLE. Hits carry `source`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../../src/worker.js";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit.js";

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const AR_NOTES = {
  owner: "BSOJ",
  repo: "ar_tn",
  version: "v6.1",
  language: "ar",
};

function missing(
  language: string,
  book: string,
  kind: "notes" | "questions",
): Record<string, unknown> {
  const repo =
    language === "hi"
      ? `hi_${kind === "notes" ? "tn" : "tq"}`
      : `es-419_${kind === "notes" ? "tn" : "tq"}`;
  const owner = language === "hi" ? "translationCore-Create-BCS" : "es-419_gl";
  const languageLevel = language === "fr";
  return {
    reference: `${book} 1:1`,
    language,
    book,
    [kind]: [],
    available: false,
    code: "RESOURCE_NOT_AVAILABLE",
    message: languageLevel
      ? `No resource available for book "${book}" in language "${language}".`
      : `No file for "${book}" in language "${language}".`,
    ...(languageLevel
      ? {}
      : {
          source: {
            owner,
            repo,
            version: "v1",
            language,
          },
        }),
  };
}

function apiFetcher(): Fetcher {
  return {
    async fetch(input: RequestInfo | URL) {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(raw);
      const path = url.pathname;
      const language = url.searchParams.get("language") ?? "";
      const reference = url.searchParams.get("reference") ?? "";
      const book = reference.split(/\s+/)[0] || "TIT";

      if (path.endsWith("/notes")) {
        if (language === "ar") {
          return Response.json({
            book: "TIT",
            language: "ar",
            notes: [
              {
                id: "n2",
                book: "TIT",
                chapter: "2",
                verse: "11",
                note: "Grace appeared.",
                quote: "grace",
                occurrence: "1",
                supportReference: "",
              },
            ],
            source: AR_NOTES,
          });
        }
        if (language === "en") {
          return Response.json({
            book: "TIT",
            language: "en",
            notes: [],
            source: {
              owner: "unfoldingWord",
              repo: "en_tn",
              version: "v85",
              language: "en",
            },
          });
        }
        return Response.json(missing(language, book, "notes"));
      }

      if (path.endsWith("/questions")) {
        if (language === "en") {
          return Response.json({
            book: "TIT",
            language: "en",
            questions: [],
            source: {
              owner: "unfoldingWord",
              repo: "en_tq",
              version: "v85",
              language: "en",
            },
          });
        }
        if (language === "ar") {
          return Response.json({
            book: "TIT",
            language: "ar",
            questions: [{ id: "q2", question: "What?", response: "Grace." }],
            source: { ...AR_NOTES, repo: "ar_tq" },
          });
        }
        return Response.json(missing(language, book, "questions"));
      }

      if (path.endsWith("/word-links")) {
        if (language === "fr") {
          return Response.json({
            book,
            language,
            wordLinks: [],
            available: false,
            code: "RESOURCE_NOT_AVAILABLE",
            message: `No TSV Translation Words Links resource available for language "${language}".`,
          });
        }
        if (language === "hi") {
          return Response.json({
            book,
            language,
            wordLinks: [
              {
                chapter: "2",
                verse: "11",
                origWords: "grace",
                occurrence: "1",
                wordPath: "bible/kt/grace",
                twTitle: "Grace",
              },
            ],
          });
        }
        return Response.json({ book, language, wordLinks: [] });
      }

      if (path.includes("/words/") || path.includes("/academy/")) {
        const academy = path.includes("/academy/");
        return Response.json({
          language: "ar",
          path: academy ? "translate/figs-metaphor" : "bible/kt/grace",
          title: academy ? "Metaphor" : "Grace",
          article: academy ? "# Metaphor\n\nA figure." : "# Grace\n\nA gift.",
          source: {
            owner: "BSOJ",
            repo: academy ? "ar_ta" : "ar_tw",
            version: "v3",
            language: "ar",
          },
        });
      }

      return Response.json(
        { error: { code: "NOT_FOUND", message: path } },
        { status: 404 },
      );
    },
  } as Fetcher;
}

function env(): Env {
  return {
    API: apiFetcher(),
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    RATE_LIMIT_RPM: "0",
  } as unknown as Env;
}

function executionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

async function call(
  path: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}> {
  const response = await worker.fetch(
    new Request(`https://example.test${path}`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    env(),
    executionContext(),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result?: {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    error?: { message?: string };
  };
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return body.result ?? {};
}

function expectMissing(
  result: { isError?: boolean; structuredContent?: Record<string, unknown> },
  language: string,
  book: string,
  hint: string,
): void {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    available: false,
    code: "RESOURCE_NOT_AVAILABLE",
  });
  const message = String(result.structuredContent?.message ?? "");
  expect(message).toContain(language);
  expect(message).toContain(book);
  const hints = result.structuredContent?.hints as string[];
  expect(hints[0]).toContain(hint);
}

beforeEach(() => {
  resetRateLimitStoreForTests();
});

describe("not available and source over the worker", () => {
  it.each([
    ["hi", "TIT 2:11", "TIT"],
    ["es-419", "LUK 15:1", "LUK"],
    ["fr", "ROM 1:1", "ROM"],
  ])(
    "v2 %s %s notes and questions are not available",
    async (language, reference, book) => {
      for (const name of ["get_note", "get_questions"]) {
        const result = await call("/v2/mcp", name, { reference, language });
        expectMissing(result, language, book, "list_resources");
      }
    },
  );

  it("v2 Hindi Titus index keeps the word links and flags the missing notes", async () => {
    const result = await call("/v2/mcp", "get_passage_index", {
      reference: "TIT 2:11",
      language: "hi",
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.available).not.toBe(false);
    expect(result.structuredContent?.notesAvailable).toBe(false);
    expect(result.structuredContent?.notes).toEqual([]);
    expect(result.structuredContent?.message).toBe(
      'Translation notes are not available for language "hi".',
    );
    expect(
      (result.structuredContent?.words as unknown[]).length,
    ).toBeGreaterThan(0);
  });

  it("v2 French Romans index is not available when notes and word links are both missing", async () => {
    const result = await call("/v2/mcp", "get_passage_index", {
      reference: "ROM 1:1",
      language: "fr",
    });
    expectMissing(result, "fr", "ROM", "list_resources");
  });

  it("v2 keeps an English verse with no notes as an empty success", async () => {
    const note = await call("/v2/mcp", "get_note", {
      reference: "TIT 2:11",
      language: "en",
    });
    expect(note.isError).not.toBe(true);
    expect(note.structuredContent?.available).not.toBe(false);
    expect(note.structuredContent?.notes).toEqual([]);
    expect(note.structuredContent?.source).toEqual({
      owner: "unfoldingWord",
      repo: "en_tn",
      version: "v85",
      language: "en",
    });

    const questions = await call("/v2/mcp", "get_questions", {
      reference: "TIT 2:11",
      language: "en",
    });
    expect(questions.structuredContent?.available).not.toBe(false);
    expect(questions.structuredContent?.questions).toEqual([]);
    expect(questions.structuredContent?.source).toMatchObject({
      owner: "unfoldingWord",
      repo: "en_tq",
    });
  });

  it("v2 Arabic notes and articles name BSOJ", async () => {
    const note = await call("/v2/mcp", "get_note", {
      reference: "TIT 2:11",
      language: "ar",
    });
    expect(note.structuredContent?.source).toEqual(AR_NOTES);

    const word = await call("/v2/mcp", "get_word_article", {
      path: "bible/kt/grace",
      language: "ar",
    });
    expect(word.structuredContent?.source).toEqual({
      owner: "BSOJ",
      repo: "ar_tw",
      version: "v3",
      language: "ar",
    });

    const academy = await call("/v2/mcp", "get_academy_article", {
      path: "translate/figs-metaphor",
      language: "ar",
    });
    expect(academy.structuredContent?.source).toEqual({
      owner: "BSOJ",
      repo: "ar_ta",
      version: "v3",
      language: "ar",
    });
  });

  it.each([
    ["hi", "TIT 2:11", "TIT"],
    ["es-419", "LUK 15:1", "LUK"],
    ["fr", "ROM 1:1", "ROM"],
  ])(
    "v3 th_get_questions %s %s is not available",
    async (language, reference, book) => {
      const result = await call("/v3/mcp", "th_get_questions", {
        reference,
        language,
      });
      expectMissing(result, language, book, "th_list_resources");
    },
  );

  it("v3 notes, questions and the article carry source", async () => {
    const notes = await call("/v3/mcp", "th_get_notes", {
      reference: "TIT 2:11",
      language: "ar",
    });
    expect(notes.isError).not.toBe(true);
    expect(notes.structuredContent?.source).toEqual(AR_NOTES);

    const questions = await call("/v3/mcp", "th_get_questions", {
      reference: "TIT 2:11",
      language: "en",
    });
    expect(questions.structuredContent?.available).not.toBe(false);
    expect(questions.structuredContent?.questions).toEqual([]);
    expect(questions.structuredContent?.source).toMatchObject({
      owner: "unfoldingWord",
      repo: "en_tq",
      version: "v85",
    });

    const article = await call("/v3/mcp", "th_get_article", {
      path: "bible/kt/grace",
      language: "ar",
    });
    expect(article.structuredContent?.source).toEqual({
      owner: "BSOJ",
      repo: "ar_tw",
      version: "v3",
      language: "ar",
    });
  });

  it("v3 Hindi Titus index keeps the word links and flags the missing notes", async () => {
    const result = await call("/v3/mcp", "th_get_passage_index", {
      reference: "TIT 2:11",
      language: "hi",
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.available).not.toBe(false);
    expect(result.structuredContent?.notesAvailable).toBe(false);
    expect(result.structuredContent?.notes).toEqual([]);
    expect(result.structuredContent?.message).toBe(
      'Translation notes are not available for language "hi".',
    );
    expect(
      (result.structuredContent?.words as unknown[]).length,
    ).toBeGreaterThan(0);
  });

  it("v3 French Romans index is not available when notes and word links are both missing", async () => {
    const result = await call("/v3/mcp", "th_get_passage_index", {
      reference: "ROM 1:1",
      language: "fr",
    });
    expectMissing(result, "fr", "ROM", "th_list_resources");
  });

  it("v3 says Hindi Titus notes are not available", async () => {
    const result = await call("/v3/mcp", "th_get_notes", {
      reference: "TIT 2:11",
      language: "hi",
    });
    expectMissing(result, "hi", "TIT", "th_list_resources");
  });
});
