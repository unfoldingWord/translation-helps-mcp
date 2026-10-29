/**
 * Shared MCP registration for the Durable Object and the stateless handler.
 *
 * Tool schemas, descriptions, argument handling, instructions and prompts stay
 * in one place so the two HTTP paths cannot drift.
 */

import { z } from "zod";
import { logger } from "../core/logger.js";
import { recordToolCall } from "../core/metrics.js";
import {
  isTranslationHelpsError,
  ErrorCode,
  type TranslationHelpsError,
} from "../core/errors.js";
import { strictToolSchema } from "./jsonSchema.js";
import { ApiClientError } from "./apiClient.js";
import { MCP_TOOLS } from "./toolRegistry.js";
import { PROMPTS } from "./prompts/index.js";
import type { NormalizingMcpServer } from "./normalizingMcpServer.js";
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

export function registerTranslationHelpsServer(
  server: NormalizingMcpServer,
  resolveEnv: ResolveToolEnv,
): void {
  for (const tool of MCP_TOOLS) {
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

    server.registerTool(
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
}
