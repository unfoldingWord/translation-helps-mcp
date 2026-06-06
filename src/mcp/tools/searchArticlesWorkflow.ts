/**
 * search_articles — lateral discovery tool (any step).
 *
 * Finds Translation Academy (TA) and Translation Words (TW) articles by keyword
 * or concept. Use when you know the CONCEPT but not the article path, or when
 * an article is not directly linked to the current passage.
 *
 * Returns `{ path, title, resourceType, score }[]` sorted by relevance.
 * Pass `path` to `get_academy_article` (resourceType:"ta") or
 * `get_word_article` (resourceType:"tw") to retrieve the full body.
 *
 * This is a lateral entry to the drill step — it answers "find the article
 * about THIS CONCEPT" even when that article is not flagged in the index.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import type { ArticleSearchResult } from "../../core/contracts/index.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Search term or concept. E.g. "abstract nouns", "metaphor", "covenant", "grace", "righteousness". ' +
      'Returns the most relevant TA and TW articles. Pass `path` to `get_academy_article` or `get_word_article`.',
    ),
  language: languageParam,
  limit: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(10)
    .describe("Maximum number of results (default 10)."),
  types: z
    .string()
    .optional()
    .describe('Comma-separated resource types to include: "ta", "tw", or "ta,tw" (default all).'),
});

export type SearchArticlesWorkflowParams = z.infer<typeof inputSchema>;

export const searchArticlesWorkflowTool: ToolModule<typeof inputSchema> = {
  name: "search_articles",
  description:
    "LATERAL: Find Translation Academy or Translation Words articles by concept or keyword. " +
    "Use this to locate an article when you know the concept (e.g. 'metaphor', 'abstract nouns', 'covenant') but not the path, " +
    "or when no article is linked to the current passage. " +
    "Returns `{ path, title, resourceType }[]` sorted by relevance. " +
    "Pass `path` to `get_academy_article` (resourceType:\"ta\") or `get_word_article` (resourceType:\"tw\").",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Search Articles" },

  async handler(params: SearchArticlesWorkflowParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { query, language, limit, types } = params;

    const data = await client.get<{ results: ArticleSearchResult[] }>("/api/v1/search", {
      q: query,
      language,
      limit,
      types,
    });

    const results = data.results ?? [];
    return ok(
      { query, language, results },
      `${results.length} result(s) for "${query}"`,
    );
  },
};
