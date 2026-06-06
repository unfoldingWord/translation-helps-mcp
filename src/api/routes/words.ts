/**
 * GET /api/v1/words?language=&category=     — list articles
 * GET /api/v1/words/{path}?language=        — fetch single article
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { makeFetcher, getResourceZipUrl } from "./helpers.js";
import {
  parseTwArticlePathsFromZipEntries,
  buildTwArticle,
} from "../../core/parsers/catalogParsers.js";
import { buildTwPathCandidates } from "../../core/parsers/markdown.js";

export async function handleWords(ctx: RouteContext): Promise<Response> {
  const { url, env } = ctx;
  const language = url.searchParams.get("language");
  if (!language) return apiError("BAD_REQUEST", "Missing required param: language", 400);
  const category = (url.searchParams.get("category") ?? undefined) as
    | "kt" | "other" | "names"
    | undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "9999", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const cacheKey = `catalog:tw:${language}${category ? `:${category}` : ""}`;
  if (env.TRANSLATION_HELPS_CACHE) {
    const cached = await env.TRANSLATION_HELPS_CACHE.get(cacheKey).catch(() => null);
    if (cached) {
      const all = JSON.parse(cached);
      const page = all.slice(offset, offset + limit);
      return json({ language, total_count: all.length, articles: page, has_more: offset + limit < all.length });
    }
  }

  const resolved = await getResourceZipUrl(language, "Translation Words", "unfoldingWord", "prod", env.TRANSLATION_HELPS_CACHE);
  if (!resolved) return json({ language, total_count: 0, articles: [], has_more: false });

  const fetcher = makeFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
  const entries = fetcher.listZipEntries(zip);

  const paths = parseTwArticlePathsFromZipEntries(entries, category);

  const BATCH = 50;
  const articles = [];
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

  const page = articles.slice(offset, offset + limit);
  return json({ language, total_count: articles.length, articles: page, has_more: offset + limit < articles.length });
}

export async function handleWordsPath(ctx: RouteContext): Promise<Response> {
  const { url, env, pathParam } = ctx;
  const language = url.searchParams.get("language");
  if (!language) return apiError("BAD_REQUEST", "Missing required param: language", 400);
  if (!pathParam) return apiError("BAD_REQUEST", "Missing word path", 400);

  const resolved = await getResourceZipUrl(language, "Translation Words", "unfoldingWord", "prod", env.TRANSLATION_HELPS_CACHE);
  if (!resolved) return apiError("NOT_FOUND", `Translation Words not found for "${language}"`, 404);

  const fetcher = makeFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
  const candidates = buildTwPathCandidates(pathParam);

  let article: string | null = null;
  let resolvedPath = "";
  for (const c of candidates) {
    article = await fetcher.extractFileFromZip(zip, c);
    if (article) { resolvedPath = c; break; }
  }

  if (!article) {
    return apiError("NOT_FOUND", `Translation Word not found at path: "${pathParam}"`, 404);
  }

  return json({ language, path: resolvedPath, article });
}
