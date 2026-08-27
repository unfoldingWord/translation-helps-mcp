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
  /** Max requests/min per IP for /api/v1/*. Default 90; 0 = off. */
  RATE_LIMIT_RPM?: string;
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
import { handleObs, handleObsNotes, handleObsQuestions } from "./routes/obs.js";
import { API_MANIFEST } from "./manifest.js";
import { enforceRateLimit } from "../core/rateLimit.js";

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

/** Routes whose GET responses are safe to edge-cache (no auth, stable params). */
const EDGE_CACHEABLE = new Set([
  "/languages",
  "/scripture",
  "/notes",
  "/word-links",
  "/questions",
  "/words",
  "/academy",
  "/quote",
  "/search",
  "/resources",
  "/obs",
  "/obs-notes",
  "/obs-questions",
]);

function isEdgeCacheablePath(routePath: string): boolean {
  if (EDGE_CACHEABLE.has(routePath)) return true;
  if (routePath.startsWith("/words/")) return true;
  if (routePath.startsWith("/academy/")) return true;
  return false;
}

async function withEdgeCache(
  request: Request,
  execCtx: ExecutionContext,
  handler: () => Promise<Response>,
): Promise<Response> {
  // Cache API is free and colo-local; sits in front of KV response caches.
  // Cloudflare exposes caches.default; DOM lib typings omit it.
  const cache = (caches as unknown as { default?: Cache }).default;
  if (cache) {
    try {
      const hit = await cache.match(request);
      if (hit) return hit;
    } catch {
      // fall through to handler
    }
  }

  const response = await handler();

  if (
    cache &&
    (response.status === 200 || response.status === 404) &&
    request.method === "GET"
  ) {
    const maxAge = response.status === 200 ? 3600 : 300;
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", `public, max-age=${maxAge}`);
    const toCache = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    // Clone for the client — toCache body is consumed by cache.put
    const forClient = toCache.clone();
    execCtx.waitUntil(cache.put(request, toCache).catch(() => {}));
    return forClient;
  }

  return response;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    execCtx: ExecutionContext,
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check (GET only) — never edge-cache, never rate-limit
    if (path === "/health" || path === "/api/health") {
      return json({
        status: "ok",
        service: "translation-helps-api",
        version: "1",
      });
    }

    // Soft per-IP limit on hot API paths (MCP corpus is public read-only)
    const limited = enforceRateLimit(request, env.RATE_LIMIT_RPM, CORS_HEADERS);
    if (limited) return limited;

    // Strip /api/v1 prefix
    if (!path.startsWith("/api/v1/")) {
      return apiError("NOT_FOUND", `Unknown path: ${path}`, 404);
    }

    // Prefetch accepts POST (fire-and-forget from MCP worker) or GET
    const routePath = path.slice("/api/v1".length);

    // Endpoint documentation manifest (docs site + third parties)
    if (routePath === "/_manifest") {
      if (request.method !== "GET") {
        return apiError("METHOD_NOT_ALLOWED", "Only GET is supported", 405);
      }
      return json(API_MANIFEST);
    }

    if (routePath === "/prefetch") {
      if (request.method !== "GET" && request.method !== "POST") {
        return apiError(
          "METHOD_NOT_ALLOWED",
          "Only GET or POST is supported",
          405,
        );
      }
      return handlePrefetch({ url, env, execCtx });
    }

    if (request.method !== "GET") {
      return apiError("METHOD_NOT_ALLOWED", "Only GET is supported", 405);
    }

    const ctx: RouteContext = { url, env, execCtx };

    const dispatch = async (): Promise<Response> => {
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

        // --- Open Bible Stories ---
        if (routePath === "/obs") return await handleObs(ctx);
        if (routePath === "/obs-notes") return await handleObsNotes(ctx);
        if (routePath === "/obs-questions")
          return await handleObsQuestions(ctx);

        return apiError("NOT_FOUND", `Unknown route: ${routePath}`, 404);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isNotFound =
          msg.toLowerCase().includes("not found") || msg.includes("404");
        if (isNotFound) {
          return apiError("NOT_FOUND", msg, 404, false);
        }
        console.error("[api] Unhandled error:", msg);
        return apiError(
          "INTERNAL_ERROR",
          "An unexpected error occurred",
          500,
          true,
        );
      }
    };

    if (isEdgeCacheablePath(routePath)) {
      return withEdgeCache(request, execCtx, dispatch);
    }
    return dispatch();
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
