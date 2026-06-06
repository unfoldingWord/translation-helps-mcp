/**
 * list_translation_academy — enumerate all Translation Academy articles.
 *
 * Derives article slugs from zip entry names matching the "<slug>/01.md" pattern
 * (e.g. "en_ta/translate/figs-metonymy/01.md" -> path "translate/figs-metonymy").
 * Titles come from the companion title.md file in each article directory.
 * Results are KV-cached keyed by language + version tag.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { Errors } from "../../core/errors.js";
import { getResourceZipUrl } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import type { AcademyArticle } from "../../core/contracts/index.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  language: languageParam,
  category: z
    .string()
    .optional()
    .describe(
      'Filter by top-level category, e.g. "translate", "checking". Returns all categories if omitted.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(9999)
    .default(50)
    .describe("Maximum number of results to return (default 50). Pass a high value to get all."),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination (default 0)."),
});

export type ListTranslationAcademyParams = z.infer<typeof inputSchema>;

// Re-exported from contracts so importers don't need to change their import path.
export type { AcademyArticle } from "../../core/contracts/index.js";

const outputSchema = {
  language: z.string(),
  total_count: z.number().describe("Total number of matching articles before pagination."),
  has_more: z.boolean(),
  limit: z.number(),
  offset: z.number(),
  articles: z.array(
    z.object({
      path: z.string().describe('Article path, e.g. "translate/figs-metonymy"'),
      title: z.string().describe("Article title"),
      category: z.string().describe('Top-level category, e.g. "translate"'),
    }),
  ),
  requestId: z.string(),
};

const CATALOG_CACHE_TTL = 86400; // 24 h — articles change only on resource version bumps

export const listTranslationAcademyTool: ToolModule<typeof inputSchema> = {
  name: "list_translation_academy",
  description:
    "List Translation Academy (TA) articles with their paths and titles. " +
    "Use this to browse available articles by category or to help choose the right article for a translation topic. " +
    "Returns `{ path, title, category }` entries; pass `path` to fetch_translation_academy to retrieve the full content. " +
    "Limitation: the full catalog is large (200+ articles); prefer search_articles with a concept query to find a specific article. Use `category` to narrow results (e.g. \"translate\" or \"checking\").",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "List Translation Academy Articles" },

  async handler(params: ListTranslationAcademyParams, env: Env, requestId: string) {
    const { language, category, limit, offset } = params;

    // Try KV cache first (cache stores the full unsliced list)
    const cacheKey = `catalog:ta:${language}${category ? `:${category}` : ""}`;
    if (env.TRANSLATION_HELPS_CACHE) {
      const cached = await env.TRANSLATION_HELPS_CACHE.get(cacheKey).catch(() => null);
      if (cached) {
        const allArticles = JSON.parse(cached) as AcademyArticle[];
        const total_count = allArticles.length;
        const articles = allArticles.slice(offset, offset + limit);
        const has_more = offset + limit < total_count;
        return ok(
          { language, total_count, has_more, limit, offset, articles, requestId },
          `${articles.length} of ${total_count} TA articles (cached)`,
        );
      }
    }

    const resolved = await getResourceZipUrl(
      language,
      "Translation Academy",
      "unfoldingWord",
      "prod",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (!resolved) throw Errors.resourceNotFound(`Translation Academy for "${language}"`);

    const fetcher = new ZipResourceFetcher2({ KV: env.TRANSLATION_HELPS_CACHE, R2: env.ZIP_FILES });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);
    const entries = fetcher.listZipEntries(zipBuffer);

    // TA zip layout: <repo>/<category>/<slug>/01.md and <repo>/<category>/<slug>/title.md
    // Collect unique article paths from entries ending in "/01.md"
    const articlePaths = new Set<string>();
    for (const entry of entries) {
      if (entry.endsWith("/01.md")) {
        // Strip leading repo dir and trailing /01.md
        // e.g. "en_ta-v10/translate/figs-metonymy/01.md" → "translate/figs-metonymy"
        const parts = entry.split("/");
        if (parts.length >= 3) {
          const slug = parts.slice(1, -1).join("/"); // strip repo prefix and /01.md
          articlePaths.add(slug);
        }
      }
    }

    // Build articles with titles (read title.md asynchronously, falling back to slug)
    const articles: AcademyArticle[] = [];
    const titleFetches = Array.from(articlePaths).map(async (slug) => {
      const articleCategory = slug.split("/")[0] ?? slug;
      if (category && articleCategory !== category) return;

      const titleMd = await fetcher.extractFileFromZip(zipBuffer, `${slug}/title.md`);
      const title = titleMd
        ? titleMd.trim().replace(/^#+\s*/, "")
        : slug.split("/").pop() ?? slug;

      articles.push({ path: slug, title, category: articleCategory });
    });
    await Promise.all(titleFetches);

    // Sort by path for stable output
    articles.sort((a, b) => a.path.localeCompare(b.path));

    // Persist to KV
    if (env.TRANSLATION_HELPS_CACHE) {
      env.TRANSLATION_HELPS_CACHE.put(
        cacheKey,
        JSON.stringify(articles),
        { expirationTtl: CATALOG_CACHE_TTL },
      ).catch(() => {});
    }

    const total_count = articles.length;
    const page = articles.slice(offset, offset + limit);
    const has_more = offset + limit < total_count;

    return ok(
      { language, total_count, has_more, limit, offset, articles: page, requestId },
      `${page.length} of ${total_count} Translation Academy articles for ${language}`,
    );
  },
};
