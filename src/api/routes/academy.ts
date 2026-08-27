/**
 * GET /api/v1/academy?language=&category=   — list articles
 * GET /api/v1/academy/{path}?language=      — fetch single article
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { makeFetcher, resolveResourceZip } from "./helpers.js";
import {
  parseTaArticlePathsFromZipEntries,
  buildTaArticle,
} from "@translation-helps/door43";
import { buildTaPathCandidates } from "@translation-helps/door43";
import { sanitizeArticlePath } from "../../core/articlePath.js";

export async function handleAcademy(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;
  const requestedLanguage = url.searchParams.get("language");
  if (!requestedLanguage)
    return apiError("BAD_REQUEST", "Missing required param: language", 400);
  const category = url.searchParams.get("category") ?? undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "9999", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const resolved = await resolveResourceZip(
    requestedLanguage,
    "Translation Academy",
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
  const cacheKey = `catalog:ta:${language}${category ? `:${category}` : ""}`;
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

  const slugs = parseTaArticlePathsFromZipEntries(entries);
  const filtered = category
    ? slugs.filter((s) => s.startsWith(`${category}/`))
    : slugs;

  const articles = await Promise.all(
    filtered.map(async (slug) => {
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

  const page = articles.slice(offset, offset + limit);
  return json({
    language,
    requestedLanguage,
    total_count: articles.length,
    articles: page,
    has_more: offset + limit < articles.length,
  });
}

export async function handleAcademyPath(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx, pathParam } = ctx;
  const requestedLanguage = url.searchParams.get("language");
  if (!requestedLanguage)
    return apiError("BAD_REQUEST", "Missing required param: language", 400);
  if (!pathParam) return apiError("BAD_REQUEST", "Missing article path", 400);

  const pathCheck = sanitizeArticlePath(pathParam);
  if (!pathCheck.ok) {
    return apiError("INVALID_PARAMS", pathCheck.error.message, 400);
  }
  const safePath = pathCheck.path;

  const resolved = await resolveResourceZip(
    requestedLanguage,
    "Translation Academy",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved)
    return apiError(
      "NOT_FOUND",
      `Translation Academy not found for "${requestedLanguage}"`,
      404,
    );

  const { language, zipUrl } = resolved;
  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(zipUrl);
  const candidates = buildTaPathCandidates(safePath);

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
      `Translation Academy article not found: "${safePath}"`,
      404,
    );
  }

  return json({ language, requestedLanguage, path: resolvedPath, article });
}
