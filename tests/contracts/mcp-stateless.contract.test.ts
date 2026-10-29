/**
 * Stateless MCP over the real Worker fetch.
 *
 * A POST to /v2/mcp or /mcp with no Mcp-Session-Id must be answered without a
 * Durable Object. A request that carries a session id still goes to the
 * McpAgent. The test runtime cannot host Durable Objects, so that path is a
 * namespace double: idFromName records the object name, and fetch returns a
 * WebSocket that writes one SSE frame. The test checks that frame reaches
 * the client unchanged.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import worker, { type Env } from "../../src/worker.js";
import { TranslationHelpsMCP } from "../../src/mcp/agent.js";
import { NormalizingMcpServer } from "../../src/mcp/normalizingMcpServer.js";
import { SERVER_INSTRUCTIONS } from "../../src/mcp/instructions.js";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { SERVER_NAME, VERSION } from "../../src/core/version.js";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit.js";

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

/**
 * Bytes the Durable Object double writes on its WebSocket. The Worker must
 * hand this SSE frame to the client unchanged.
 */
const SESSION_SSE_EVENT =
  'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"marker":"durable-object-session-path"}}\n\n';

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
        async __unsafe_ensureInitialized() {},
        async getInitializeRequest() {
          return { method: "initialize" };
        },
        async fetch() {
          const listeners: Array<(event: { data: string }) => void> = [];
          const ws = {
            accept() {},
            close() {},
            addEventListener(
              type: string,
              listener: (event: { data: string }) => void,
            ) {
              if (type === "message") listeners.push(listener);
            },
            send() {},
          };
          // The agents bridge attaches listeners after fetch resolves.
          setTimeout(() => {
            const frame = JSON.stringify({
              type: "cf_mcp_agent_event",
              event: SESSION_SSE_EVENT,
              close: true,
            });
            for (const listener of listeners) listener({ data: frame });
          }, 0);
          return { webSocket: ws };
        },
      };
    },
  };
  return namespace as unknown as Env["MCP_AGENT"] & DoNamespace;
}

function apiFetcher(): Fetcher {
  return {
    async fetch(input: RequestInfo | URL) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/v1/languages")) {
        return Response.json({
          languages: [{ code: "en", name: "English", englishName: "English" }],
        });
      }
      if (url.includes("/api/v1/scripture")) {
        const parsed = new URL(url);
        return Response.json({
          reference: parsed.searchParams.get("reference"),
          language: parsed.searchParams.get("language") ?? "en",
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
      if (url.includes("/api/v1/prefetch")) {
        return new Response(null, { status: 202 });
      }
      return Response.json(
        { error: { code: "NOT_FOUND", message: url } },
        { status: 404 },
      );
    },
  } as Fetcher;
}

interface AnalyticsSpy {
  points: Array<{ blobs?: string[] }>;
}

function baseEnv(
  namespace: Env["MCP_AGENT"],
  analytics: AnalyticsSpy,
  extra: Partial<Env> = {},
): Env {
  return {
    MCP_AGENT: namespace,
    ANALYTICS: {
      writeDataPoint(data: { blobs?: string[] }) {
        analytics.points.push(data);
      },
    },
    API: apiFetcher(),
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    RATE_LIMIT_RPM: "0",
    ...extra,
  } as Env;
}

function executionContext(): {
  ctx: ExecutionContext;
  jobs: Promise<unknown>[];
} {
  const jobs: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      jobs.push(Promise.resolve(promise));
    },
    passThroughOnException() {},
    props: {},
  };
  return { ctx: ctx as unknown as ExecutionContext, jobs };
}

function rpc(method: string, params: Record<string, unknown>, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

async function postMcp(
  path: string,
  body: unknown,
  env: Env,
  ctx: ExecutionContext,
  headers: Record<string, string> = {},
): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { ...MCP_HEADERS, ...headers },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );
}

async function readJson(response: Response): Promise<{
  result?: {
    serverInfo?: { name?: string; version?: string };
    instructions?: string;
    tools?: Array<{
      name: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  error?: { message?: string };
}> {
  return (await response.json()) as {
    result?: {
      serverInfo?: { name?: string; version?: string };
      instructions?: string;
      tools?: Array<{
        name: string;
        inputSchema?: unknown;
        outputSchema?: unknown;
      }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    error?: { message?: string };
  };
}

/** Tools/list as TranslationHelpsMCP.init registers them (the Durable Object). */
async function durableObjectTools(): Promise<
  Array<{ name: string; inputSchema?: unknown; outputSchema?: unknown }>
> {
  const server = new NormalizingMcpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const agent = Object.create(
    TranslationHelpsMCP.prototype,
  ) as TranslationHelpsMCP;
  // init() only registers tools on `server`. It does not touch the Durable
  // Object state, which this process cannot construct.
  agent.server = server;
  await agent.init();

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const listed = await client.listTools();
  await client.close();
  return listed.tools.map((tool) => ({
    name: tool.name,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }));
}

/** Route the SDK client's fetch into the Worker, the way a contract test calls it. */
function workerFetch(env: Env, ctx: ExecutionContext): FetchLike {
  return async (url, init) => worker.fetch(new Request(url, init), env, ctx);
}

describe("stateless MCP worker fetch", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  it("answers tools/call list_languages with no session header", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const env = baseEnv(namespace, analytics);
    const { ctx } = executionContext();

    for (const path of ["/v2/mcp", "/mcp"]) {
      const response = await postMcp(
        path,
        rpc("tools/call", { name: "list_languages", arguments: {} }),
        env,
        ctx,
      );
      expect(response.status, path).toBe(200);
      expect(response.headers.get("mcp-session-id"), path).toBeNull();
      expect(response.headers.get("content-type"), path).toContain(
        "application/json",
      );
      expect(response.headers.get("access-control-allow-origin"), path).toBe(
        "*",
      );
      const body = await readJson(response);
      expect(body.result?.isError, path).not.toBe(true);
      expect(body.result?.structuredContent).toEqual(
        expect.objectContaining({
          languages: [
            expect.objectContaining({ code: "en", englishName: "English" }),
          ],
        }),
      );
      expect(namespace.names, path).toEqual([]);
    }

    expect(
      analytics.points.some((point) => point.blobs?.[0] === "list_languages"),
    ).toBe(true);
  });

  it("lists the same tools and input schemas as the Durable Object", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const { ctx } = executionContext();
    const response = await postMcp(
      "/v2/mcp",
      rpc("tools/list", {}),
      baseEnv(namespace, analytics),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(response);
    const httpTools = body.result?.tools ?? [];
    const doTools = await durableObjectTools();

    expect(httpTools.map((tool) => tool.name)).toEqual(
      doTools.map((tool) => tool.name),
    );
    expect(httpTools).toHaveLength(MCP_TOOLS.length);
    expect(httpTools).toHaveLength(15);
    for (const tool of httpTools) {
      const fromDo = doTools.find((candidate) => candidate.name === tool.name);
      expect(tool.inputSchema, tool.name).toEqual(fromDo?.inputSchema);
      expect(tool.outputSchema, tool.name).toEqual(fromDo?.outputSchema);
    }
    expect(namespace.names).toEqual([]);
  });

  it("answers initialize with the server version and no session header", async () => {
    expect(VERSION).toBe("2.3.0");
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const { ctx } = executionContext();
    const response = await postMcp(
      "/v2/mcp",
      rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "bt-servant", version: "0.0.0" },
      }),
      baseEnv(namespace, analytics),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(response);
    expect(body.result?.serverInfo).toEqual({
      name: SERVER_NAME,
      version: "2.3.0",
    });
    expect(body.result?.instructions).toContain("You are Ezer");
    expect(namespace.names).toEqual([]);
  });

  it("normalizes get_passage book/chapter/verse on the stateless path", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const { ctx, jobs } = executionContext();
    const response = await postMcp(
      "/v2/mcp",
      rpc("tools/call", {
        name: "get_passage",
        arguments: { book: "JHN", chapter: 3, verse: 16 },
      }),
      baseEnv(namespace, analytics),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(response);
    expect(body.result?.isError).not.toBe(true);
    expect(body.result?.structuredContent?.reference).toBe("JHN 3:16");
    expect(jobs.length).toBeGreaterThan(0);
    await Promise.all(jobs);
    expect(namespace.names).toEqual([]);
  });

  it("still routes a request that carries Mcp-Session-Id to the Durable Object", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const { ctx } = executionContext();
    const response = await postMcp(
      "/v2/mcp",
      rpc("tools/call", { name: "list_languages", arguments: {} }),
      baseEnv(namespace, analytics),
      ctx,
      { "Mcp-Session-Id": "sess-existing" },
    );
    const names = (namespace as unknown as DoNamespace).names;
    expect(names).toContain("streamable-http:sess-existing");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("mcp-session-id")).toBe("sess-existing");
    expect(await response.text()).toBe(SESSION_SSE_EVENT);
  });

  it("enforces the API key on a sessionless call", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const env = baseEnv(namespace, analytics, { MCP_API_KEY: "secret" });
    const { ctx } = executionContext();
    const call = rpc("tools/call", { name: "list_languages", arguments: {} });

    const denied = await postMcp("/v2/mcp", call, env, ctx);
    expect(denied.status).toBe(401);

    const allowed = await postMcp("/v2/mcp", call, env, ctx, {
      Authorization: "Bearer secret",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(allowed);
    expect(body.result?.isError).not.toBe(true);
    expect(namespace.names).toEqual([]);
  });

  it("rate-limits the stateless path", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const env = baseEnv(namespace, analytics, { RATE_LIMIT_RPM: "1" });
    const { ctx } = executionContext();
    const headers = { "CF-Connecting-IP": "203.0.113.33" };
    const call = rpc("tools/call", { name: "list_languages", arguments: {} });

    const first = await postMcp("/v2/mcp", call, env, ctx, headers);
    const second = await postMcp("/v2/mcp", call, env, ctx, headers);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(namespace.names).toEqual([]);
  });

  it("answers sessionless GET and DELETE with 405 and does not open a stream", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const env = baseEnv(namespace, analytics);
    const { ctx } = executionContext();

    for (const method of ["GET", "DELETE"] as const) {
      const response = await worker.fetch(
        new Request("https://example.test/v2/mcp", {
          method,
          headers: { Accept: "text/event-stream" },
        }),
        env,
        ctx,
      );
      expect(response.status, method).toBe(405);
      expect(response.headers.get("content-type") ?? "", method).not.toContain(
        "text/event-stream",
      );
      const text = await response.text();
      expect(text, method).not.toContain("event:");
      expect(namespace.names, method).toEqual([]);
    }
  });

  it("serves the SDK streamable HTTP client with no session id", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const env = baseEnv(namespace, analytics);
    const { ctx } = executionContext();
    const transport = new StreamableHTTPClientTransport(
      new URL("https://example.test/v2/mcp"),
      { fetch: workerFetch(env, ctx) },
    );
    const client = new Client({ name: "bt-servant-worker", version: "1.0.0" });
    await client.connect(transport);
    expect(transport.sessionId).toBeUndefined();

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(
      MCP_TOOLS.map((tool) => tool.name),
    );
    expect(listed.tools).toHaveLength(15);

    const called = await client.callTool({
      name: "list_languages",
      arguments: {},
    });
    expect(called.isError).not.toBe(true);
    expect(transport.sessionId).toBeUndefined();
    await client.close();
    expect(transport.sessionId).toBeUndefined();
    expect(namespace.names).toEqual([]);
  });

  it("does not make one sessionless call wait for another", async () => {
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let held = false;
    let markHeld!: () => void;
    const heldPromise = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    const fetcher = {
      async fetch(input: RequestInfo | URL) {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (!url.includes("/api/v1/languages")) {
          return Response.json(
            { error: { code: "NOT_FOUND", message: url } },
            { status: 404 },
          );
        }
        if (!held) {
          held = true;
          markHeld();
          await holdFirst;
        }
        return Response.json({
          languages: [{ code: "en", name: "English", englishName: "English" }],
        });
      },
    } as Fetcher;

    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const env = baseEnv(namespace, analytics, { API: fetcher });
    const { ctx } = executionContext();
    const call = rpc("tools/call", { name: "list_languages", arguments: {} });
    const first = postMcp("/v2/mcp", call, env, ctx);
    await heldPromise;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const second = postMcp("/v2/mcp", { ...call, id: 2 }, env, ctx);
    try {
      const raced = await Promise.race([
        second.then(() => "second" as const),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), 1000);
        }),
      ]);
      expect(raced).toBe("second");
      const secondResponse = await second;
      expect(secondResponse.status).toBe(200);
      expect(secondResponse.headers.get("mcp-session-id")).toBeNull();
      const body = await readJson(secondResponse);
      expect(body.result?.isError).not.toBe(true);
    } finally {
      clearTimeout(timer);
      releaseFirst();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
    }
    expect(namespace.names).toEqual([]);
  });

  it("accepts a POST whose Accept is only application/json", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const { ctx } = executionContext();
    const response = await worker.fetch(
      new Request("https://example.test/v2/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(
          rpc("initialize", {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "curl", version: "0.0.0" },
          }),
        ),
      }),
      baseEnv(namespace, analytics),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(response);
    expect(body.result?.serverInfo?.version).toBe("2.3.0");
    expect(namespace.names).toEqual([]);
  });

  it("accepts a POST with no Accept header", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const { ctx } = executionContext();
    const response = await worker.fetch(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          rpc("tools/call", { name: "list_languages", arguments: {} }),
        ),
      }),
      baseEnv(namespace, analytics),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(response);
    expect(body.result?.isError).not.toBe(true);
    expect(namespace.names).toEqual([]);
  });

  it("treats a blank Mcp-Session-Id as no session", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const env = baseEnv(namespace, analytics);
    const { ctx } = executionContext();
    const call = rpc("tools/call", { name: "list_languages", arguments: {} });

    for (const session of ["", "   ", "\t"]) {
      const response = await postMcp("/v2/mcp", call, env, ctx, {
        "Mcp-Session-Id": session,
      });
      expect(response.status, JSON.stringify(session)).toBe(200);
      expect(
        response.headers.get("mcp-session-id"),
        JSON.stringify(session),
      ).toBeNull();
      const body = await readJson(response);
      expect(body.result?.isError, JSON.stringify(session)).not.toBe(true);
    }
    expect(namespace.names).toEqual([]);
  });

  it("accepts notifications/initialized with no session", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const { ctx } = executionContext();
    const response = await postMcp(
      "/v2/mcp",
      { jsonrpc: "2.0", method: "notifications/initialized" },
      baseEnv(namespace, analytics),
      ctx,
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(response.headers.get("content-type") ?? "").not.toContain(
      "text/event-stream",
    );
    expect(namespace.names).toEqual([]);
  });

  it("enforces X-Api-Key on a sessionless call", async () => {
    const namespace = durableObjectNamespace();
    const analytics: AnalyticsSpy = { points: [] };
    const env = baseEnv(namespace, analytics, { MCP_API_KEY: "secret" });
    const { ctx } = executionContext();
    const call = rpc("tools/call", { name: "list_languages", arguments: {} });

    const denied = await postMcp("/v2/mcp", call, env, ctx, {
      "X-Api-Key": "nope",
    });
    expect(denied.status).toBe(401);

    const allowed = await postMcp("/v2/mcp", call, env, ctx, {
      "X-Api-Key": "secret",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(allowed);
    expect(body.result?.isError).not.toBe(true);
    expect(namespace.names).toEqual([]);
  });
});
