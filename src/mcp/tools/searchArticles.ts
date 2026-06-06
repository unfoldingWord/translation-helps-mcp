/**
 * search_articles — lexical search over the Translation Academy and
 * Translation Words catalogs.
 *
 * Scores each article by term-frequency over title + slug + category,
 * optionally boosting exact slug/title matches.  No embeddings required.
 *
 * This replaces rag_query as the article-discovery primitive.
 * After getting a path from search_articles, call fetch_translation_academy
 * or fetch_translation_word to retrieve the full article.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import type { Env } from "../agent.js";
import { listTranslationAcademyTool } from "./listTranslationAcademy.js";
import { listTranslationWordsTool } from "./listTranslationWords.js";
import { scoreArticle } from "../../core/parsers/articleSearch.js";
import type { AcademyArticle } from "../../core/contracts/index.js";
import type { WordArticle } from "../../core/contracts/index.js";
import type { ArticleSearchResult } from "../../core/contracts/index.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe(
      'Natural language concept or phrase to search for, e.g. "metonymy", ' +
        '"figurative language", "how to translate idioms", "grace".',
    ),
  language: languageParam,
  resourceTypes: z
    .array(z.enum(["ta", "tw"]))
    .default(["ta", "tw"])
    .describe('"ta" = Translation Academy articles, "tw" = Translation Words.'),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of results to return (1–20, default 5)."),
});

export type SearchArticlesParams = z.infer<typeof inputSchema>;

// Re-exported from contracts for backward-compat (existing importers still work)
export type { ArticleSearchResult };

const outputSchema = {
  query: z.string(),
  language: z.string(),
  results: z.array(
    z.object({
      path: z.string(),
      title: z.string(),
      resourceType: z.enum(["ta", "tw"]),
      score: z.number(),
    }),
  ),
  requestId: z.string(),
};

export const searchArticlesTool: ToolModule<typeof inputSchema> = {
  name: "search_articles",
  description:
    "Lexical search over Translation Academy and Translation Words catalogs. " +
    "Use this to find relevant articles by concept, phrase, or translation topic " +
    "when you do not already have a specific article path. " +
    "Returns ranked paths you can pass to fetch_translation_academy or fetch_translation_word.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Search Articles" },

  async handler(params: SearchArticlesParams, env: Env, requestId: string) {
    const { query, language, resourceTypes, topK } = params;

    const candidates: Array<{ path: string; title: string; category: string; resourceType: "ta" | "tw" }> = [];

    // Gather TA articles — pass a high limit to get the full catalog
    if (resourceTypes.includes("ta")) {
      const taResult = await listTranslationAcademyTool.handler(
        { language, limit: 9999, offset: 0 },
        env,
        requestId,
      );
      const data = (taResult.structuredContent ?? {}) as { articles?: AcademyArticle[] };
      for (const a of data.articles ?? []) {
        candidates.push({ path: a.path, title: a.title, category: a.category, resourceType: "ta" });
      }
    }

    // Gather TW articles — pass a high limit to get the full catalog
    if (resourceTypes.includes("tw")) {
      const twResult = await listTranslationWordsTool.handler(
        { language, limit: 9999, offset: 0 },
        env,
        requestId,
      );
      const data = (twResult.structuredContent ?? {}) as { articles?: WordArticle[] };
      for (const a of data.articles ?? []) {
        candidates.push({ path: a.path, title: a.title, category: a.category, resourceType: "tw" });
      }
    }

    // Score and rank
    const scored: ArticleSearchResult[] = candidates
      .map((c) => ({
        path: c.path,
        title: c.title,
        resourceType: c.resourceType,
        score: scoreArticle(query, c.path, c.title, c.category),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return ok(
      { query, language, results: scored, requestId },
      `${scored.length} articles found for: ${query}`,
    );
  },
};
