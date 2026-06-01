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

// Tool modules
import { fetchScriptureTool } from "./tools/fetchScripture.js";
import { fetchTranslationNotesTool } from "./tools/fetchTranslationNotes.js";
import { fetchTranslationQuestionsTool } from "./tools/fetchTranslationQuestions.js";
import { fetchTranslationWordLinksTool } from "./tools/fetchTranslationWordLinks.js";
import { fetchTranslationWordTool } from "./tools/fetchTranslationWord.js";
import { fetchTranslationAcademyTool } from "./tools/fetchTranslationAcademy.js";
import { listLanguagesTool } from "./tools/listLanguages.js";
import { listSubjectsTool } from "./tools/listSubjects.js";
import { listResourcesForLanguageTool } from "./tools/listResourcesForLanguage.js";
import { ragQueryTool } from "./tools/ragQuery.js";
import { getBundleTool } from "./tools/getBundle.js";
import { indexResourceTool } from "./tools/indexResource.js";

// Prompt modules
import { PROMPTS } from "./prompts/index.js";

export interface Env {
  MCP_AGENT: DurableObjectNamespace;
  TRANSLATION_HELPS_CACHE: KVNamespace;
  ZIP_FILES: R2Bucket;
  AI: Ai;
  VECTORIZE_INDEX: VectorizeIndex;
  ANALYTICS: AnalyticsEngineDataset;
  ADMIN_TOKEN?: string;
  OPENAI_API_KEY?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

/** All registered tools, in discovery order. */
const ALL_TOOLS = [
  fetchScriptureTool,
  fetchTranslationNotesTool,
  fetchTranslationQuestionsTool,
  fetchTranslationWordLinksTool,
  fetchTranslationWordTool,
  fetchTranslationAcademyTool,
  listLanguagesTool,
  listSubjectsTool,
  listResourcesForLanguageTool,
  ragQueryTool,
  getBundleTool,
  indexResourceTool,
] as const;

export type ToolName = (typeof ALL_TOOLS)[number]["name"];

/** MCP-standard error response helper. */
function mcpError(err: TranslationHelpsError): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(err.toMcpError(), null, 2),
      },
    ],
    isError: true,
  };
}

export class TranslationHelpsMCP extends McpAgent<Env> {
  server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
  });

  async init(): Promise<void> {
    // Register every tool
    for (const tool of ALL_TOOLS) {
      const { name, description, inputSchema, handler } = tool;

      // Extract shape: handle both ZodObject and ZodEffects
      const schemaShape =
        inputSchema instanceof z.ZodEffects
          ? (inputSchema.innerType() as z.ZodObject<z.ZodRawShape>).shape
          : (inputSchema as z.ZodObject<z.ZodRawShape>).shape;

      this.server.tool(
        name,
        description,
        schemaShape as Record<string, z.ZodTypeAny>,
        async (params: Record<string, unknown>) => {
          const requestId = crypto.randomUUID();
          const start = Date.now();
          let errorCode = "OK";
          let cacheStatus: "hit" | "miss" | "stale" | "none" = "none";

          try {
            logger.info(`tool:call`, { tool: name, requestId });
            const result = await handler(params as never, this.env, requestId);

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
                  text: JSON.stringify({
                    code: errorCode,
                    message: `Internal error in ${name}: ${message}`,
                    retryable: false,
                    hints: [],
                  }),
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
      this.server.prompt(
        prompt.name,
        prompt.description,
        prompt.argsSchema,
        prompt.handler,
      );
    }
  }
}
