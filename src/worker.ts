/**
 * Cloudflare Worker entry point — translation-helps-mcp v2.
 *
 * Routing:
 *   /mcp   → TranslationHelpsMCP McpAgent (Durable Object, Streamable HTTP + SSE)
 *   /mcp/* → same
 *   *      → SvelteKit website (Workers Assets)
 */

import { TranslationHelpsMCP } from "./mcp/agent.js";
import { logger } from "./core/logger.js";

// New workflow tools (MCP-facing, new progressive-disclosure surface)
import { listLanguagesTool } from "./mcp/tools/listLanguages.js";
import { getPassageTool } from "./mcp/tools/getPassage.js";
import { getPassageContextTool } from "./mcp/tools/getPassageContext.js";
import { getPassageIndexTool } from "./mcp/tools/getPassageIndex.js";
import { getNoteTool } from "./mcp/tools/getNote.js";
import { getAcademyArticleTool } from "./mcp/tools/getAcademyArticle.js";
import { getWordArticleTool } from "./mcp/tools/getWordArticle.js";
import { getPassageQuestionsTool } from "./mcp/tools/getPassageQuestions.js";
import { searchArticlesWorkflowTool } from "./mcp/tools/searchArticlesWorkflow.js";

// Legacy tools — kept available at /api/tool so ContextHarness (chat playground)
// continues to work during the gradual migration. NOT registered in the MCP agent.
import { getBundleTool } from "./mcp/tools/getBundle.js";
import { fetchScriptureTool } from "./mcp/tools/fetchScripture.js";
import { fetchTranslationNotesTool } from "./mcp/tools/fetchTranslationNotes.js";
import { fetchTranslationWordTool } from "./mcp/tools/fetchTranslationWord.js";
import { fetchTranslationWordLinksTool } from "./mcp/tools/fetchTranslationWordLinks.js";
import { fetchTranslationAcademyTool } from "./mcp/tools/fetchTranslationAcademy.js";
import { fetchTranslationQuestionsTool } from "./mcp/tools/fetchTranslationQuestions.js";
import { listTranslationAcademyTool } from "./mcp/tools/listTranslationAcademy.js";
import { listTranslationWordsTool } from "./mcp/tools/listTranslationWords.js";
import { listSubjectsTool } from "./mcp/tools/listSubjects.js";
import { listResourcesForLanguageTool } from "./mcp/tools/listResourcesForLanguage.js";
import { listResourcesByLanguageTool } from "./mcp/tools/listResourcesByLanguage.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOL_REGISTRY: Record<string, any> = {
  // New workflow tools (MCP surface)
  list_languages: listLanguagesTool,
  get_passage: getPassageTool,
  get_passage_context: getPassageContextTool,
  get_passage_index: getPassageIndexTool,
  get_note: getNoteTool,
  get_academy_article: getAcademyArticleTool,
  get_word_article: getWordArticleTool,
  get_questions: getPassageQuestionsTool,
  search_articles: searchArticlesWorkflowTool,
  // Legacy tools (harness compat, not on MCP surface)
  get_bundle: getBundleTool,
  fetch_scripture: fetchScriptureTool,
  fetch_translation_notes: fetchTranslationNotesTool,
  fetch_translation_word: fetchTranslationWordTool,
  fetch_translation_academy: fetchTranslationAcademyTool,
  fetch_translation_questions: fetchTranslationQuestionsTool,
  fetch_translation_word_links: fetchTranslationWordLinksTool,
  list_translation_academy: listTranslationAcademyTool,
  list_translation_words: listTranslationWordsTool,
  list_subjects: listSubjectsTool,
  list_resources_for_language: listResourcesForLanguageTool,
  list_resources_by_language: listResourcesByLanguageTool,
};

// Re-export the Durable Object class so Cloudflare can find it via the binding.
export { TranslationHelpsMCP };

export interface Env {
  MCP_AGENT: DurableObjectNamespace;
  TRANSLATION_HELPS_CACHE: KVNamespace;
  ZIP_FILES: R2Bucket;
  ANALYTICS: AnalyticsEngineDataset;
  /** Cloudflare service binding to the REST Data API worker. */
  API?: Fetcher;
  /** Base URL for the REST Data API worker used in local dev when service binding is absent. */
  API_BASE_URL?: string;
  ADMIN_TOKEN?: string;
  OPENAI_API_KEY?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route MCP traffic to the McpAgent Durable Object
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const id = env.MCP_AGENT.idFromName("singleton");
      const stub = env.MCP_AGENT.get(id);
      return stub.fetch(request);
    }

    // Internal HTTP tool runner — used by the Skills chat layer.
    // Accepts POST { name, params, requestId? } and calls the tool handler directly
    // with real Cloudflare bindings, bypassing the WebSocket-only McpAgent.
    if (url.pathname === "/api/tool" && request.method === "POST") {
      return handleToolCall(request, env);
    }

    // Route everything else to the SvelteKit site (Workers Assets)
    return env.ASSETS.fetch(request);
  },

};

async function handleToolCall(request: Request, env: Env): Promise<Response> {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  let body: { name?: string; params?: Record<string, unknown>; requestId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const { name, params = {}, requestId = crypto.randomUUID() } = body;
  if (!name) {
    return new Response(JSON.stringify({ error: "Missing tool name" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const tool = TOOL_REGISTRY[name];
  if (!tool) {
    return new Response(JSON.stringify({ error: `Unknown tool: "${name}"` }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  try {
    const validated = tool.inputSchema.parse(params);
    const result = await tool.handler(validated, env, requestId);
    return new Response(
      JSON.stringify({ structuredContent: result.structuredContent, content: result.content }),
      { status: 200, headers: { "Content-Type": "application/json", ...cors } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("tool:error", { name, message });
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
}

