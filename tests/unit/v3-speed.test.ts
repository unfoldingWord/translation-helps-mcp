/**
 * /v3 timing: Analytics fields, the 20s API deadline, and the smaller index.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../../src/worker.js";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit.js";
import { passageRowReference } from "../../src/core/passageReference.js";
import { createApiClient } from "../../src/mcp/apiClient.js";
import {
  V3_API_TIMEOUT_MS,
  ApiTimeoutError,
  noteV3ApiResponse,
  v3ApiTimeoutMs,
  v3ToolMetric,
  withV3ApiTiming,
} from "../../src/mcp/v3/apiTiming.js";
import { getPassageV3Tool } from "../../src/mcp/v3/tools/getPassage.js";
import { getPassageIndexV3Tool } from "../../src/mcp/v3/tools/getPassageIndex.js";
import type { Env as ToolEnv } from "../../src/mcp/agent.js";

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

interface Point {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
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

async function postMcp(body: unknown, env: Env): Promise<Response> {
  return worker.fetch(
    new Request("https://example.test/v3/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(body),
    }),
    env,
    executionContext(),
  );
}

async function postV2(body: unknown, env: Env): Promise<Response> {
  return worker.fetch(
    new Request("https://example.test/v2/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(body),
    }),
    env,
    executionContext(),
  );
}

function timed(body: unknown, timing: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Server-Timing": timing,
    },
  });
}

function pointFor(points: Point[], tool: string): Point | undefined {
  return points.find((point) => point.blobs?.[0] === tool);
}

describe("v3 analytics", () => {
  afterEach(() => {
    resetRateLimitStoreForTests();
  });

  it("records one API call and two, and leaves v2 columns alone", async () => {
    resetRateLimitStoreForTests();
    const points: Point[] = [];
    const signals: Array<{ path: string; timed: boolean }> = [];
    const env = {
      MCP_AGENT: {
        newUniqueId() {
          return { toString: () => "unused" };
        },
        idFromName(name: string) {
          return { toString: () => name };
        },
        get() {
          return { fetch: async () => new Response("no", { status: 500 }) };
        },
      },
      ANALYTICS: {
        writeDataPoint(data: Point) {
          points.push(data);
        },
      },
      API: {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const raw =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          const url = new URL(raw);
          signals.push({
            path: url.pathname,
            timed: init?.signal !== undefined,
          });
          if (url.pathname.endsWith("/prefetch")) {
            return timed(null, 'layer;desc="network", total;dur=999');
          }
          if (url.pathname.endsWith("/scripture")) {
            return timed(
              {
                reference: "PHP 2:5",
                language: "en",
                book: "PHP",
                chapter: "2",
                verse: "5",
                versions: [
                  {
                    resourceType: "ult",
                    role: "literal",
                    text: "text",
                    source: "en_ult",
                  },
                ],
                meta: { cache: "kv" },
              },
              'layer;desc="kv", total;dur=12',
            );
          }
          if (url.pathname.endsWith("/notes")) {
            return timed(
              {
                book: "PHP",
                notes: [
                  {
                    chapter: "2",
                    verse: "1",
                    id: "a",
                    quote: "word",
                    note: "A note.",
                    supportReference: "rc://*/ta/man/translate/figs-metaphor",
                    supportReferenceTitle: "Metaphor",
                  },
                ],
              },
              'layer;desc="memory", total;dur=40',
            );
          }
          if (url.pathname.endsWith("/word-links")) {
            return timed(
              {
                book: "PHP",
                wordLinks: [
                  {
                    chapter: "2",
                    verse: "1",
                    origWords: "word",
                    wordPath: "bible/kt/god",
                    twTitle: "God",
                  },
                ],
              },
              'layer;desc="network", total;dur=15',
            );
          }
          if (url.pathname.endsWith("/languages")) {
            return Response.json({
              languages: [{ code: "en", name: "English" }],
            });
          }
          return Response.json(
            { error: { code: "NOT_FOUND", message: url.pathname } },
            { status: 404 },
          );
        },
      },
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      RATE_LIMIT_RPM: "0",
    } as unknown as Env;

    const passage = await postMcp(
      rpc("tools/call", {
        name: "th_get_passage",
        arguments: { reference: "PHP 2:5", language: "en" },
      }),
      env,
    );
    expect(passage.status).toBe(200);
    const one = pointFor(points, "v3:th_get_passage");
    expect(one?.blobs?.[2]).toBe("hit");
    expect(one?.blobs?.[3]).toBe("OK");
    expect(one?.blobs?.[4]).toBe("en");
    expect(one?.blobs?.[5]).toBe("kv");
    expect(one?.blobs).toHaveLength(6);
    expect(one?.doubles).toHaveLength(3);
    expect(one?.doubles?.[1]).toBe(12);
    expect(one?.doubles?.[2]).toBeGreaterThanOrEqual(0);
    expect(one?.indexes).toEqual(["v3:th_get_passage"]);
    expect(
      signals.some((call) => call.path.endsWith("/scripture") && call.timed),
    ).toBe(true);

    const index = await postMcp(
      rpc(
        "tools/call",
        {
          name: "th_get_passage_index",
          arguments: { reference: "PHP 2", language: "en" },
        },
        2,
      ),
      env,
    );
    expect(index.status).toBe(200);
    const two = pointFor(points, "v3:th_get_passage_index");
    expect(two?.blobs?.[2]).toBe("miss");
    expect(two?.blobs?.[5]).toBe("network");
    expect(two?.doubles?.[1]).toBe(55);
    expect(two?.doubles).toHaveLength(3);

    const v2 = await postV2(
      rpc("tools/call", { name: "list_languages", arguments: {} }, 3),
      env,
    );
    expect(v2.status).toBe(200);
    const bare = pointFor(points, "list_languages");
    expect(bare?.blobs).toHaveLength(5);
    expect(bare?.doubles).toHaveLength(1);
    expect(
      signals.find((call) => call.path.endsWith("/languages"))?.timed,
    ).toBe(false);
  });
});

describe("v3 API timeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimitStoreForTests();
  });

  it("is 20 seconds and does not apply outside a v3 call", async () => {
    expect(V3_API_TIMEOUT_MS).toBe(20000);
    expect(v3ApiTimeoutMs()).toBeUndefined();
    let signal: AbortSignal | undefined;
    const env = {
      API: {
        async fetch(_input: RequestInfo | URL, init?: RequestInit) {
          signal = init?.signal ?? undefined;
          return Response.json({ languages: [] });
        },
      },
    };
    await createApiClient(
      env as unknown as Parameters<typeof createApiClient>[0],
    ).get("/api/v1/languages");
    expect(signal).toBeUndefined();
  });

  it("stops a hanging API and the tool answers that the source was slow", async () => {
    const hanging = {
      async fetch(_input: RequestInfo | URL, init?: RequestInit) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const fail = () => {
            const error = new Error("The operation was aborted due to timeout");
            error.name = "TimeoutError";
            reject(error);
          };
          if (!signal) {
            reject(new Error("missing timeout"));
            return;
          }
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        });
      },
    };
    const env = { API: hanging, waitUntil() {} } as unknown as ToolEnv;
    await expect(
      withV3ApiTiming(
        () =>
          getPassageV3Tool.handler(
            { reference: "PHP 2:5", language: "en" },
            env,
            "req",
          ),
        30,
      ),
    ).rejects.toBeInstanceOf(ApiTimeoutError);

    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms: number) => real(Math.min(ms, 30)));
    const points: Point[] = [];
    const workerEnv = {
      MCP_AGENT: {
        newUniqueId() {
          return { toString: () => "unused" };
        },
        idFromName(name: string) {
          return { toString: () => name };
        },
        get() {
          return { fetch: async () => new Response("no", { status: 500 }) };
        },
      },
      ANALYTICS: {
        writeDataPoint(data: Point) {
          points.push(data);
        },
      },
      API: hanging,
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      RATE_LIMIT_RPM: "0",
    } as unknown as Env;
    const response = await postMcp(
      rpc("tools/call", {
        name: "th_get_passage",
        arguments: { reference: "PHP 2:5", language: "en" },
      }),
      workerEnv,
    );
    expect(spy).toHaveBeenCalledWith(20000);
    spy.mockRestore();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: {
        isError?: boolean;
        structuredContent?: {
          available?: boolean;
          message?: string;
          hints?: string[];
        };
      };
    };
    expect(body.result?.isError).not.toBe(true);
    expect(body.result?.structuredContent?.available).toBe(false);
    expect(body.result?.structuredContent?.message).toMatch(/source was slow/);
    expect(body.result?.structuredContent?.hints).toContain("Try again.");
    const metric = pointFor(points, "v3:th_get_passage");
    expect(metric?.blobs?.[2]).toBe("miss");
    expect(metric?.blobs?.[3]).toBe("TIMEOUT");
    expect(metric?.blobs?.[5]).toBe("network");
    expect(metric?.blobs).toHaveLength(6);
    expect(metric?.doubles).toHaveLength(3);
  });

  it("turns a body that never finishes into the same timeout", async () => {
    const env = {
      API: {
        async fetch(_input: RequestInfo | URL, init?: RequestInit) {
          const signal = init?.signal;
          const body = new ReadableStream({
            start(controller) {
              const fail = () => {
                const error = new Error("The operation was aborted");
                error.name = "AbortError";
                controller.error(error);
              };
              if (!signal) {
                controller.error(new Error("missing timeout"));
                return;
              }
              if (signal.aborted) fail();
              else signal.addEventListener("abort", fail, { once: true });
            },
          });
          return new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    };
    await expect(
      withV3ApiTiming(
        () =>
          createApiClient(
            env as unknown as Parameters<typeof createApiClient>[0],
          ).get("/api/v1/scripture", {
            reference: "PHP 2:5",
            language: "en",
          }),
        30,
      ),
    ).rejects.toBeInstanceOf(ApiTimeoutError);
  });
});

describe("v3 parallel API waits", () => {
  it("subtracts the overlap once when two calls run together", async () => {
    await withV3ApiTiming(async () => {
      noteV3ApiResponse('layer;desc="kv", total;dur=800', 1_000, 1_800);
      noteV3ApiResponse('layer;desc="r2", total;dur=800', 1_000, 1_800);
      const metric = v3ToolMetric(1_000, "none");
      expect(metric.apiMs).toBe(1_600);
      expect(metric.mcpMs).toBe(200);
      expect(metric.layer).toBe("r2");
    });
  });
});

describe("v3 index when one side is slow", () => {
  function hang(init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      const fail = () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        reject(error);
      };
      if (!signal) {
        reject(new Error("missing timeout"));
        return;
      }
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });
  }

  function indexEnv(hangWords: boolean, hangNotes: boolean): ToolEnv {
    return {
      API: {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const raw =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          const url = new URL(raw);
          if (url.pathname.endsWith("/notes")) {
            if (hangNotes) return hang(init);
            return Response.json({
              book: "PHP",
              notes: [
                {
                  chapter: "2",
                  verse: "1",
                  id: "n0",
                  quote: "word",
                  supportReference: "rc://*/ta/man/translate/figs-metaphor",
                  supportReferenceTitle: "Metaphor",
                },
              ],
            });
          }
          if (url.pathname.endsWith("/word-links")) {
            if (hangWords) return hang(init);
            return Response.json({
              book: "PHP",
              wordLinks: [
                {
                  chapter: "2",
                  verse: "1",
                  origWords: "word",
                  wordPath: "bible/kt/god",
                  twTitle: "God",
                },
              ],
            });
          }
          return Response.json(
            { error: { code: "NOT_FOUND", message: url.pathname } },
            { status: 404 },
          );
        },
      },
    } as ToolEnv;
  }

  it("keeps the notes when word links do not answer", async () => {
    const result = await withV3ApiTiming(
      () =>
        getPassageIndexV3Tool.handler(
          { reference: "PHP 2", language: "en" },
          indexEnv(true, false),
          "req",
        ),
      30,
    );
    const content = result.structuredContent as {
      available?: boolean;
      notes: unknown[];
      words: unknown[];
      message?: string;
      wordLinksError?: string;
    };
    expect(content.available).not.toBe(false);
    expect(content.notes.length).toBeGreaterThan(0);
    expect(content.words).toEqual([]);
    expect(content.message).toMatch(/source was slow/);
    expect(content.wordLinksError).toMatch(/source was slow/);
  });

  it("keeps the soft answer when both sides are slow", async () => {
    await expect(
      withV3ApiTiming(
        () =>
          getPassageIndexV3Tool.handler(
            { reference: "PHP 2", language: "en" },
            indexEnv(true, true),
            "req",
          ),
        30,
      ),
    ).rejects.toBeInstanceOf(ApiTimeoutError);
  });
});

describe("v3 chapter index size", () => {
  it("uses short refs and drops the repeated title and category", async () => {
    const issueCount = 27;
    const termCount = 51;
    const noteCount = 129;
    const wordCount = 89;
    const sourceNotes = Array.from({ length: noteCount }, (_, i) => ({
      chapter: "2",
      verse: String((i % 30) + 1),
      id: `n${i}`,
      quote: "covenant word ".repeat(3).trim(),
      supportReference: `rc://*/ta/man/translate/figs-issue-${i % issueCount}`,
      supportReferenceTitle: `Issue title ${i % issueCount}`,
    }));
    const sourceWords = Array.from({ length: wordCount }, (_, i) => ({
      chapter: "2",
      verse: String((i % 30) + 1),
      origWords: "logos word ".repeat(2).trim(),
      wordPath: `bible/kt/term-${i % termCount}`,
      twTitle: `Term ${i % termCount}`,
    }));
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
          if (url.pathname.endsWith("/notes")) {
            return Response.json({ book: "PHP", notes: sourceNotes });
          }
          if (url.pathname.endsWith("/word-links")) {
            return Response.json({ book: "PHP", wordLinks: sourceWords });
          }
          return Response.json(
            { error: { code: "NOT_FOUND", message: url.pathname } },
            { status: 404 },
          );
        },
      },
    } as ToolEnv;

    const result = await getPassageIndexV3Tool.handler(
      { reference: "PHP 2", language: "en" },
      env,
      "req",
    );
    const content = result.structuredContent as {
      notes: Array<{
        reference: string;
        taArticle: { path: string; title?: string };
        next: { tool: string; args: { reference: string; ids: string[] } };
      }>;
      words: Array<{
        reference: string;
        twArticle: { path: string; title: string; category?: string };
        next: { tool: string };
      }>;
      issues: Array<{ path: string; title: string }>;
      keyTerms: Array<{ path: string; category: string; title: string }>;
    };
    expect(content.notes).toHaveLength(noteCount);
    expect(content.words).toHaveLength(wordCount);
    expect(content.issues).toHaveLength(issueCount);
    expect(content.keyTerms).toHaveLength(termCount);
    expect(content.notes[0]).toMatchObject({
      reference: "PHP 2:1",
      taArticle: { path: "translate/figs-issue-0" },
      next: {
        tool: "th_get_notes",
        args: { reference: "PHP 2:1", ids: ["n0"] },
      },
    });
    expect(content.notes[0]?.taArticle).not.toHaveProperty("title");
    expect(content.words[0]?.twArticle).not.toHaveProperty("category");
    expect(content.words[0]?.next.tool).toBe("th_get_article");
    expect(content.issues.every((issue) => issue.title.length > 0)).toBe(true);
    expect(content.keyTerms.every((term) => term.category === "kt")).toBe(true);
    expect(JSON.stringify(content)).not.toMatch(/Philippians/);
    expect(JSON.stringify(content).length).toBeLessThanOrEqual(52_000);

    const previous = {
      ...content,
      notes: content.notes.map((note, i) => {
        const source = sourceNotes[i]!;
        const reference = passageRowReference(
          "PHP 2",
          "PHP",
          source.chapter,
          source.verse,
        );
        return {
          ...note,
          reference,
          taArticle: {
            ...note.taArticle,
            title: source.supportReferenceTitle,
          },
          next: {
            ...note.next,
            args: { ...note.next.args, reference },
          },
        };
      }),
      words: content.words.map((word, i) => {
        const source = sourceWords[i]!;
        return {
          ...word,
          reference: passageRowReference(
            "PHP 2",
            "PHP",
            source.chapter,
            source.verse,
          ),
          twArticle: { ...word.twArticle, category: "kt" },
        };
      }),
    };
    const saved =
      JSON.stringify(previous).length - JSON.stringify(content).length;
    expect(saved).toBeGreaterThan(4000);
  });
});
