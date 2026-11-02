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
import { TranslationHelpsError } from "../../core/errors.js";
import {
  prepareArticlePath,
  resolveTaArticle,
} from "../../core/articleResolve.js";
import { loadTaCatalog } from "./articleCatalog.js";
import { jsonArticleMatch } from "./articleResponse.js";

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

  let prepared: string;
  try {
    prepared = prepareArticlePath(pathParam);
  } catch (error) {
    if (error instanceof TranslationHelpsError) {
      return apiError("INVALID_PARAMS", error.message, 400);
    }
    throw error;
  }

  const requestedPath = (
    url.searchParams.get("requestedPath") ?? pathParam
  ).slice(0, 512);

  const catalog = await loadTaCatalog(requestedLanguage, env, execCtx);
  if (!catalog)
    return apiError(
      "NOT_FOUND",
      `Translation Academy not found for "${requestedLanguage}"`,
      404,
    );

  const match = resolveTaArticle(prepared, catalog.articles);
  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(catalog.zipUrl);
  let article: string | null = null;
  if (match.status === "exact" || match.status === "resolved") {
    article =
      (await fetcher.extractFileFromZip(zip, `${match.path}/01.md`)) ??
      (await fetcher.extractFileFromZip(zip, `${match.path}.md`)) ??
      (await fetcher.extractFileFromZip(zip, match.path));
  }
  const titles = new Map(
    catalog.articles.map((item) => [item.path, item.title]),
  );

  return jsonArticleMatch({
    kind: "ta",
    language: catalog.language,
    requestedLanguage,
    requestedPath,
    match,
    article,
    titleOf: (path) => titles.get(path),
  });
}
