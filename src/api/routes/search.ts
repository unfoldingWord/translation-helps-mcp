/**
 * GET /api/v1/search?q=&language=&types=ta,tw&limit=5
 *
 * TF-scored article search over Translation Academy + Translation Words catalogs.
 * Scoring lives here in the REST layer (not in the MCP).
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { makeFetcher, resolveResourceZip } from "./helpers.js";
import {
  parseTaArticlePathsFromZipEntries,
  parseTwArticlePathsFromZipEntries,
  buildTaArticle,
  buildTwArticle,
} from "@translation-helps/door43";
import { rankArticles } from "@translation-helps/door43";
import type { AcademyArticle, WordArticle } from "@translation-helps/door43";
import { isSafeArticlePath } from "../../core/articlePath.js";

export async function handleSearch(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;
  const q = url.searchParams.get("q");
  const requestedLanguage = url.searchParams.get("language");
  if (!q || !requestedLanguage) {
    return apiError("BAD_REQUEST", "Missing required params: q, language", 400);
  }
  const typesParam = url.searchParams.get("types") ?? "ta,tw";
  const types = typesParam.split(",").map((t) => t.trim()) as Array<
    "ta" | "tw"
  >;
  const topK = parseInt(url.searchParams.get("limit") ?? "5", 10);

  const candidates: Array<{
    path: string;
    title: string;
    category: string;
    resourceType: "ta" | "tw";
  }> = [];

  // Resolve once so both TA and TW share the same effective language (es → es-419).
  let language = requestedLanguage;

  if (types.includes("ta")) {
    const ta = await loadTaArticles(requestedLanguage, env, execCtx);
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

  if (types.includes("tw")) {
    const tw = await loadTwArticles(requestedLanguage, env, execCtx);
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

  const results = rankArticles(candidates, q, topK).filter((r) =>
    isSafeArticlePath(r.path),
  );
  return json({ q, language, requestedLanguage, results });
}

// ---------------------------------------------------------------------------
// Catalog loaders (with KV caching)
// ---------------------------------------------------------------------------

async function loadTaArticles(
  requestedLanguage: string,
  env: RouteContext["env"],
  execCtx?: ExecutionContext,
): Promise<{ language: string; articles: AcademyArticle[] }> {
  const resolved = await resolveResourceZip(
    requestedLanguage,
    "Translation Academy",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) return { language: requestedLanguage, articles: [] };

  const { language, zipUrl } = resolved;
  const cacheKey = `catalog:ta:${language}`;
  if (env.TRANSLATION_HELPS_CACHE) {
    const cached = await env.TRANSLATION_HELPS_CACHE.get(cacheKey).catch(
      () => null,
    );
    if (cached)
      return {
        language,
        articles: JSON.parse(cached) as AcademyArticle[],
      };
  }

  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(zipUrl);
  const entries = fetcher.listZipEntries(zip);
  const slugs = parseTaArticlePathsFromZipEntries(entries);

  const articles = await Promise.all(
    slugs.map(async (slug) => {
      const titleMd = await fetcher.extractFileFromZip(zip, `${slug}/title.md`);
      return buildTaArticle(slug, titleMd);
    }),
  );
  articles.sort((a, b) => a.path.localeCompare(b.path));

  if (env.TRANSLATION_HELPS_CACHE) {
    env.TRANSLATION_HELPS_CACHE.put(cacheKey, JSON.stringify(articles), {
      expirationTtl: 86400,
    }).catch(() => {});
  }

  return { language, articles };
}

async function loadTwArticles(
  requestedLanguage: string,
  env: RouteContext["env"],
  execCtx?: ExecutionContext,
): Promise<{ language: string; articles: WordArticle[] }> {
  const resolved = await resolveResourceZip(
    requestedLanguage,
    "Translation Words",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) return { language: requestedLanguage, articles: [] };

  const { language, zipUrl } = resolved;
  const cacheKey = `catalog:tw:${language}`;
  if (env.TRANSLATION_HELPS_CACHE) {
    const cached = await env.TRANSLATION_HELPS_CACHE.get(cacheKey).catch(
      () => null,
    );
    if (cached)
      return {
        language,
        articles: JSON.parse(cached) as WordArticle[],
      };
  }

  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(zipUrl);
  const entries = fetcher.listZipEntries(zip);
  const paths = parseTwArticlePathsFromZipEntries(entries);

  const BATCH = 50;
  const articles: WordArticle[] = [];
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async ({ slug, cat }) => {
        const content = await fetcher.extractFileFromZip(zip, `${slug}.md`);
        return buildTwArticle(slug, cat, content);
      }),
    );
    articles.push(...results);
  }
  articles.sort((a, b) => a.path.localeCompare(b.path));

  if (env.TRANSLATION_HELPS_CACHE) {
    env.TRANSLATION_HELPS_CACHE.put(cacheKey, JSON.stringify(articles), {
      expirationTtl: 86400,
    }).catch(() => {});
  }

  return { language, articles };
}
