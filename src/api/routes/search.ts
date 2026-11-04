/**
 * GET /api/v1/search?q=&language=&types=ta,tw&limit=5
 *
 * TF-scored article search over Translation Academy + Translation Words catalogs.
 * Scoring lives here in the REST layer (not in the MCP).
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { rankArticles } from "@translation-helps/door43";
import { isSafeArticlePath } from "../../core/articlePath.js";
import { loadTaCatalog, loadTwCatalog } from "./articleCatalog.js";
import {
  coalesceInFlight,
  getCachedJson,
  putCachedJson,
  searchResponseCacheKey,
} from "./responseCache.js";
import {
  currentAnswerLayer,
  noteLayer,
  serverTimingActive,
  withServerTiming,
} from "../serverTiming.js";

export async function handleSearch(ctx: RouteContext): Promise<Response> {
  if (!serverTimingActive()) return withServerTiming(() => handleSearch(ctx));
  const { url, env, execCtx } = ctx;
  const q = url.searchParams.get("q");
  const requestedLanguage = url.searchParams.get("language");
  if (!q || !requestedLanguage) {
    return apiError("BAD_REQUEST", "Missing required params: q, language", 400);
  }
  const typesParam = url.searchParams.get("types") ?? "ta,tw";
  const types = typesParam
    .split(",")
    .map((t) => t.trim().toLowerCase()) as Array<"ta" | "tw">;
  const topK = parseInt(url.searchParams.get("limit") ?? "5", 10);
  const cacheKey = searchResponseCacheKey(
    q,
    requestedLanguage,
    typesParam,
    topK,
  );

  const cached = await getCachedJson<Record<string, unknown>>(
    env.TRANSLATION_HELPS_CACHE,
    cacheKey,
  );
  if (cached) {
    noteLayer("kv");
    return json(cached.value);
  }

  const built = await coalesceInFlight(cacheKey, async () => {
    const again = await getCachedJson<Record<string, unknown>>(
      env.TRANSLATION_HELPS_CACHE,
      cacheKey,
    );
    if (again) return { payload: again.value, layer: "kv" as const };

    const candidates: Array<{
      path: string;
      title: string;
      category: string;
      resourceType: "ta" | "tw";
    }> = [];

    // Resolve once so both TA and TW share the same effective language (es → es-419).
    let language = requestedLanguage;

    if (types.includes("ta")) {
      const ta = await loadTaCatalog(requestedLanguage, env, execCtx);
      if (ta) {
        language = ta.language;
        for (const a of ta.articles) {
          candidates.push({
            path: a.path,
            title: a.title,
            category: a.category,
            resourceType: "ta",
          });
        }
      }
    }

    if (types.includes("tw")) {
      const tw = await loadTwCatalog(requestedLanguage, env, execCtx);
      if (tw) {
        language = tw.language;
        for (const a of tw.articles) {
          candidates.push({
            path: a.path,
            title: a.title,
            category: a.category,
            resourceType: "tw",
          });
        }
      }
    }

    const results = rankArticles(candidates, q, topK).filter((r) =>
      isSafeArticlePath(r.path),
    );
    const payload = { q, language, requestedLanguage, results };
    putCachedJson(env.TRANSLATION_HELPS_CACHE, cacheKey, payload, execCtx);
    return {
      payload,
      layer: currentAnswerLayer() ?? ("network" as const),
    };
  });

  noteLayer(built.layer);
  return json(built.payload);
}
