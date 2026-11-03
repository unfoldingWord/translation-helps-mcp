/**
 * Tool registration for /v3/mcp.
 *
 * Own schema cache. The v2 cache is module state in registerServer.ts; sharing
 * it would let whichever version listed tools first answer for the other.
 * No prompts. Recipes are a later task.
 *
 * Analytics records the tool as `v3:<name>`, for example `v3:th_get_passage`,
 * so a v3 call is not counted under the bare MCP name or a v2 name.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import {
  ListToolsRequestSchema,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { logger } from "../../core/logger.js";
import { recordToolCall } from "../../core/metrics.js";
import {
  ErrorCode,
  isTranslationHelpsError,
  type TranslationHelpsError,
} from "../../core/errors.js";
import { SERVER_NAME, VERSION } from "../../core/version.js";
import { ApiClientError } from "../apiClient.js";
import { strictToolSchema } from "../jsonSchema.js";
import type { Env } from "../agent.js";
import {
  V3_LIST_RESOURCES_HINT,
  V3_SERVER_INSTRUCTIONS,
} from "./instructions.js";
import { V3NormalizingMcpServer } from "./server.js";
import { getArticleV3Tool } from "./tools/getArticle.js";
import { getNotesV3Tool } from "./tools/getNotes.js";
import { getPassageV3Tool } from "./tools/getPassage.js";
import { getPassageIndexV3Tool } from "./tools/getPassageIndex.js";
import { getQuestionsV3Tool } from "./tools/getQuestions.js";
import { listResourcesV3Tool } from "./tools/listResources.js";
import { searchV3Tool } from "./tools/search.js";

export type ResolveV3Env = () => Env;

interface V3Tool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  outputSchema?: Record<string, z.ZodType>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    title: string;
  };
  handler(
    params: never,
    env: Env,
    requestId: string,
  ): Promise<{ cacheStatus?: "hit" | "miss" | "stale" | "none" }>;
}

/** Registration order is the tools/list order. */
const V3_TOOLS: V3Tool[] = [
  getPassageV3Tool as V3Tool,
  getQuestionsV3Tool as V3Tool,
  listResourcesV3Tool as V3Tool,
  getPassageIndexV3Tool as V3Tool,
  getNotesV3Tool as V3Tool,
  getArticleV3Tool as V3Tool,
  searchV3Tool as V3Tool,
];

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

function mcpNotAvailable(message: string): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: false;
} {
  const payload = {
    available: false,
    code: "RESOURCE_NOT_AVAILABLE",
    message,
    hints: [V3_LIST_RESOURCES_HINT],
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: false,
  };
}

type ListedTool = ListToolsResult["tools"][number];

/**
 * workerd forbids Ajv's `new Function`. The default MCP client validator is
 * Ajv, so the cache probe would throw inside the Worker and never store the
 * list. This validator is the one BT Servant uses.
 */
const jsonSchemaValidator = new CfWorkerJsonSchemaValidator();

let strictInputs: z.ZodType[] | undefined;
let sdkToolList: Promise<ListedTool[]> | undefined;

function strictInputSchemas(): z.ZodType[] {
  if (!strictInputs) {
    strictInputs = V3_TOOLS.map((tool) =>
      strictToolSchema(tool.inputSchema.shape),
    );
  }
  return strictInputs;
}

function loadSdkToolList(): Promise<ListedTool[]> {
  sdkToolList ??= captureSdkToolList().catch((error: unknown) => {
    sdkToolList = undefined;
    throw error;
  });
  return sdkToolList;
}

async function captureSdkToolList(): Promise<ListedTool[]> {
  const server = new V3NormalizingMcpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: V3_SERVER_INSTRUCTIONS },
  );
  registerV3Surface(
    server,
    () => {
      throw new Error("Tool list cache probe does not run tools.");
    },
    false,
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "v3-schema-cache", version: "0.0.0" },
    { jsonSchemaValidator },
  );
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
  } catch (error) {
    // The frame was already copied. A validator failure must not drop a list
    // we actually received.
    if (!tools) throw error;
  } finally {
    await client.close().catch(() => {});
  }
  if (!tools) {
    throw new Error(
      "v3 tool list cache probe did not see a tools/list result.",
    );
  }
  return tools;
}

async function listToolsViaPublicClient(): Promise<ListedTool[]> {
  const server = new V3NormalizingMcpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: V3_SERVER_INSTRUCTIONS },
  );
  registerV3Surface(
    server,
    () => {
      throw new Error("Uncached v3 tool list does not run tools.");
    },
    false,
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "v3-tool-list-fallback", version: "0.0.0" },
    { jsonSchemaValidator },
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    const listed = await client.listTools();
    return structuredClone(listed.tools);
  } finally {
    await client.close().catch(() => {});
  }
}

type StoredListHandler = (
  request: unknown,
  extra: unknown,
) => Promise<ListToolsResult> | ListToolsResult;

function sdkListToolsHandler(
  server: V3NormalizingMcpServer,
): StoredListHandler | undefined {
  const record = server.server as unknown as { _requestHandlers?: unknown };
  const handlers = record._requestHandlers;
  if (!(handlers instanceof Map)) return undefined;
  const handler = handlers.get("tools/list");
  return typeof handler === "function"
    ? (handler as StoredListHandler)
    : undefined;
}

function installCachedToolList(server: V3NormalizingMcpServer): void {
  const fallback = sdkListToolsHandler(server);
  server.server.setRequestHandler(
    ListToolsRequestSchema,
    async (request, extra) => {
      try {
        return { tools: structuredClone(await loadSdkToolList()) };
      } catch (error) {
        logger.warn("tool:list_cache_fallback", {
          version: "v3",
          reason: error instanceof Error ? error.message : String(error),
        });
        if (fallback) {
          try {
            return await fallback(request, extra);
          } catch (handlerError) {
            logger.warn("tool:list_private_handler_failed", {
              version: "v3",
              reason:
                handlerError instanceof Error
                  ? handlerError.message
                  : String(handlerError),
            });
          }
        }
        return { tools: await listToolsViaPublicClient() };
      }
    },
  );
}

/** requestId and timings stay in the logs. They are not part of the answer. */
function stripInternal(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  delete out.requestId;
  const meta = out.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const next: Record<string, unknown> = {
      ...(meta as Record<string, unknown>),
    };
    delete next.timings;
    if (Object.keys(next).length === 0) delete out.meta;
    else out.meta = next;
  }
  return out;
}

function forModel<T>(result: T): T {
  if (!result || typeof result !== "object") return result;
  const record = result as {
    content?: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
  };
  if (!record.structuredContent) return result;
  const data = stripInternal(record.structuredContent);
  const content = record.content?.map((part) => {
    if (part.type !== "text" || !part.text.trim().startsWith("{")) return part;
    try {
      const parsed = JSON.parse(part.text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return part;
      }
      return {
        ...part,
        text: JSON.stringify(stripInternal(parsed as Record<string, unknown>)),
      };
    } catch {
      return part;
    }
  });
  return {
    ...record,
    structuredContent: data,
    ...(content ? { content } : {}),
  } as T;
}

export function registerV3Server(
  server: V3NormalizingMcpServer,
  resolveEnv: ResolveV3Env,
): void {
  registerV3Surface(server, resolveEnv, true);
}

function registerV3Surface(
  server: V3NormalizingMcpServer,
  resolveEnv: ResolveV3Env,
  cacheToolList: boolean,
): void {
  const inputs = strictInputSchemas();
  for (const [index, tool] of V3_TOOLS.entries()) {
    const { name, description, outputSchema, annotations, handler } = tool;
    const inputSchema = inputs[index];
    if (!inputSchema) {
      throw new Error(`Missing cached input schema for ${name}`);
    }

    server.registerTool(
      name,
      {
        title: annotations.title,
        description,
        inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
        annotations: {
          title: annotations.title,
          readOnlyHint: annotations.readOnlyHint,
          destructiveHint: annotations.destructiveHint ?? false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (rawParams: unknown) => {
        const params = rawParams as Record<string, unknown>;
        const env = resolveEnv();
        const requestId = crypto.randomUUID();
        const start = Date.now();
        let errorCode = "OK";
        let cacheStatus: "hit" | "miss" | "stale" | "none" = "none";
        const metricTool = `v3:${name}`;

        try {
          logger.info("tool:call", { tool: name, requestId, surface: "v3" });
          const result = await handler(params as never, env, requestId);
          if (result && typeof result === "object" && "cacheStatus" in result) {
            cacheStatus = result.cacheStatus ?? "none";
          }
          recordToolCall(env.ANALYTICS, {
            tool: metricTool,
            requestId,
            latencyMs: Date.now() - start,
            cacheStatus,
            errorCode,
            language: params.language as string | undefined,
          });
          return forModel(result) as never;
        } catch (err) {
          if (isTranslationHelpsError(err)) {
            errorCode = err.code;
            logger.error("tool:error", {
              tool: name,
              requestId,
              code: err.code,
              message: err.message,
              surface: "v3",
            });
            recordToolCall(env.ANALYTICS, {
              tool: metricTool,
              requestId,
              latencyMs: Date.now() - start,
              cacheStatus: "none",
              errorCode,
            });
            return mcpError(err) as never;
          }

          if (err instanceof ApiClientError && err.status === 404) {
            errorCode = "RESOURCE_NOT_AVAILABLE";
            logger.info("tool:not_available", {
              tool: name,
              requestId,
              message: err.message,
              surface: "v3",
            });
            recordToolCall(env.ANALYTICS, {
              tool: metricTool,
              requestId,
              latencyMs: Date.now() - start,
              cacheStatus: "none",
              errorCode,
            });
            return mcpNotAvailable(err.message) as never;
          }

          const message = err instanceof Error ? err.message : String(err);
          errorCode = ErrorCode.INTERNAL_ERROR;
          logger.error("tool:unexpected_error", {
            tool: name,
            requestId,
            code: errorCode,
            message,
            surface: "v3",
          });
          recordToolCall(env.ANALYTICS, {
            tool: metricTool,
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

  if (cacheToolList) installCachedToolList(server);
}
