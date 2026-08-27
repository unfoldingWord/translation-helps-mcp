/**
 * GET /api/v1/words?language=&category=     — list articles
 * GET /api/v1/words/{path}?language=        — fetch single article
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { makeFetcher, resolveResourceZip } from "./helpers.js";
import {
  parseTwArticlePathsFromZipEntries,
  buildTwArticle,
} from "@translation-helps/door43";
import { buildTwPathCandidates } from "@translation-helps/door43";
import { sanitizeArticlePath } from "../../core/articlePath.js";

export async function handleWords(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;
  const requestedLanguage = url.searchParams.get("language");
  if (!requestedLanguage)
    return apiError("BAD_REQUEST", "Missing required param: language", 400);
  const category = (url.searchParams.get("category") ?? undefined) as
    | "kt"
    | "other"
    | "names"
    | undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "9999", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const resolved = await resolveResourceZip(
    requestedLanguage,
    "Translation Words",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved)
    return json({
      language: requestedLanguage,
      requestedLanguage,
      total_count: 0,
      articles: [],
      has_more: false,
    });

  const { language, zipUrl } = resolved;
  const cacheKey = `catalog:tw:${language}${category ? `:${category}` : ""}`;
  if (env.TRANSLATION_HELPS_CACHE) {
    const cached = await env.TRANSLATION_HELPS_CACHE.get(cacheKey).catch(
      () => null,
    );
    if (cached) {
      const all = JSON.parse(cached);
      const page = all.slice(offset, offset + limit);
      return json({
        language,
        requestedLanguage,
        total_count: all.length,
        articles: page,
        has_more: offset + limit < all.length,
      });
    }
  }

  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(zipUrl);
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
    env.TRANSLATION_HELPS_CACHE.put(cacheKey, JSON.stringify(articles), {
      expirationTtl: 86400,
    }).catch(() => {});
  }

  const page = articles.slice(offset, offset + limit);
  return json({
    language,
    requestedLanguage,
    total_count: articles.length,
    articles: page,
    has_more: offset + limit < articles.length,
  });
}

export async function handleWordsPath(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx, pathParam } = ctx;
  const requestedLanguage = url.searchParams.get("language");
  if (!requestedLanguage)
    return apiError("BAD_REQUEST", "Missing required param: language", 400);
  if (!pathParam) return apiError("BAD_REQUEST", "Missing word path", 400);

  const pathCheck = sanitizeArticlePath(pathParam);
  if (!pathCheck.ok) {
    return apiError("INVALID_PARAMS", pathCheck.error.message, 400);
  }
  const safePath = pathCheck.path;

  const resolved = await resolveResourceZip(
    requestedLanguage,
    "Translation Words",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved)
    return apiError(
      "NOT_FOUND",
      `Translation Words not found for "${requestedLanguage}"`,
      404,
    );

  const { language, zipUrl } = resolved;
  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(zipUrl);
  const candidates = buildTwPathCandidates(safePath);

  let article: string | null = null;
  let resolvedPath = "";
  for (const c of candidates) {
    article = await fetcher.extractFileFromZip(zip, c);
    if (article) {
      resolvedPath = c;
      break;
    }
  }

  if (!article) {
    return apiError(
      "NOT_FOUND",
      `Translation Word not found at path: "${safePath}"`,
      404,
    );
  }

  return json({ language, requestedLanguage, path: resolvedPath, article });
}
