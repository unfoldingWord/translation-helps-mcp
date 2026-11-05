/**
 * A language with no notes or questions for a book is not an empty verse.
 * A hit names the catalog repo that answered (`source`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env as ToolEnv } from "../../src/mcp/agent.js";

const files = vi.hoisted(() => new Map<string, string>());

const OWNERS: Record<string, string> = {
  ar: "BSOJ",
  en: "unfoldingWord",
  hi: "translationCore-Create-BCS",
  "es-419": "es-419_gl",
};
const VERSIONS: Record<string, string> = {
  ar: "v6.1",
  en: "v85",
  hi: "v16",
  "es-419": "v4",
};

vi.mock("../../src/api/routes/alignmentHelper.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/api/routes/alignmentHelper.js")
    >();
  return { ...actual, batchGatewayQuotes: async () => new Map() };
});

vi.mock("@translation-helps/door43", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@translation-helps/door43")>();
  return {
    ...actual,
    getArticleTitleMap: async () => new Map<string, string>(),
    resolveCatalogLanguage: async (
      lang: string,
      opts?: { subject?: string },
    ) => {
      if (lang === "fr") return { language: lang, entries: [] };
      const questions = /Questions/i.test(opts?.subject ?? "");
      const kind = questions ? "tq" : "tn";
      const repo = `${lang}_${kind}`;
      return {
        language: lang,
        entries: [
          {
            owner: OWNERS[lang] ?? "unfoldingWord",
            repo,
            name: repo,
            language: lang,
            subject: opts?.subject,
            ingredients: [],
            catalog: {
              prod: {
                branch_or_tag_name: VERSIONS[lang] ?? "v1",
                zipball_url: `https://example.test/${lang}-${kind}.zip`,
              },
            },
          },
        ],
      };
    },
    ZipResourceFetcher2: class {
      lastCacheSource = "memory" as const;
      async getFileText(url: string): Promise<string | null> {
        return files.get(url) ?? null;
      }
    },
  };
});

import { handleNotes } from "../../src/api/routes/notes.js";
import { handleQuestions } from "../../src/api/routes/questions.js";
import type { Env } from "../../src/api/worker.js";
import { getNoteTool } from "../../src/mcp/tools/getNote.js";
import { getPassageIndexTool } from "../../src/mcp/tools/getPassageIndex.js";
import { getPassageQuestionsTool } from "../../src/mcp/tools/getPassageQuestions.js";
import { getWordArticleTool } from "../../src/mcp/tools/getWordArticle.js";
import { GET_QUESTIONS_DESCRIPTION } from "../../src/mcp/v3/tools/getQuestions.js";

const NOTES_HEADER =
  "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote";
const QUESTIONS_HEADER =
  "Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse";

function noteRow(reference: string, id: string, text: string): string {
  return `${reference}\t${id}\t\t\tword\t1\t${text}`;
}

function questionRow(reference: string, id: string): string {
  return `${reference}\t${id}\t\t\t1\tWhat?\tAn answer.`;
}

const ctx = {
  env: {} as Env,
  execCtx: {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext,
};

function routeUrl(path: string, query: Record<string, string>): URL {
  const url = new URL(`https://example.test${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function read(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function api(routes: Record<string, unknown>): ToolEnv {
  return {
    API: {
      async fetch(input: RequestInfo | URL) {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
        );
        const body = routes[url.pathname];
        if (!body) {
          return Response.json(
            { error: { code: "NOT_FOUND", message: url.pathname } },
            { status: 404 },
          );
        }
        return Response.json(body);
      },
    },
  } as ToolEnv;
}

beforeEach(() => {
  files.clear();
  files.set(
    "https://example.test/ar-tn.zip",
    [NOTES_HEADER, noteRow("2:11", "n2", "Grace appeared.")].join("\n"),
  );
  files.set(
    "https://example.test/ar-tq.zip",
    [QUESTIONS_HEADER, questionRow("2:11", "q2")].join("\n"),
  );
  files.set(
    "https://example.test/en-tn.zip",
    [NOTES_HEADER, noteRow("2:1", "n1", "A note on 2:1.")].join("\n"),
  );
  files.set(
    "https://example.test/en-tq.zip",
    [QUESTIONS_HEADER, questionRow("2:1", "q1")].join("\n"),
  );
});

describe("notes and questions routes", () => {
  it("says Hindi has no Titus notes or questions", async () => {
    const notes = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", {
          reference: "TIT 2:11",
          language: "hi",
        }),
      }),
    );
    const questions = await read(
      await handleQuestions({
        ...ctx,
        url: routeUrl("/api/v1/questions", {
          reference: "TIT 2:11",
          language: "hi",
        }),
      }),
    );
    for (const body of [notes, questions]) {
      expect(body).toMatchObject({
        available: false,
        code: "RESOURCE_NOT_AVAILABLE",
      });
      expect(body.message).toContain("hi");
      expect(body.message).toContain("TIT");
    }
    expect(notes.source).toEqual({
      owner: "translationCore-Create-BCS",
      repo: "hi_tn",
      version: "v16",
      language: "hi",
    });
    expect(questions.source).toEqual({
      owner: "translationCore-Create-BCS",
      repo: "hi_tq",
      version: "v16",
      language: "hi",
    });
  });

  it("says es-419 has no Luke notes or questions", async () => {
    const notes = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", {
          reference: "LUK 15:1",
          language: "es-419",
        }),
      }),
    );
    const questions = await read(
      await handleQuestions({
        ...ctx,
        url: routeUrl("/api/v1/questions", {
          reference: "LUK 15:1",
          language: "es-419",
        }),
      }),
    );
    for (const body of [notes, questions]) {
      expect(body).toMatchObject({
        available: false,
        code: "RESOURCE_NOT_AVAILABLE",
      });
      expect(body.message).toContain("es-419");
      expect(body.message).toContain("LUK");
    }
  });

  it("says French has no notes or questions resource, and names the book", async () => {
    const notes = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", {
          reference: "ROM 1:1",
          language: "fr",
        }),
      }),
    );
    const questions = await read(
      await handleQuestions({
        ...ctx,
        url: routeUrl("/api/v1/questions", {
          reference: "ROM 1:1",
          language: "fr",
        }),
      }),
    );
    for (const body of [notes, questions]) {
      expect(body).toMatchObject({
        available: false,
        code: "RESOURCE_NOT_AVAILABLE",
      });
      expect(body.message).toContain("fr");
      expect(body.message).toContain("ROM");
      expect(body.source).toBeUndefined();
    }
  });

  it("names BSOJ/ar_tn and its version on Arabic Titus notes", async () => {
    const notes = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", {
          reference: "TIT 2:11",
          language: "ar",
        }),
      }),
    );
    expect(notes.available).not.toBe(false);
    expect(notes.source).toEqual({
      owner: "BSOJ",
      repo: "ar_tn",
      version: "v6.1",
      language: "ar",
    });
    const rows = notes.notes as Array<{ id: string }>;
    expect(rows.some((row) => row.id === "n2")).toBe(true);

    const questions = await read(
      await handleQuestions({
        ...ctx,
        url: routeUrl("/api/v1/questions", {
          reference: "TIT 2:11",
          language: "ar",
        }),
      }),
    );
    expect(questions.available).not.toBe(false);
    expect(questions.source).toEqual({
      owner: "BSOJ",
      repo: "ar_tq",
      version: "v6.1",
      language: "ar",
    });
    expect((questions.questions as unknown[]).length).toBeGreaterThan(0);
  });

  it("keeps an English verse with no rows as an empty success", async () => {
    const covered = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", {
          reference: "TIT 2:1",
          language: "en",
        }),
      }),
    );
    expect(covered.available).not.toBe(false);
    expect(
      (covered.notes as Array<{ id: string }>).some((row) => row.id === "n1"),
    ).toBe(true);

    const notes = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", {
          reference: "TIT 2:11",
          language: "en",
        }),
      }),
    );
    const questions = await read(
      await handleQuestions({
        ...ctx,
        url: routeUrl("/api/v1/questions", {
          reference: "TIT 2:11",
          language: "en",
        }),
      }),
    );
    expect(notes.available).not.toBe(false);
    expect(notes.notes).toEqual([]);
    expect(notes.source).toEqual({
      owner: "unfoldingWord",
      repo: "en_tn",
      version: "v85",
      language: "en",
    });
    expect(questions.available).not.toBe(false);
    expect(questions.questions).toEqual([]);
    expect(questions.source).toEqual({
      owner: "unfoldingWord",
      repo: "en_tq",
      version: "v85",
      language: "en",
    });
  });

  it("uses the language-pack view source when that path answers", async () => {
    const view = {
      schema: 1,
      language: "ar",
      book: "TIT",
      chapter: 2,
      sources: {
        notes: { key: "BSOJ/ar/tn", title: "Notes", version: "v66" },
      },
      notes: [
        {
          id: "pack",
          reference: "2:11",
          verse: 11,
          intro: null,
          quote: "grace",
          occurrence: "1",
          note: "From the pack.",
          tags: "",
          supportReference: "",
          supportReferenceTitle: null,
          aligned: { literal: "grace", simple: null },
        },
      ],
    };
    const body = await read(
      await handleNotes({
        url: routeUrl("/api/v1/notes", {
          reference: "TIT 2:11",
          language: "ar",
        }),
        env: {
          LANGUAGE_PACKS: {
            async get(key: string) {
              if (key !== "v1/ar/notes/TIT/2.json") return null;
              return { json: async () => view };
            },
          },
        } as unknown as Env,
        execCtx: ctx.execCtx,
      }),
    );
    expect(body.meta).toMatchObject({ cache: "pack" });
    expect(body.sources).toMatchObject({
      notes: { key: "BSOJ/ar/tn", version: "v66" },
    });
    expect(body.source).toEqual({
      owner: "BSOJ",
      repo: "ar_tn",
      version: "v66",
      language: "ar",
    });
    expect(
      (body.notes as Array<{ id: string }>).some((row) => row.id === "pack"),
    ).toBe(true);
  });
});

describe("v2 tools pass on not-available and source", () => {
  const hiNotes = {
    available: false,
    code: "RESOURCE_NOT_AVAILABLE",
    book: "TIT",
    language: "hi",
    notes: [],
    message: 'No TSV Translation Notes file for "TIT" in language "hi".',
    source: {
      owner: "translationCore-Create-BCS",
      repo: "hi_tn",
      version: "v16",
      language: "hi",
    },
  };

  it("get_note and get_questions say the book is missing", async () => {
    const env = api({
      "/api/v1/notes": hiNotes,
      "/api/v1/questions": {
        ...hiNotes,
        questions: [],
        source: { ...hiNotes.source, repo: "hi_tq" },
      },
    });
    const note = await getNoteTool.handler(
      { reference: "TIT 2:11", language: "hi" },
      env,
      "t",
    );
    const questions = await getPassageQuestionsTool.handler(
      { reference: "TIT 2:11", language: "hi" },
      env,
      "t",
    );
    for (const result of [note, questions]) {
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        available: false,
        code: "RESOURCE_NOT_AVAILABLE",
      });
      expect(result.structuredContent?.message).toContain("hi");
      expect(result.structuredContent?.message).toContain("TIT");
      const hints = result.structuredContent?.hints as string[];
      expect(hints[0]).toContain("list_resources");
    }
  });

  it("get_passage_index keeps word links when only the notes are missing", async () => {
    const index = await getPassageIndexTool.handler(
      { reference: "TIT 2:11", language: "hi" },
      api({
        "/api/v1/notes": hiNotes,
        "/api/v1/word-links": {
          book: "TIT",
          language: "hi",
          wordLinks: [
            {
              book: "TIT",
              chapter: "2",
              verse: "11",
              origWords: "grace",
              occurrence: "1",
              wordPath: "bible/kt/grace",
              twTitle: "Grace",
            },
          ],
        },
      }),
      "t",
    );
    expect(index.isError).toBe(false);
    expect(index.structuredContent?.available).not.toBe(false);
    expect(index.structuredContent?.notesAvailable).toBe(false);
    expect(index.structuredContent?.notes).toEqual([]);
    expect(index.structuredContent?.message).toBe(
      'Translation notes are not available for language "hi".',
    );
    expect(
      (index.structuredContent?.words as unknown[]).length,
    ).toBeGreaterThan(0);
  });

  it("get_passage_index is not available only when notes and word links are both missing", async () => {
    const index = await getPassageIndexTool.handler(
      { reference: "ROM 1:1", language: "fr" },
      api({
        "/api/v1/notes": {
          available: false,
          code: "RESOURCE_NOT_AVAILABLE",
          book: "ROM",
          language: "fr",
          notes: [],
          message:
            'No TSV Translation Notes resource available for book "ROM" in language "fr".',
        },
        "/api/v1/word-links": {
          available: false,
          code: "RESOURCE_NOT_AVAILABLE",
          book: "ROM",
          language: "fr",
          wordLinks: [],
          message:
            'No TSV Translation Words Links resource available for language "fr".',
        },
      }),
      "t",
    );
    expect(index.isError).toBe(false);
    expect(index.structuredContent).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
    });
    expect(index.structuredContent?.message).toContain("fr");
    expect(index.structuredContent?.message).toContain("ROM");
    const hints = index.structuredContent?.hints as string[];
    expect(hints[0]).toContain("list_resources");
  });

  it("keeps a covered verse with no rows as an empty success and passes source", async () => {
    const source = {
      owner: "unfoldingWord",
      repo: "en_tn",
      version: "v85",
      language: "en",
    };
    const env = api({
      "/api/v1/notes": {
        book: "TIT",
        language: "en",
        notes: [],
        source,
      },
      "/api/v1/questions": {
        book: "TIT",
        language: "en",
        questions: [],
        source: { ...source, repo: "en_tq" },
      },
      "/api/v1/word-links": { book: "TIT", wordLinks: [] },
    });
    const note = await getNoteTool.handler(
      { reference: "TIT 2:11", language: "en" },
      env,
      "t",
    );
    const questions = await getPassageQuestionsTool.handler(
      { reference: "TIT 2:11", language: "en" },
      env,
      "t",
    );
    const index = await getPassageIndexTool.handler(
      { reference: "TIT 2:11", language: "en" },
      env,
      "t",
    );
    expect(note.structuredContent).toMatchObject({
      notes: [],
      source,
    });
    expect(note.structuredContent?.available).not.toBe(false);
    expect(questions.structuredContent).toMatchObject({
      questions: [],
      source: { ...source, repo: "en_tq" },
    });
    expect(questions.structuredContent?.available).not.toBe(false);
    expect(index.structuredContent?.available).not.toBe(false);
    expect(index.structuredContent?.notes).toEqual([]);
  });

  it("get_note names BSOJ/ar_tn when the API does", async () => {
    const result = await getNoteTool.handler(
      { reference: "TIT 2:11", language: "ar" },
      api({
        "/api/v1/notes": {
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
          source: {
            owner: "BSOJ",
            repo: "ar_tn",
            version: "v6.1",
            language: "ar",
          },
        },
      }),
      "t",
    );
    expect(result.structuredContent?.source).toEqual({
      owner: "BSOJ",
      repo: "ar_tn",
      version: "v6.1",
      language: "ar",
    });
  });

  it("get_word_article passes the catalog source", async () => {
    const result = await getWordArticleTool.handler(
      { path: "bible/kt/grace", language: "ar" },
      api({
        "/api/v1/words/bible/kt/grace": {
          language: "ar",
          path: "bible/kt/grace",
          title: "Grace",
          article: "# Grace\n\nDefinition.",
          source: {
            owner: "BSOJ",
            repo: "ar_tw",
            version: "v3",
            language: "ar",
          },
        },
      }),
      "t",
    );
    expect(result.structuredContent).toMatchObject({
      path: "bible/kt/grace",
      source: {
        owner: "BSOJ",
        repo: "ar_tw",
        version: "v3",
        language: "ar",
      },
    });
  });

  it("tells the model that available false is a missing resource", () => {
    expect(getNoteTool.description).toMatch(/do not answer from memory/);
    expect(getPassageQuestionsTool.description).toMatch(
      /do not answer from memory/,
    );
    expect(getPassageIndexTool.description).toMatch(
      /do not answer from memory/,
    );
    expect(GET_QUESTIONS_DESCRIPTION).toMatch(/do not answer from memory/i);
  });
});
