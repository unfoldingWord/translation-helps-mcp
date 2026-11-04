/**
 * /v3/mcp over the real Worker fetch.
 *
 * Stateless POST only. A session id is 405, not a Durable Object. /v2/mcp
 * still lists the sixteen v2 tools, and /mcp/v3 stays on that v2 alias.
 */
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import worker, { type Env } from "../../src/worker.js";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { SERVER_NAME } from "../../src/core/version.js";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit.js";
import {
  GET_PASSAGE_DESCRIPTION,
  getPassageV3Tool,
} from "../../src/mcp/v3/tools/getPassage.js";
import {
  GET_QUESTIONS_DESCRIPTION,
  getQuestionsV3Tool,
} from "../../src/mcp/v3/tools/getQuestions.js";
import {
  LIST_RESOURCES_DESCRIPTION,
  listResourcesV3Tool,
} from "../../src/mcp/v3/tools/listResources.js";
import {
  GET_PASSAGE_INDEX_DESCRIPTION,
  getPassageIndexV3Tool,
} from "../../src/mcp/v3/tools/getPassageIndex.js";
import {
  GET_NOTES_DESCRIPTION,
  getNotesV3Tool,
} from "../../src/mcp/v3/tools/getNotes.js";
import {
  GET_ARTICLE_DESCRIPTION,
  getArticleV3Tool,
} from "../../src/mcp/v3/tools/getArticle.js";
import {
  SEARCH_DESCRIPTION,
  searchV3Tool,
} from "../../src/mcp/v3/tools/search.js";

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

/**
 * Names and order registered on /v2/mcp. A test that only compares the HTTP
 * list with the Durable Object registration would stay green if both changed.
 */
const V2_TOOL_NAMES = [
  "list_languages",
  "list_resources",
  "get_passage",
  "get_passage_context",
  "get_passage_index",
  "get_note",
  "get_academy_article",
  "get_word_article",
  "get_questions",
  "search_articles",
  "get_obs_story",
  "get_obs_notes",
  "get_obs_index",
  "get_obs_questions",
  "get_obs_study_notes",
  "get_obs_study_questions",
] as const;

/**
 * SHA-256 of the v2 tools/list schemas (name, inputSchema, outputSchema)
 * as T-050 left them on v2 (2.5.0). A change to a v2 tool schema fails this
 * even when the Durable Object and the HTTP path are updated together.
 */
const V2_SCHEMA_SHA256 =
  "e76613e64a4d05e351eb86fc57a32fbf302c37b1918fa46c17bc37fcc0c24314";

const V3_TOOL_NAMES = [
  "th_get_passage",
  "th_get_questions",
  "th_list_resources",
  "th_get_passage_index",
  "th_get_notes",
  "th_get_article",
  "th_search",
];

interface DoNamespace {
  names: string[];
}

function durableObjectNamespace(): Env["MCP_AGENT"] & DoNamespace {
  const names: string[] = [];
  const namespace = {
    names,
    newUniqueId() {
      return { toString: () => "generated-session" };
    },
    idFromName(name: string) {
      names.push(name);
      return { toString: () => name };
    },
    get() {
      return {
        async fetch() {
          return new Response("durable-object", { status: 500 });
        },
      };
    },
  };
  return namespace as unknown as Env["MCP_AGENT"] & DoNamespace;
}

function apiFetcher(calls: URL[]): Fetcher {
  return {
    async fetch(input: RequestInfo | URL) {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(raw);
      calls.push(url);
      const path = url.pathname;
      if (path.endsWith("/prefetch")) {
        return new Response(null, { status: 202 });
      }
      if (path.endsWith("/languages")) {
        return Response.json({
          languages: [
            { code: "en", name: "English", englishName: "English" },
            { code: "es-419", name: "Español", englishName: "Spanish" },
          ],
        });
      }
      if (path.endsWith("/resources")) {
        return Response.json({
          language: url.searchParams.get("language"),
          available: [
            {
              subject: "Bible",
              abbreviation: "ult",
              role: "literal",
              type: "text",
            },
          ],
        });
      }
      if (path.endsWith("/scripture")) {
        return Response.json({
          reference: url.searchParams.get("reference"),
          language: url.searchParams.get("language") ?? "en",
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
        });
      }
      if (path.endsWith("/obs-study-questions")) {
        return Response.json({
          questions: [{ question: "Why?", response: "Because" }],
        });
      }
      if (path.endsWith("/obs-questions")) {
        return Response.json({
          questions: [{ question: "Who?", response: "God" }],
        });
      }
      if (path.endsWith("/questions")) {
        return Response.json({
          questions: [{ question: "Who?", response: "God" }],
        });
      }
      if (path.endsWith("/obs")) {
        return Response.json({
          reference: url.searchParams.get("reference"),
          language: url.searchParams.get("language") ?? "en",
          story: 3,
          frame: 5,
          frames: [{ index: 5, imageUrl: null, text: "frame text" }],
        });
      }
      if (path.endsWith("/obs-notes")) {
        return Response.json({
          reference: url.searchParams.get("reference"),
          notes: [
            {
              reference: "1:3",
              id: "obs-n",
              quote: "created",
              note: "God made the world.",
              supportReference: "rc://*/ta/man/translate/figs-metaphor",
              supportReferenceTitle: "Metaphor",
            },
          ],
        });
      }
      if (path.endsWith("/obs-word-links")) {
        return Response.json({
          reference: url.searchParams.get("reference"),
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
        });
      }
      if (path.endsWith("/word-links")) {
        return Response.json({
          book: "JON",
          wordLinks: [
            {
              chapter: "1",
              verse: "1",
              origWords: "יהוה",
              wordPath: "bible/kt/yahweh",
              twTitle: "Yahweh",
            },
          ],
        });
      }
      if (path.includes("/words/")) {
        return Response.json({
          language: "en",
          path: "bible/kt/hades",
          title: "Hades, Sheol",
          article: "# Hades, Sheol\n\nThe place of the dead.\n",
          requestedPath: url.searchParams.get("requestedPath"),
          resolvedFrom: "title",
          related: [],
        });
      }
      if (path.endsWith("/search")) {
        const types = url.searchParams.get("types");
        const results = [];
        if (!types || types.split(",").includes("ta")) {
          results.push({
            path: "translate/figs-metaphor",
            title: "Metaphor",
            resourceType: "ta",
            score: 1,
          });
        }
        if (!types || types.split(",").includes("tw")) {
          results.push({
            path: "bible/kt/covenant",
            title: "Covenant",
            resourceType: "tw",
            score: 0.5,
          });
        }
        return Response.json({
          q: url.searchParams.get("q"),
          language: url.searchParams.get("language") ?? "en",
          results,
        });
      }
      if (path.endsWith("/notes")) {
        return Response.json({
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
              verse: "1",
              id: "a",
              quote: "word",
              note: "The word of the Lord.",
              supportReference: "rc://*/ta/man/translate/figs-metaphor",
              supportReferenceTitle: "Metaphor",
            },
            {
              chapter: "1",
              verse: "2",
              id: "b",
              quote: "city",
              note: "Nineveh.",
              supportReference: "",
            },
          ],
        });
      }
      return Response.json(
        { error: { code: "NOT_FOUND", message: path } },
        { status: 404 },
      );
    },
  } as Fetcher;
}

interface AnalyticsSpy {
  points: Array<{
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }>;
}

function baseEnv(
  namespace: Env["MCP_AGENT"],
  analytics: AnalyticsSpy,
  calls: URL[],
  extra: Partial<Env> = {},
): Env {
  return {
    MCP_AGENT: namespace,
    ANALYTICS: {
      writeDataPoint(data: {
        blobs?: string[];
        doubles?: number[];
        indexes?: string[];
      }) {
        analytics.points.push(data);
      },
    },
    API: apiFetcher(calls),
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    RATE_LIMIT_RPM: "0",
    ...extra,
  } as Env;
}

function executionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

function rpc(method: string, params: Record<string, unknown>, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

async function postMcp(
  path: string,
  body: unknown,
  env: Env,
  headers: Record<string, string> = {},
): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { ...MCP_HEADERS, ...headers },
      body: JSON.stringify(body),
    }),
    env,
    executionContext(),
  );
}

async function readJson(response: Response): Promise<{
  result?: {
    serverInfo?: { name?: string; version?: string };
    instructions?: string;
    tools?: Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    content?: Array<{ text?: string }>;
  };
  error?: { message?: string };
}> {
  return (await response.json()) as never;
}

function schemaDigest(
  tools: Array<{
    name: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
  }>,
): string {
  const canonical = JSON.stringify(
    tools.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema ?? null,
      outputSchema: tool.outputSchema ?? null,
    })),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

describe("/v3/mcp worker fetch", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  it("lists exactly the seven v3 tools, in registration order", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const response = await postMcp(
      "/v3/mcp",
      rpc("tools/list", {}),
      baseEnv(namespace, analytics, []),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(response);
    const tools = body.result?.tools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual(V3_TOOL_NAMES);
    expect(tools.map((tool) => tool.description)).toEqual([
      getPassageV3Tool.description,
      getQuestionsV3Tool.description,
      listResourcesV3Tool.description,
      getPassageIndexV3Tool.description,
      getNotesV3Tool.description,
      getArticleV3Tool.description,
      searchV3Tool.description,
    ]);
    expect(getPassageV3Tool.description).toBe(GET_PASSAGE_DESCRIPTION);
    expect(getQuestionsV3Tool.description).toBe(GET_QUESTIONS_DESCRIPTION);
    expect(listResourcesV3Tool.description).toBe(LIST_RESOURCES_DESCRIPTION);
    expect(getPassageIndexV3Tool.description).toBe(
      GET_PASSAGE_INDEX_DESCRIPTION,
    );
    expect(getNotesV3Tool.description).toBe(GET_NOTES_DESCRIPTION);
    expect(getArticleV3Tool.description).toBe(GET_ARTICLE_DESCRIPTION);
    expect(searchV3Tool.description).toBe(SEARCH_DESCRIPTION);
    const search = tools.find((tool) => tool.name === "th_search") as {
      inputSchema?: {
        properties?: { query?: { description?: string } };
      };
    };
    const query = search.inputSchema?.properties?.query?.description ?? "";
    expect(query.endsWith("Each result has next for th_get_article.")).toBe(
      true,
    );
    expect(query).not.toMatch(/Pass the matching path/);
    expect(query).toMatch(/figures of speech about the body/);
    const passage = tools.find((tool) => tool.name === "th_get_passage");
    const passageSchema = passage?.inputSchema as {
      properties?: { format?: { enum?: string[] } };
      required?: string[];
    };
    expect(passageSchema.properties?.format?.enum).toEqual(["text", "usfm"]);
    expect(passageSchema.required ?? []).not.toContain("format");
    for (const tool of tools) {
      const listed = tool as {
        title?: string;
        annotations?: {
          title?: string;
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          idempotentHint?: boolean;
          openWorldHint?: boolean;
        };
        inputSchema?: { properties?: Record<string, unknown> };
        outputSchema?: { properties?: Record<string, unknown> };
      };
      expect(listed.title).toBeTruthy();
      expect(listed.annotations).toMatchObject({
        title: listed.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    const notes = tools.find((tool) => tool.name === "th_get_notes") as {
      inputSchema?: { properties?: Record<string, unknown> };
    };
    expect(notes.inputSchema?.properties).not.toHaveProperty("id");
    expect(notes.inputSchema?.properties).toHaveProperty("ids");
    const list = tools.find((tool) => tool.name === "th_list_resources") as {
      inputSchema?: { properties?: Record<string, unknown> };
      outputSchema?: { properties?: Record<string, unknown> };
    };
    expect(list.inputSchema?.properties).not.toHaveProperty("reference");
    expect(list.inputSchema?.properties).toHaveProperty("book");
    expect(list.outputSchema?.properties).not.toHaveProperty("requestId");
    expect(list.outputSchema?.properties).not.toHaveProperty("total_count");
    expect(list.outputSchema?.properties).toHaveProperty("total");
    expect(list.outputSchema?.properties).toHaveProperty("next_offset");
    const index = tools.find(
      (tool) => tool.name === "th_get_passage_index",
    ) as {
      description?: string;
      inputSchema?: { properties?: Record<string, unknown> };
      outputSchema?: { properties?: Record<string, unknown> };
    };
    expect(index.inputSchema?.properties).toHaveProperty("keyTermsOffset");
    expect(index.inputSchema?.properties).not.toHaveProperty("rollupOffset");
    expect(index.outputSchema?.properties).toHaveProperty("keyTermsOffset");
    expect(index.outputSchema?.properties).not.toHaveProperty("rollupOffset");
    expect(index.description).toMatch(
      /An issue or key term has no next: call th_get_article with its path/,
    );
    expect(index.outputSchema?.properties).toHaveProperty("next_offset");
    expect(index.outputSchema?.properties).not.toHaveProperty("keyTermsTotal");
    expect(namespace.names).toEqual([]);
  });

  it("answers initialize as 2.9.0 with no session and no persona", async () => {
    const namespace = durableObjectNamespace();
    const response = await postMcp(
      "/v3/mcp",
      rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "contract", version: "0.0.0" },
      }),
      baseEnv(namespace, { points: [] }, []),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(response);
    expect(body.result?.serverInfo).toEqual({
      name: SERVER_NAME,
      version: "2.9.0",
    });
    const instructions = body.result?.instructions ?? "";
    expect(instructions).not.toMatch(/You are Ezer/);
    expect(instructions).toContain("th_get_passage");
    expect(instructions).toContain("th_get_questions");
    expect(instructions).toContain("th_list_resources");
    expect(instructions).toContain("th_get_passage_index");
    expect(instructions).toContain("th_get_notes");
    expect(instructions).toContain("th_get_article");
    expect(instructions).toContain("th_search");
    expect(instructions).toMatch(/available:\s*false/);
    expect(instructions).toMatch(/isError/);
    expect(instructions).not.toMatch(/comes later/i);
    expect(instructions).toMatch(
      /an article with otherCandidates is the answer/,
    );
    expect(instructions).toMatch(/JHN 3:16/);
    expect(instructions).toMatch(/3:5/);
    expect(namespace.names).toEqual([]);
  });

  it("get_passage loads scripture, OBS text, and decomposed OBS parts", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const calls: URL[] = [];
    const env = baseEnv(namespace, analytics, calls);

    const bible = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_passage",
          arguments: { reference: "JHN 3:16", language: "en" },
        }),
        env,
      ),
    );
    expect(bible.result?.isError).not.toBe(true);
    expect(bible.result?.structuredContent).toMatchObject({
      kind: "bible",
      reference: "JHN 3:16",
      versions: [expect.objectContaining({ role: "literal" })],
    });

    const obs = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_get_passage",
            arguments: { reference: "OBS 3:5", language: "en" },
          },
          2,
        ),
        env,
      ),
    );
    expect(obs.result?.isError).not.toBe(true);
    expect(obs.result?.structuredContent).toMatchObject({
      kind: "obs",
      reference: "OBS 3:5",
      frames: [expect.objectContaining({ index: 5, text: "frame text" })],
    });

    const parts = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_get_passage",
            arguments: { story: 3, frame: 5 },
          },
          3,
        ),
        env,
      ),
    );
    expect(parts.result?.isError).not.toBe(true);
    expect(parts.result?.structuredContent).toMatchObject({
      kind: "obs",
      reference: "OBS 3:5",
    });

    const scripture = calls.find((url) => url.pathname.endsWith("/scripture"));
    expect(scripture?.searchParams.get("reference")).toBe("JHN 3:16");
    const obsCall = calls.find((url) => url.pathname.endsWith("/obs"));
    expect(obsCall?.searchParams.get("reference")).toBe("OBS 3:5");
    expect(
      calls.some(
        (url) =>
          url.pathname.endsWith("/scripture") &&
          url.searchParams.get("reference") === "OBS 3:5",
      ),
    ).toBe(false);
    expect(
      analytics.points.some(
        (point) => point.blobs?.[0] === "v3:th_get_passage",
      ),
    ).toBe(true);
    expect(
      analytics.points.some(
        (point) => point.indexes?.[0] === "v3:th_get_passage",
      ),
    ).toBe(true);
    expect(
      analytics.points.every((point) => point.blobs?.[0] !== "get_passage"),
    ).toBe(true);
    expect(namespace.names).toEqual([]);
  });

  it("refuses a Bible book alone without calling the API", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const body = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_passage",
          arguments: { reference: "Jonah" },
        }),
        baseEnv(namespace, { points: [] }, calls),
      ),
    );
    expect(body.result?.isError).toBe(true);
    const text =
      body.result?.content?.map((part) => part.text).join("\n") ?? "";
    expect(text).toMatch(/th_get_passage_index/);
    expect(text).toMatch(/JON 1/);
    expect(calls).toEqual([]);
    expect(namespace.names).toEqual([]);
  });

  it("loads OBS study questions and leaves Bible study unfetched", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const env = baseEnv(namespace, { points: [] }, calls);

    const study = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_questions",
          arguments: { reference: "OBS 1:3", language: "en", kind: "study" },
        }),
        env,
      ),
    );
    expect(study.result?.isError).not.toBe(true);
    expect(study.result?.structuredContent).toMatchObject({
      kind: "obs",
      questionKind: "study",
      reference: "OBS 1:3",
    });
    const studyCall = calls.find((url) =>
      url.pathname.endsWith("/obs-study-questions"),
    );
    expect(studyCall?.searchParams.get("reference")).toBe("OBS 1:3");

    const bible = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_get_questions",
            arguments: { reference: "JHN 3:16", kind: "study" },
          },
          2,
        ),
        env,
      ),
    );
    expect(bible.result?.isError).not.toBe(true);
    expect(bible.result?.structuredContent).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
    });
    expect(calls.some((url) => url.pathname.endsWith("/questions"))).toBe(
      false,
    );
  });

  it("lists languages when list_resources is given no language", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const body = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", { name: "th_list_resources", arguments: {} }),
        baseEnv(namespace, { points: [] }, calls),
      ),
    );
    expect(body.result?.isError).not.toBe(true);
    expect(body.result?.structuredContent).toMatchObject({
      languages: [
        expect.objectContaining({ code: "en" }),
        expect.objectContaining({ code: "es-419" }),
      ],
      total: 2,
      has_more: false,
    });
    expect(body.result?.structuredContent).not.toHaveProperty("requestId");
    expect(body.result?.structuredContent).not.toHaveProperty("total_count");
    expect(JSON.stringify(body.result?.content)).not.toMatch(/requestId/);
    expect(calls.map((url) => url.pathname)).toContain("/api/v1/languages");
    expect(calls.some((url) => url.pathname.endsWith("/resources"))).toBe(
      false,
    );
  });

  it("still accepts a note id and a resource reference that are not in the schema", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const env = baseEnv(namespace, { points: [] }, calls);
    const notes = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_notes",
          arguments: { reference: "JHN 3:16", language: "en", id: "a" },
        }),
        env,
      ),
    );
    expect(notes.result?.isError).not.toBe(true);
    const rows = notes.result?.structuredContent?.notes as Array<{
      id: string;
    }>;
    expect(rows.map((row) => row.id)).toEqual(["a"]);

    const listed = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_list_resources",
            arguments: { language: "en", reference: "JHN 3:16" },
          },
          2,
        ),
        env,
      ),
    );
    expect(listed.result?.isError).not.toBe(true);
    const resources = calls.find((url) => url.pathname.endsWith("/resources"));
    expect(resources?.searchParams.get("book")).toBe("JHN");
    expect(resources?.searchParams.get("reference")).toBeNull();
    expect(listed.result?.structuredContent).not.toHaveProperty("requestId");
  });

  it("answers a session id with 405 and Allow: POST, and does not open a Durable Object", async () => {
    const namespace = durableObjectNamespace();
    const response = await postMcp(
      "/v3/mcp",
      rpc("tools/list", {}),
      baseEnv(namespace, { points: [] }, []),
      { "Mcp-Session-Id": "sess-v3" },
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(namespace.names).toEqual([]);
  });

  it("treats a blank session id as stateless", async () => {
    const namespace = durableObjectNamespace();
    const response = await postMcp(
      "/v3/mcp",
      rpc("tools/list", {}),
      baseEnv(namespace, { points: [] }, []),
      { "Mcp-Session-Id": "   " },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(namespace.names).toEqual([]);
  });

  it("answers GET and DELETE with 405", async () => {
    const namespace = durableObjectNamespace();
    const env = baseEnv(namespace, { points: [] }, []);
    for (const method of ["GET", "DELETE"] as const) {
      const response = await worker.fetch(
        new Request("https://example.test/v3/mcp", { method }),
        env,
        executionContext(),
      );
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow"), method).toBe("POST");
    }
    expect(namespace.names).toEqual([]);
  });

  it("answers OPTIONS with 204 before auth", async () => {
    const namespace = durableObjectNamespace();
    const response = await worker.fetch(
      new Request("https://example.test/v3/mcp", { method: "OPTIONS" }),
      baseEnv(namespace, { points: [] }, [], { MCP_API_KEY: "secret" }),
      executionContext(),
    );
    expect(response.status).toBe(204);
    expect(namespace.names).toEqual([]);
  });

  it("enforces the API key on /v3/mcp", async () => {
    const namespace = durableObjectNamespace();
    const env = baseEnv(namespace, { points: [] }, [], {
      MCP_API_KEY: "secret",
    });
    const call = rpc("tools/list", {});
    const denied = await postMcp("/v3/mcp", call, env);
    expect(denied.status).toBe(401);
    const allowed = await postMcp("/v3/mcp", call, env, {
      Authorization: "Bearer secret",
    });
    expect(allowed.status).toBe(200);
    expect(namespace.names).toEqual([]);
  });

  it("rate-limits /v3/mcp in its own scope, apart from /v2/mcp", async () => {
    const namespace = durableObjectNamespace();
    const env = baseEnv(namespace, { points: [] }, [], { RATE_LIMIT_RPM: "1" });
    const headers = { "CF-Connecting-IP": "203.0.113.51" };
    const first = await postMcp("/v3/mcp", rpc("tools/list", {}), env, headers);
    const v2Untouched = await postMcp(
      "/v2/mcp",
      rpc("tools/call", { name: "list_languages", arguments: {} }, 2),
      env,
      headers,
    );
    const second = await postMcp(
      "/v3/mcp",
      rpc("tools/list", {}, 3),
      env,
      headers,
    );
    expect(first.status).toBe(200);
    expect(v2Untouched.status).toBe(200);
    expect(second.status).toBe(429);

    const v2Only = { "CF-Connecting-IP": "203.0.113.52" };
    const v2 = await postMcp(
      "/v2/mcp",
      rpc("tools/call", { name: "list_languages", arguments: {} }, 4),
      env,
      v2Only,
    );
    const v3 = await postMcp("/v3/mcp", rpc("tools/list", {}, 5), env, v2Only);
    const v2Again = await postMcp(
      "/v2/mcp",
      rpc("tools/call", { name: "list_languages", arguments: {} }, 6),
      env,
      v2Only,
    );
    expect(v2.status).toBe(200);
    expect(v3.status).toBe(200);
    expect(v2Again.status).toBe(429);
    expect(namespace.names).toEqual([]);
  });

  it("passes Bible format through and ignores it for OBS", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const env = baseEnv(namespace, { points: [] }, calls);
    const usfm = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_passage",
          arguments: {
            reference: "JHN 3:16",
            language: "en",
            format: "usfm",
          },
        }),
        env,
      ),
    );
    expect(usfm.result?.isError).not.toBe(true);
    const scripture = calls.find((url) => url.pathname.endsWith("/scripture"));
    expect(scripture?.searchParams.get("format")).toBe("usfm");

    const obs = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_get_passage",
            arguments: {
              reference: "OBS 3:5",
              language: "en",
              format: "usfm",
            },
          },
          2,
        ),
        env,
      ),
    );
    expect(obs.result?.isError).not.toBe(true);
    const obsCall = calls.find((url) => url.pathname.endsWith("/obs"));
    expect(obsCall?.searchParams.has("format")).toBe(false);
  });

  it("rejects a Bible introduction and names th_get_notes", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const body = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_passage",
          arguments: { reference: "JHN 1:intro", language: "en" },
        }),
        baseEnv(namespace, { points: [] }, calls),
      ),
    );
    expect(body.result?.isError).toBe(true);
    const text =
      body.result?.content?.map((part) => part.text).join("\n") ?? "";
    expect(text).toContain(
      "introductions are notes: use th_get_notes with reference 'JHN 1:intro'",
    );
    expect(calls).toEqual([]);
  });

  it("lists resources for es-419 through the worker", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const body = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_list_resources",
          arguments: { language: "es-419" },
        }),
        baseEnv(namespace, { points: [] }, calls),
      ),
    );
    expect(body.result?.isError).not.toBe(true);
    expect(body.result?.structuredContent).toMatchObject({
      language: "es-419",
      resources: [expect.objectContaining({ abbreviation: "ult" })],
    });
    const resources = calls.find((url) => url.pathname.endsWith("/resources"));
    expect(resources?.searchParams.get("language")).toBe("es-419");
    expect(calls.some((url) => url.pathname.endsWith("/languages"))).toBe(
      false,
    );
  });

  it("keeps /v2/mcp and /mcp/v3 on the sixteen v2 tools", async () => {
    const namespace = durableObjectNamespace();
    const env = baseEnv(namespace, { points: [] }, []);
    const v2 = await readJson(
      await postMcp("/v2/mcp", rpc("tools/list", {}), env),
    );
    const alias = await readJson(
      await postMcp("/mcp/v3", rpc("tools/list", {}, 2), env),
    );
    const v2Names = (v2.result?.tools ?? []).map((tool) => tool.name);
    const aliasNames = (alias.result?.tools ?? []).map((tool) => tool.name);
    expect(v2Names).toEqual([...V2_TOOL_NAMES]);
    expect(aliasNames).toEqual([...V2_TOOL_NAMES]);
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([...V2_TOOL_NAMES]);
    const digest = schemaDigest(v2.result?.tools ?? []);
    expect(digest, digest).toBe(V2_SCHEMA_SHA256);
    expect(namespace.names).toEqual([]);
  });

  it("records a v2 call under the bare tool name", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const response = await postMcp(
      "/v2/mcp",
      rpc("tools/call", { name: "list_languages", arguments: {} }),
      baseEnv(namespace, analytics, []),
    );
    expect(response.status).toBe(200);
    expect(
      analytics.points.some((point) => point.blobs?.[0] === "list_languages"),
    ).toBe(true);
    expect(
      analytics.points.some(
        (point) => point.blobs?.[0] === "v3:list_languages",
      ),
    ).toBe(false);
  });

  it("indexes a whole book and an OBS frame without a session", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const env = baseEnv(namespace, { points: [] }, calls);
    const book = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_passage_index",
          arguments: { reference: "JON", language: "en" },
        }),
        env,
      ),
    );
    expect(book.result?.isError).not.toBe(true);
    expect(book.result?.structuredContent).toMatchObject({
      kind: "bible",
      reference: "JON",
    });
    const noteCalls = calls.filter((url) => url.pathname.endsWith("/notes"));
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0]?.searchParams.get("reference")).toBe("JON");
    expect(noteCalls[0]?.searchParams.get("fields")).toBe("index");
    expect(
      calls
        .find((url) => url.pathname.endsWith("/word-links"))
        ?.searchParams.get("fields"),
    ).toBe("index");
    const introductions = book.result?.structuredContent?.introductions as
      | Array<{ reference?: string }>
      | undefined;
    expect(introductions?.map((row) => row.reference)).toContain(
      "JON front:intro",
    );
    const indexed = book.result?.structuredContent?.notes as
      | Array<{ id?: string; next?: { args?: { ids?: string[] } } }>
      | undefined;
    const ids = (indexed ?? []).map((note) => note.id).filter(Boolean);
    expect(ids).toEqual(["a", "b"]);
    const asked = ["b", "a"];

    const frame = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_get_passage_index",
            arguments: { story: 1, frame: 3, language: "en" },
          },
          2,
        ),
        env,
      ),
    );
    expect(frame.result?.isError).not.toBe(true);
    expect(frame.result?.structuredContent).toMatchObject({
      kind: "obs",
      reference: "OBS 1:3",
    });
    expect(
      calls
        .find((url) => url.pathname.endsWith("/obs-notes"))
        ?.searchParams.get("reference"),
    ).toBe("OBS 1:3");

    const notes = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_get_notes",
            arguments: {
              reference: "JON 1",
              language: "en",
              ids: asked,
            },
          },
          3,
        ),
        env,
      ),
    );
    expect(notes.result?.isError).not.toBe(true);
    expect(
      (notes.result?.structuredContent?.notes as Array<{ id?: string }>)?.map(
        (note) => note.id,
      ),
    ).toEqual(asked);

    const none = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_get_notes",
            arguments: {
              reference: "JON 1",
              language: "en",
              phrase: "zzzz nothing",
            },
          },
          4,
        ),
        env,
      ),
    );
    expect(none.result?.isError).not.toBe(true);
    expect(none.result?.structuredContent?.notes).toEqual([]);
    expect(JSON.stringify(none.result?.structuredContent)).toMatch(
      /zzzz nothing/,
    );
  });

  it("keeps next on notes and words for Philippians 2", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const body = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_passage_index",
          arguments: { reference: "PHP 2", language: "en" },
        }),
        baseEnv(namespace, analytics, []),
      ),
    );
    expect(body.result?.isError).not.toBe(true);
    const notes = body.result?.structuredContent?.notes as Array<{
      reference?: string;
      next?: { tool?: string };
      taArticle?: { path?: string; title?: string };
    }>;
    const words = body.result?.structuredContent?.words as Array<{
      reference?: string;
      next?: { tool?: string };
      twArticle?: { path?: string; category?: string };
    }>;
    expect(notes[0]?.reference).toMatch(/^PHP /);
    expect(notes[0]?.next?.tool).toBe("th_get_notes");
    expect(notes[0]?.taArticle).not.toHaveProperty("title");
    expect(words[0]?.reference).toMatch(/^PHP /);
    expect(words[0]?.next?.tool).toBe("th_get_article");
    expect(words[0]?.twArticle).not.toHaveProperty("category");
    const point = analytics.points.find(
      (row) => row.blobs?.[0] === "v3:th_get_passage_index",
    );
    expect(point?.blobs).toHaveLength(6);
    expect(point?.doubles).toHaveLength(3);
    expect(namespace.names).toEqual([]);
  });

  it("accepts keyTermsOffset and the old rollupOffset name", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const env = baseEnv(namespace, { points: [] }, calls);
    const named = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_passage_index",
          arguments: {
            reference: "JON",
            language: "en",
            keyTermsOffset: 100,
          },
        }),
        env,
      ),
    );
    expect(named.result?.isError).not.toBe(true);
    expect(named.result?.structuredContent?.keyTermsOffset).toBe(100);
    expect(named.result?.structuredContent).not.toHaveProperty("rollupOffset");

    const legacy = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_get_passage_index",
            arguments: {
              reference: "JON",
              language: "en",
              rollupOffset: 100,
            },
          },
          2,
        ),
        env,
      ),
    );
    expect(legacy.result?.isError).not.toBe(true);
    expect(legacy.result?.structuredContent?.keyTermsOffset).toBe(100);
    expect(legacy.result?.structuredContent).not.toHaveProperty("rollupOffset");
  });

  it("returns the Hades article for sheol without a session", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const body = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_get_article",
          arguments: { path: "sheol" },
        }),
        baseEnv(namespace, { points: [] }, calls),
      ),
    );
    expect(body.result?.isError).not.toBe(true);
    expect(body.result?.structuredContent).toMatchObject({
      type: "tw",
      path: "bible/kt/hades",
      title: "Hades, Sheol",
      resolvedFrom: "title",
    });
    const words = calls.find((url) => url.pathname.includes("/words/"));
    expect(words?.pathname).toBe("/api/v1/words/sheol");
    expect(words?.searchParams.get("prepared")).toBe("1");
    expect(words?.searchParams.get("language")).toBe("en");
    expect(namespace.names).toEqual([]);
  });

  it("searches Translation Academy when type is ta, and accepts resourceType", async () => {
    const namespace = durableObjectNamespace();
    const calls: URL[] = [];
    const env = baseEnv(namespace, { points: [] }, calls);
    const typed = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc("tools/call", {
          name: "th_search",
          arguments: { query: "metaphor", type: "ta" },
        }),
        env,
      ),
    );
    expect(typed.result?.isError).not.toBe(true);
    expect(typed.result?.structuredContent?.results).toEqual([
      {
        path: "translate/figs-metaphor",
        type: "ta",
        title: "Metaphor",
        score: 1,
        next: {
          tool: "th_get_article",
          args: { path: "translate/figs-metaphor" },
        },
      },
    ]);
    expect(
      calls
        .find((url) => url.pathname.endsWith("/search"))
        ?.searchParams.get("types"),
    ).toBe("ta");

    const alias = await readJson(
      await postMcp(
        "/v3/mcp",
        rpc(
          "tools/call",
          {
            name: "th_search",
            arguments: { query: "metaphor", resourceType: "ta" },
          },
          2,
        ),
        env,
      ),
    );
    expect(alias.result?.isError).not.toBe(true);
    const searchCalls = calls.filter((url) => url.pathname.endsWith("/search"));
    expect(searchCalls[1]?.searchParams.get("types")).toBe("ta");
    expect(namespace.names).toEqual([]);
  });
});
