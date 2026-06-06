/**
 * GET /api/v1/search?q=&language=&types=ta,tw&limit=5
 *
 * TF-scored article search over Translation Academy + Translation Words catalogs.
 * Scoring lives here in the REST layer (not in the MCP).
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { makeFetcher, getResourceZipUrl } from "./helpers.js";
import {
  parseTaArticlePathsFromZipEntries,
  parseTwArticlePathsFromZipEntries,
  buildTaArticle,
  buildTwArticle,
} from "../../core/parsers/catalogParsers.js";
import { rankArticles } from "../../core/parsers/articleSearch.js";
import type { AcademyArticle, WordArticle } from "../../core/contracts/index.js";

export async function handleSearch(ctx: RouteContext): Promise<Response> {
  const { url, env } = ctx;
  const q = url.searchParams.get("q");
  const language = url.searchParams.get("language");
  if (!q || !language) {
    return apiError("BAD_REQUEST", "Missing required params: q, language", 400);
  }
  const typesParam = url.searchParams.get("types") ?? "ta,tw";
  const types = typesParam.split(",").map((t) => t.trim()) as Array<"ta" | "tw">;
  const topK = parseInt(url.searchParams.get("limit") ?? "5", 10);

  const candidates: Array<{ path: string; title: string; category: string; resourceType: "ta" | "tw" }> = [];

  if (types.includes("ta")) {
    const taArticles = await loadTaArticles(language, env);
    for (const a of taArticles) {
      candidates.push({ path: a.path, title: a.title, category: a.category, resourceType: "ta" });
    }
  }

  if (types.includes("tw")) {
    const twArticles = await loadTwArticles(language, env);
    for (const a of twArticles) {
      candidates.push({ path: a.path, title: a.title, category: a.category, resourceType: "tw" });
    }
  }

  const results = rankArticles(candidates, q, topK);
  return json({ q, language, results });
}

// ---------------------------------------------------------------------------
// Catalog loaders (with KV caching)
// ---------------------------------------------------------------------------

async function loadTaArticles(language: string, env: RouteContext["env"]): Promise<AcademyArticle[]> {
  const cacheKey = `catalog:ta:${language}`;
  if (env.TRANSLATION_HELPS_CACHE) {
    const cached = await env.TRANSLATION_HELPS_CACHE.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as AcademyArticle[];
  }

  const resolved = await getResourceZipUrl(language, "Translation Academy", "unfoldingWord", "prod", env.TRANSLATION_HELPS_CACHE);
  if (!resolved) return [];

  const fetcher = makeFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
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
    env.TRANSLATION_HELPS_CACHE.put(cacheKey, JSON.stringify(articles), { expirationTtl: 86400 }).catch(() => {});
  }

  return articles;
}

async function loadTwArticles(language: string, env: RouteContext["env"]): Promise<WordArticle[]> {
  const cacheKey = `catalog:tw:${language}`;
  if (env.TRANSLATION_HELPS_CACHE) {
    const cached = await env.TRANSLATION_HELPS_CACHE.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as WordArticle[];
  }

  const resolved = await getResourceZipUrl(language, "Translation Words", "unfoldingWord", "prod", env.TRANSLATION_HELPS_CACHE);
  if (!resolved) return [];

  const fetcher = makeFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
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
    env.TRANSLATION_HELPS_CACHE.put(cacheKey, JSON.stringify(articles), { expirationTtl: 86400 }).catch(() => {});
  }

  return articles;
}
