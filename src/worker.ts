/**
 * Cloudflare Worker entry point — translation-helps-mcp v2.
 *
 * Routing:
 *   /mcp   → TranslationHelpsMCP McpAgent (Durable Object, Streamable HTTP + SSE)
 *   /mcp/* → same
 *   *      → SvelteKit website (Workers Assets)
 */

import { TranslationHelpsMCP } from "./mcp/agent.js";

// Re-export the Durable Object class so Cloudflare can find it via the binding.
export { TranslationHelpsMCP };

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

    // Route everything else to the SvelteKit site (Workers Assets)
    return env.ASSETS.fetch(request);
  },
};
