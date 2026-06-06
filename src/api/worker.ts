/**
 * src/api/worker.ts — REST Data API Worker
 *
 * Serves /api/v1/* endpoints as a thin layer over Door43 resources.
 * Owns all caching (KV + R2), parsing (tsv/usfm), and alignment logic.
 * The MCP worker talks to this via a Cloudflare service binding (env.API).
 */

export interface Env {
  TRANSLATION_HELPS_CACHE: KVNamespace;
  ZIP_FILES: R2Bucket;
  ANALYTICS?: AnalyticsEngineDataset;
  /** Injected service binding in the MCP-to-API architecture (unused in api worker itself) */
  API?: Fetcher;
  NODE_ENV?: string;
}

// ---------------------------------------------------------------------------
// Route handlers (imported in api-routes step)
// ---------------------------------------------------------------------------
import { handleLanguages } from "./routes/languages.js";
import { handleScripture } from "./routes/scripture.js";
import { handleNotes } from "./routes/notes.js";
import { handleWordLinks } from "./routes/wordLinks.js";
import { handleQuestions } from "./routes/questions.js";
import { handleWords, handleWordsPath } from "./routes/words.js";
import { handleAcademy, handleAcademyPath } from "./routes/academy.js";
import { handleQuote } from "./routes/quote.js";
import { handleSearch } from "./routes/search.js";
import { handleResources } from "./routes/resources.js";
import { handlePrefetch } from "./routes/prefetch.js";

// ---------------------------------------------------------------------------
// CORS / common headers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function apiError(
  code: string,
  message: string,
  status: number,
  retryable = false,
): Response {
  return json({ error: { code, message, retryable } }, status);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, execCtx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check (GET only)
    if (path === "/health" || path === "/api/health") {
      return json({ status: "ok", service: "translation-helps-api", version: "1" });
    }

    // Strip /api/v1 prefix
    if (!path.startsWith("/api/v1/")) {
      return apiError("NOT_FOUND", `Unknown path: ${path}`, 404);
    }

    // Prefetch accepts POST (fire-and-forget from MCP worker) or GET
    const routePath = path.slice("/api/v1".length);
    if (routePath === "/prefetch") {
      if (request.method !== "GET" && request.method !== "POST") {
        return apiError("METHOD_NOT_ALLOWED", "Only GET or POST is supported", 405);
      }
      return handlePrefetch({ url, env, execCtx });
    }

    if (request.method !== "GET") {
      return apiError("METHOD_NOT_ALLOWED", "Only GET is supported", 405);
    }

    const ctx: RouteContext = { url, env, execCtx };

    try {
      // --- Languages ---
      if (routePath === "/languages") return await handleLanguages(ctx);

      // --- Scripture ---
      if (routePath === "/scripture") return await handleScripture(ctx);

      // --- Notes ---
      if (routePath === "/notes") return await handleNotes(ctx);

      // --- Word Links ---
      if (routePath === "/word-links") return await handleWordLinks(ctx);

      // --- Questions ---
      if (routePath === "/questions") return await handleQuestions(ctx);

      // --- Translation Words ---
      if (routePath === "/words") return await handleWords(ctx);
      if (routePath.startsWith("/words/")) {
        ctx.pathParam = routePath.slice("/words/".length);
        return await handleWordsPath(ctx);
      }

      // --- Translation Academy ---
      if (routePath === "/academy") return await handleAcademy(ctx);
      if (routePath.startsWith("/academy/")) {
        ctx.pathParam = routePath.slice("/academy/".length);
        return await handleAcademyPath(ctx);
      }

      // --- Quote alignment ---
      if (routePath === "/quote") return await handleQuote(ctx);

      // --- Article search ---
      if (routePath === "/search") return await handleSearch(ctx);

      // --- Resource availability ---
      if (routePath === "/resources") return await handleResources(ctx);

      return apiError("NOT_FOUND", `Unknown route: ${routePath}`, 404);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNotFound = msg.toLowerCase().includes("not found") || msg.includes("404");
      if (isNotFound) {
        return apiError("NOT_FOUND", msg, 404, false);
      }
      console.error("[api] Unhandled error:", msg);
      return apiError("INTERNAL_ERROR", "An unexpected error occurred", 500, true);
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// Shared context type passed to route handlers
// ---------------------------------------------------------------------------

export interface RouteContext {
  url: URL;
  env: Env;
  /** Cloudflare execution context — available when the route was called from the
   *  Worker fetch handler. Handlers can use execCtx.waitUntil() for background work. */
  execCtx?: ExecutionContext;
  pathParam?: string;
}

export { json, apiError };
