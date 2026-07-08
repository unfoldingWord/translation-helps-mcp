/**
 * Cloudflare Worker entry point — translation-helps-mcp v2.
 *
 * Routing:
 *   /mcp   → TranslationHelpsMCP McpAgent (Durable Object, per-session)
 *   /mcp/* → same
 *   /api/tool → direct tool runner (used by Skills chat layer)
 *   *      → SvelteKit website (Workers Assets)
 */

import { TranslationHelpsMCP } from "./mcp/agent.js";
import { logger } from "./core/logger.js";
import { normalizeToolArgs } from "./mcp/normalizeToolArgs.js";
import { TOOL_REGISTRY } from "./mcp/toolRegistry.js";
import { ApiClientError } from "./mcp/apiClient.js";

// Per-session MCP routing: each client session gets its own Durable Object instance.
const mcpHandler = TranslationHelpsMCP.serve("/mcp", { binding: "MCP_AGENT" });

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
  /** Optional shared secret for /api/tool endpoint. */
  TOOL_SECRET?: string;
  OPENAI_API_KEY?: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route MCP traffic to per-session McpAgent Durable Object instances.
    // McpAgent.serve creates a unique DO instance per session ID instead of a singleton.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return mcpHandler.fetch(request, env, _ctx);
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
    "Access-Control-Allow-Headers": "Content-Type, X-Tool-Secret",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  // Shared-secret auth guard (optional — only enforced when TOOL_SECRET is set)
  if (env.TOOL_SECRET) {
    const provided = request.headers.get("X-Tool-Secret");
    if (provided !== env.TOOL_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }
  }

  let body: {
    name?: string;
    params?: Record<string, unknown>;
    requestId?: string;
  };
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
    const normalized = normalizeToolArgs(name, params);
    const validated = tool.inputSchema.parse(normalized);
    const result = await tool.handler(validated, env, requestId);

    // Map 404 ApiClientError to notAvailable (same contract as agent.ts)
    return new Response(
      JSON.stringify({
        structuredContent: result.structuredContent,
        content: result.content,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...cors } },
    );
  } catch (err) {
    // 404 from the data API = resource not available, not a server error
    if (err instanceof ApiClientError && err.status === 404) {
      const notAvail = {
        available: false,
        code: "RESOURCE_NOT_AVAILABLE",
        message: err.message,
      };
      return new Response(
        JSON.stringify({
          structuredContent: notAvail,
          content: [{ type: "text", text: JSON.stringify(notAvail) }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...cors },
        },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error("tool:error", { name, message });
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
}
