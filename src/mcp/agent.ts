/**
 * TranslationHelpsMCP — the McpAgent Durable Object.
 *
 * All MCP tools are registered in init(). Each tool module in ./tools/
 * exports: inputSchema (Zod), outputSchema (Zod), annotations, and a handler.
 *
 * This is the single source of truth for the MCP tool registry.
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VERSION, SERVER_NAME } from "../core/version.js";
import { logger } from "../core/logger.js";
import { recordToolCall } from "../core/metrics.js";
import {
  isTranslationHelpsError,
  ErrorCode,
  type TranslationHelpsError,
} from "../core/errors.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { strictToolSchema } from "./jsonSchema.js";
import { normalizeToolArgs } from "./normalizeToolArgs.js";
import { ApiClientError } from "./apiClient.js";

// Tool registry — single source of truth for MCP tools
import { MCP_TOOLS } from "./toolRegistry.js";

// Prompt modules
import { PROMPTS } from "./prompts/index.js";

export interface Env {
  MCP_AGENT: DurableObjectNamespace;
  TRANSLATION_HELPS_CACHE: KVNamespace;
  ZIP_FILES: R2Bucket;
  ANALYTICS: AnalyticsEngineDataset;
  /** Cloudflare service binding to the REST Data API worker. */
  API?: Fetcher;
  /** Base URL for the REST Data API worker (local dev when service binding is absent). */
  API_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  /**
   * Optional waitUntil from the request ExecutionContext. When set (chat/agent
   * Workers path), background work like prefetch stays alive after the response.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Progressive-disclosure workflow tools (in canonical flow order).
 * Sourced from the shared toolRegistry to avoid duplication.
 */
const ALL_TOOLS = MCP_TOOLS;

export type ToolName = string;

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

export class TranslationHelpsMCP extends McpAgent<Env> {
  server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  /**
   * Intercept JSON-RPC `tools/call` requests to normalize LLM-generated
   * arguments BEFORE the SDK validates them against the tool's Zod schema.
   * This ensures synonyms (word_id, article_id, etc.) and decomposed references
   * ({book, chapter, verse}) are accepted without Zod rejection.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      try {
        const cloned = request.clone();
        const body = (await cloned.json()) as Record<string, unknown>;
        if (
          body.method === "tools/call" &&
          body.params &&
          typeof body.params === "object"
        ) {
          const params = body.params as { name?: string; arguments?: unknown };
          if (params.name) {
            const normalized = normalizeToolArgs(
              params.name,
              params.arguments ?? {},
            );
            const newBody = {
              ...body,
              params: { ...params, arguments: normalized },
            };
            const newRequest = new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: JSON.stringify(newBody),
            });
            return super.fetch(newRequest);
          }
        }
      } catch {
        // Could not parse/intercept — pass through unchanged.
      }
    }
    return super.fetch(request);
  }

  async init(): Promise<void> {
    // Register every tool with full metadata: title, outputSchema, annotations
    for (const tool of ALL_TOOLS) {
      const {
        name,
        description,
        inputSchema,
        outputSchema,
        annotations,
        handler,
      } = tool;

      // zod 4: `.refine()` no longer wraps in ZodEffects, so `.shape` is
      // always present on the tool's input schema.
      const schemaShape = (inputSchema as z.ZodObject<z.ZodRawShape>).shape;

      this.server.registerTool(
        name,
        {
          title: annotations.title,
          description,
          // Wrapped (not passed as a bare shape) so tools/list keeps
          // `additionalProperties: false` under zod 4 — see strictToolSchema.
          inputSchema: strictToolSchema(schemaShape),
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
          const requestId = crypto.randomUUID();
          const start = Date.now();
          let errorCode = "OK";
          let cacheStatus: "hit" | "miss" | "stale" | "none" = "none";

          try {
            logger.info(`tool:call`, { tool: name, requestId });
            // Expose DO waitUntil so tools (e.g. get_passage prefetch) can
            // schedule background work that survives after the MCP response.
            const toolEnv: Env = {
              ...this.env,
              waitUntil: (promise: Promise<unknown>) => {
                this.ctx.waitUntil(promise);
              },
            };
            const result = await handler(params as never, toolEnv, requestId);

            // Extract cache status if the handler attached it
            if (
              result &&
              typeof result === "object" &&
              "cacheStatus" in result
            ) {
              cacheStatus = (
                result as { cacheStatus: "hit" | "miss" | "stale" | "none" }
              ).cacheStatus;
            }

            recordToolCall(this.env.ANALYTICS, {
              tool: name,
              requestId,
              latencyMs: Date.now() - start,
              cacheStatus,
              errorCode,
              language: (params as Record<string, unknown>).language as
                | string
                | undefined,
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
              recordToolCall(this.env.ANALYTICS, {
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
              recordToolCall(this.env.ANALYTICS, {
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
            recordToolCall(this.env.ANALYTICS, {
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

    // Register prompts
    for (const prompt of PROMPTS) {
      // `argsSchema` is a loose `Record<string, ZodTypeAny>`, so the SDK cannot
      // infer concrete argument names and types the callback as
      // `ShapeOutput<...>`. Our handlers read string fields off the parsed
      // args, which is what the SDK passes at runtime; the cast bridges the
      // inference gap without changing behaviour.
      type PromptCallback = Parameters<typeof this.server.prompt>[3];
      this.server.prompt(
        prompt.name,
        prompt.description,
        prompt.argsSchema,
        prompt.handler as unknown as PromptCallback,
      );
    }
  }
}
