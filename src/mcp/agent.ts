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

// Workflow tool modules (new progressive-disclosure surface)
import { getPassageTool } from "./tools/getPassage.js";
import { getPassageContextTool } from "./tools/getPassageContext.js";
import { getPassageIndexTool } from "./tools/getPassageIndex.js";
import { getNoteTool } from "./tools/getNote.js";
import { getAcademyArticleTool } from "./tools/getAcademyArticle.js";
import { getWordArticleTool } from "./tools/getWordArticle.js";
import { getPassageQuestionsTool } from "./tools/getPassageQuestions.js";
import { searchArticlesWorkflowTool } from "./tools/searchArticlesWorkflow.js";
import { listLanguagesTool } from "./tools/listLanguages.js";

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
  ADMIN_TOKEN?: string;
  OPENAI_API_KEY?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

/**
 * Progressive-disclosure workflow tools (in canonical flow order).
 * Retired: get_bundle, fetch_scripture, fetch_translation_notes,
 *          fetch_translation_questions, fetch_translation_word,
 *          fetch_translation_academy, fetch_translation_word_links.
 * Their parsing logic is preserved in src/core/ and the REST API.
 */
const ALL_TOOLS = [
  listLanguagesTool,           // orient: discover valid language codes
  getPassageTool,              // orient/draft: scripture text (all versions) — cheap, repeatable
  getPassageContextTool,       // orient: book/chapter intros + resource availability
  getPassageIndexTool,         // survey: compact index of issues + key terms (no bodies)
  getNoteTool,                 // drill: full note body by id
  getAcademyArticleTool,       // drill: full TA article by path
  getWordArticleTool,          // drill: full TW article by path
  getPassageQuestionsTool,     // check: comprehension questions for a passage
  searchArticlesWorkflowTool,  // lateral: concept -> article path
] as const;

export type ToolName = (typeof ALL_TOOLS)[number]["name"];

/** MCP-standard error response helper. */
function mcpError(err: TranslationHelpsError): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: true;
} {
  const payload = err.toMcpError();
  return {
    content: [{ type: "text", text: `Error ${payload.code}: ${payload.message}` }],
    structuredContent: payload as unknown as Record<string, unknown>,
    isError: true,
  };
}

export class TranslationHelpsMCP extends McpAgent<Env> {
  server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  async init(): Promise<void> {
    // Register every tool with full metadata: title, outputSchema, annotations
    for (const tool of ALL_TOOLS) {
      const { name, description, inputSchema, outputSchema, annotations, handler } = tool;

      // Extract ZodRawShape: handle both ZodObject and ZodEffects
      const schemaShape =
        inputSchema instanceof z.ZodEffects
          ? (inputSchema.innerType() as z.ZodObject<z.ZodRawShape>).shape
          : (inputSchema as z.ZodObject<z.ZodRawShape>).shape;

      this.server.registerTool(
        name,
        {
          title: annotations.title,
          description,
          inputSchema: schemaShape as Record<string, z.ZodTypeAny>,
          ...(outputSchema ? { outputSchema } : {}),
          annotations: {
            readOnlyHint: annotations.readOnlyHint,
            ...(annotations.destructiveHint !== undefined
              ? { destructiveHint: annotations.destructiveHint }
              : {}),
          },
        },
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
            const errPayload = {
              code: errorCode,
              message: `Internal error in ${name}: ${message}`,
              retryable: false,
              hints: [],
            };
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error ${errorCode}: ${errPayload.message}`,
                },
              ],
              structuredContent: errPayload,
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
