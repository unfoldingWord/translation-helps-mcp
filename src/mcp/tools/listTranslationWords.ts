/**
 * list_translation_words — enumerate all Translation Words articles.
 *
 * TW zip layout: bible/kt/<term>.md and bible/other/<term>.md
 * (plus a names/ category).  Titles come from the first # heading in
 * each article.  Results are KV-cached keyed by language + category.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { Errors } from "../../core/errors.js";
import { getResourceZipUrl } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import { extractTitleFromMarkdown } from "../../core/parsers/markdown.js";
import type { WordArticle } from "../../core/contracts/index.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  language: languageParam,
  category: z
    .enum(["kt", "other", "names"])
    .optional()
    .describe(
      '"kt" = key terms, "other" = other biblical terms, "names" = proper names. Returns all if omitted.',
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

export type ListTranslationWordsParams = z.infer<typeof inputSchema>;

// Re-exported from contracts so importers don't need to change their import path.
export type { WordArticle } from "../../core/contracts/index.js";

const outputSchema = {
  language: z.string(),
  total_count: z.number().describe("Total number of matching articles before pagination."),
  has_more: z.boolean(),
  limit: z.number(),
  offset: z.number(),
  articles: z.array(
    z.object({
      path: z.string().describe('Word path, e.g. "bible/kt/grace"'),
      title: z.string().describe("Article title"),
      category: z.string().describe('"kt", "other", or "names"'),
    }),
  ),
  requestId: z.string(),
};

const CATALOG_CACHE_TTL = 86400; // 24 h

const VALID_CATEGORIES = new Set(["kt", "other", "names"]);

export const listTranslationWordsTool: ToolModule<typeof inputSchema> = {
  name: "list_translation_words",
  description:
    "List Translation Words (TW) articles with their paths and titles. " +
    "Use this to browse key terms by category (kt / other / names) or to discover the exact path for a term before fetching its article. " +
    "Returns `{ path, title, category }` entries; pass `path` to fetch_translation_word to retrieve the full article. " +
    "Limitation: the full catalog is large (500+ terms); prefer search_articles with a concept query to find a specific term. Use the `category` parameter to narrow results.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "List Translation Words Articles" },

  async handler(params: ListTranslationWordsParams, env: Env, requestId: string) {
    const { language, category, limit, offset } = params;

    const cacheKey = `catalog:tw:${language}${category ? `:${category}` : ""}`;
    if (env.TRANSLATION_HELPS_CACHE) {
      const cached = await env.TRANSLATION_HELPS_CACHE.get(cacheKey).catch(() => null);
      if (cached) {
        const allArticles = JSON.parse(cached) as WordArticle[];
        const total_count = allArticles.length;
        const articles = allArticles.slice(offset, offset + limit);
        const has_more = offset + limit < total_count;
        return ok(
          { language, total_count, has_more, limit, offset, articles, requestId },
          `${articles.length} of ${total_count} TW articles (cached)`,
        );
      }
    }

    const resolved = await getResourceZipUrl(
      language,
      "Translation Words",
      "unfoldingWord",
      "prod",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (!resolved) throw Errors.resourceNotFound(`Translation Words for "${language}"`);

    const fetcher = new ZipResourceFetcher2({ KV: env.TRANSLATION_HELPS_CACHE, R2: env.ZIP_FILES });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);
    const entries = fetcher.listZipEntries(zipBuffer);

    // TW layout: <repo>/bible/<category>/<term>.md
    const articlePaths: Array<{ slug: string; cat: string }> = [];
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const parts = entry.split("/");
      // Expect at least: <repo>/bible/<cat>/<term>.md → 4 parts
      const bibleIdx = parts.indexOf("bible");
      if (bibleIdx === -1 || bibleIdx + 2 >= parts.length) continue;
      const cat = parts[bibleIdx + 1];
      if (!cat || !VALID_CATEGORIES.has(cat)) continue;
      if (category && cat !== category) continue;
      const term = parts[parts.length - 1].replace(/\.md$/, "");
      if (!term) continue;
      articlePaths.push({ slug: `bible/${cat}/${term}`, cat });
    }

    // Fetch titles from article content in parallel (batched to avoid overwhelming Workers)
    const BATCH = 50;
    const articles: WordArticle[] = [];

    for (let i = 0; i < articlePaths.length; i += BATCH) {
      const batch = articlePaths.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async ({ slug, cat }) => {
          const content = await fetcher.extractFileFromZip(zipBuffer, `${slug}.md`);
          const title = content ? extractTitleFromMarkdown(content) : slug.split("/").pop() ?? slug;
          return {
            path: slug,
            title: title || (slug.split("/").pop() ?? slug),
            category: cat as "kt" | "other" | "names",
          };
        }),
      );
      articles.push(...results);
    }

    articles.sort((a, b) => a.path.localeCompare(b.path));

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
      `${page.length} of ${total_count} Translation Words articles for ${language}`,
    );
  },
};
