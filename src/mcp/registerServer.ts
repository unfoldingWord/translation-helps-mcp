/**
 * Shared MCP registration for the Durable Object and the stateless handler.
 *
 * Tool schemas, descriptions, argument handling, instructions and prompts stay
 * in one place so the two HTTP paths cannot drift.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { logger } from "../core/logger.js";
import { recordToolCall } from "../core/metrics.js";
import {
  isTranslationHelpsError,
  ErrorCode,
  type TranslationHelpsError,
} from "../core/errors.js";
import { SERVER_NAME, VERSION } from "../core/version.js";
import { strictToolSchema } from "./jsonSchema.js";
import { ApiClientError } from "./apiClient.js";
import { MCP_TOOLS } from "./toolRegistry.js";
import { PROMPTS } from "./prompts/index.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { NormalizingMcpServer } from "./normalizingMcpServer.js";
import type { Env } from "./agent.js";

/** Read the request environment when a tool actually runs, not at registration. */
export type ResolveToolEnv = () => Env;

/**
 * MCP-standard error response helper.
 *
 * Omit `structuredContent` on isError results so clients that validate it
 * against the tool's outputSchema (SEP-1624) do not reject the payload.
 * Error details stay in `content` for the model to read.
 */
function mcpError(err: TranslationHelpsError): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const payload = err.toMcpError();
  return {
    content: [
      { type: "text", text: `Error ${payload.code}: ${payload.message}` },
    ],
    isError: true,
  };
}

/**
 * Non-error "resource not available" result (upstream #30 contract).
 * isError is false so MCP clients do not treat missing data as a failure.
 */
function mcpNotAvailable(message: string): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: false;
} {
  const payload = {
    available: false,
    code: "RESOURCE_NOT_AVAILABLE",
    message,
    hints: ["Run list_resources to see what is available for this language."],
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: false,
  };
}

type ListedTool = ListToolsResult["tools"][number];

/**
 * Strict input schemas, built once per isolate. `registerTool` still runs per
 * server, but it reuses these objects instead of wrapping the Zod shape again.
 */
let strictInputs: z.ZodType[] | undefined;

function strictInputSchemas(): z.ZodType[] {
  if (!strictInputs) {
    strictInputs = MCP_TOOLS.map((tool) => {
      const schemaShape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>)
        .shape;
      return strictToolSchema(schemaShape);
    });
  }
  return strictInputs;
}

/**
 * JSON Schema `tools/list` payload, produced once by the SDK and reused.
 * A fresh server would otherwise convert every Zod schema on every list.
 * The probe does not install this cache, or the first list would wait on itself.
 * A failed probe is not stored: the next list tries again.
 */
let sdkToolList: Promise<ListedTool[]> | undefined;
let probeAttempts = 0;
let probeFailuresRemaining = 0;

/** Drop the cached list so a test can watch the next probe. */
export function resetToolListCacheForTests(): void {
  sdkToolList = undefined;
  probeAttempts = 0;
  probeFailuresRemaining = 0;
}

/** The next cache probe throws before it talks to the SDK. */
export function failNextToolListProbeForTests(): void {
  probeFailuresRemaining += 1;
  sdkToolList = undefined;
}

/** How many cache probes this isolate has started since the last reset. */
export function toolListProbeAttemptsForTests(): number {
  return probeAttempts;
}

function loadSdkToolList(): Promise<ListedTool[]> {
  sdkToolList ??= captureSdkToolList().catch((error: unknown) => {
    sdkToolList = undefined;
    throw error;
  });
  return sdkToolList;
}

async function captureSdkToolList(): Promise<ListedTool[]> {
  probeAttempts += 1;
  if (probeFailuresRemaining > 0) {
    probeFailuresRemaining -= 1;
    throw new Error("Tool list cache probe failed.");
  }
  const server = new NormalizingMcpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTranslationHelpsSurface(
    server,
    () => {
      throw new Error("Tool list cache probe does not run tools.");
    },
    false,
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-cache", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  let tools: ListedTool[] | undefined;
  const forward = clientTransport.onmessage;
  clientTransport.onmessage = (message, extra) => {
    const result = (message as { result?: { tools?: unknown } }).result;
    if (Array.isArray(result?.tools)) {
      tools = structuredClone(result.tools) as ListedTool[];
    }
    forward?.(message, extra);
  };
  try {
    await client.listTools();
  } finally {
    await client.close().catch(() => {});
  }
  if (!tools) {
    throw new Error("Tool list cache probe did not see a tools/list result.");
  }
  return tools;
}

type StoredListHandler = (
  request: unknown,
  extra: unknown,
) => Promise<ListToolsResult> | ListToolsResult;

/**
 * The handler the SDK installed while registering tools. The cache replaces
 * it, and a failed probe calls this one for that request only.
 */
function sdkListToolsHandler(
  server: NormalizingMcpServer,
): StoredListHandler | undefined {
  const handlers = (
    server.server as unknown as {
      _requestHandlers?: Map<string, StoredListHandler>;
    }
  )._requestHandlers;
  return handlers?.get("tools/list");
}

function installCachedToolList(server: NormalizingMcpServer): void {
  const fallback = sdkListToolsHandler(server);
  server.server.setRequestHandler(
    ListToolsRequestSchema,
    async (request, extra) => {
      try {
        return { tools: structuredClone(await loadSdkToolList()) };
      } catch (error) {
        // Do not keep the failure. loadSdkToolList already dropped it, so the
        // next list probes again. This request uses the SDK's own listing.
        logger.warn("tool:list_cache_fallback", {
          reason: error instanceof Error ? error.message : String(error),
        });
        if (!fallback) throw error;
        return fallback(request, extra);
      }
    },
  );
}

export function registerTranslationHelpsServer(
  server: NormalizingMcpServer,
  resolveEnv: ResolveToolEnv,
): void {
  registerTranslationHelpsSurface(server, resolveEnv, true);
}

function registerTranslationHelpsSurface(
  server: NormalizingMcpServer,
  resolveEnv: ResolveToolEnv,
  cacheToolList: boolean,
): void {
  const inputs = strictInputSchemas();
  for (const [index, tool] of MCP_TOOLS.entries()) {
    const { name, description, outputSchema, annotations, handler } = tool;
    // inputs[index] is the strict schema for this tool, built once per isolate.
    const inputSchema = inputs[index];
    if (!inputSchema) {
      throw new Error(`Missing cached input schema for ${name}`);
    }

    server.registerTool(
      name,
      {
        title: annotations.title,
        description,
        // Wrapped (not passed as a bare shape) so tools/list keeps
        // `additionalProperties: false` under zod 4 — see strictToolSchema.
        inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
        annotations: {
          readOnlyHint: annotations.readOnlyHint,
          ...(annotations.destructiveHint !== undefined
            ? { destructiveHint: annotations.destructiveHint }
            : {}),
        },
      },
      // `inputSchema` is now a schema rather than a raw shape (see
      // strictToolSchema), so the SDK types the callback arg as `unknown`
      // instead of inferring it from the shape. The runtime value is the
      // parsed args object, which is what this handler reads.
      async (rawParams: unknown) => {
        const params = rawParams as Record<string, unknown>;
        const env = resolveEnv();
        const requestId = crypto.randomUUID();
        const start = Date.now();
        let errorCode = "OK";
        let cacheStatus: "hit" | "miss" | "stale" | "none" = "none";

        try {
          logger.info(`tool:call`, { tool: name, requestId });
          const result = await handler(params as never, env, requestId);

          // Extract cache status if the handler attached it
          if (result && typeof result === "object" && "cacheStatus" in result) {
            cacheStatus = (
              result as { cacheStatus: "hit" | "miss" | "stale" | "none" }
            ).cacheStatus;
          }

          recordToolCall(env.ANALYTICS, {
            tool: name,
            requestId,
            latencyMs: Date.now() - start,
            cacheStatus,
            errorCode,
            language: params.language as string | undefined,
          });

          return result as never;
        } catch (err) {
          if (isTranslationHelpsError(err)) {
            errorCode = err.code;
            logger.error(`tool:error`, {
              tool: name,
              requestId,
              code: err.code,
              message: err.message,
            });
            recordToolCall(env.ANALYTICS, {
              tool: name,
              requestId,
              latencyMs: Date.now() - start,
              cacheStatus: "none",
              errorCode,
            });
            return mcpError(err) as never;
          }

          // HTTP 404 from the REST API → resource not available, not a failure.
          // This keeps the LLM's circuit-breaker logic from treating missing
          // resources as server outages (upstream #30 contract).
          if (err instanceof ApiClientError && err.status === 404) {
            errorCode = "RESOURCE_NOT_AVAILABLE";
            logger.info(`tool:not_available`, {
              tool: name,
              requestId,
              message: err.message,
            });
            recordToolCall(env.ANALYTICS, {
              tool: name,
              requestId,
              latencyMs: Date.now() - start,
              cacheStatus: "none",
              errorCode,
            });
            return mcpNotAvailable(err.message) as never;
          }

          // Unexpected error
          const message = err instanceof Error ? err.message : String(err);
          errorCode = ErrorCode.INTERNAL_ERROR;
          logger.error(`tool:unexpected_error`, {
            tool: name,
            requestId,
            code: errorCode,
            message,
          });
          recordToolCall(env.ANALYTICS, {
            tool: name,
            requestId,
            latencyMs: Date.now() - start,
            cacheStatus: "none",
            errorCode,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Error ${errorCode}: Internal error in ${name}: ${message}`,
              },
            ],
            isError: true,
          } as never;
        }
      },
    );
  }

  for (const prompt of PROMPTS) {
    // `argsSchema` is a loose `Record<string, ZodTypeAny>`, so the SDK cannot
    // infer concrete argument names and types the callback as
    // `ShapeOutput<...>`. Our handlers read string fields off the parsed
    // args, which is what the SDK passes at runtime; the cast bridges the
    // inference gap without changing behaviour.
    type PromptCallback = Parameters<typeof server.prompt>[3];
    server.prompt(
      prompt.name,
      prompt.description,
      prompt.argsSchema,
      prompt.handler as unknown as PromptCallback,
    );
  }

  if (cacheToolList) installCachedToolList(server);
}
