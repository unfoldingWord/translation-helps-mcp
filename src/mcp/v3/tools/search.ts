/**
 * v3 th_search — find an article by concept when there is no passage.
 *
 * Ranking stays on GET /api/v1/search (T-050). This tool reports
 * resourceType as type and points next at th_get_article.
 */

import { z } from "zod";
import type { ArticleSearchResult } from "@translation-helps/door43";
import { ApiClient } from "../../apiClient.js";
import type { Env } from "../../agent.js";
import { ok, withNotAvailableOutput } from "../../tools/shared.js";
import { v3LanguageParam } from "../params.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'A concept or title, such as "metaphor" or "covenant". Pass the matching path to th_get_article.',
    ),
  language: v3LanguageParam,
  type: z
    .enum(["tw", "ta"])
    .optional()
    .describe(
      'Limit the search to "tw" (key terms) or "ta" (translation principles). Omit it to search both.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(10)
    .describe("Maximum results. Default 10."),
});

export const SEARCH_DESCRIPTION =
  'Finds Translation Words and Translation Academy articles by concept or title when you have no passage and no exact term, e.g. "abstract nouns", "metaphor", "kingdom of God". Results are ranked: exact titles and alternate names first, then titles that start with or contain the query. Each result has a path, and next for th_get_article. type limits the search to tw (key terms) or ta (translation principles). It searches article titles, not notes or Bible text. An empty list means nothing matched.';

const outputSchema = withNotAvailableOutput({
  query: z.string().optional(),
  language: z.string().optional(),
  results: z
    .array(
      z.object({
        path: z.string(),
        type: z.enum(["tw", "ta"]),
        title: z.string(),
        score: z.number(),
        next: z.object({
          tool: z.literal("th_get_article"),
          args: z.object({
            path: z.string(),
            language: z.string().optional(),
          }),
        }),
      }),
    )
    .optional(),
});

function asType(value: unknown): "tw" | "ta" | undefined {
  return value === "tw" || value === "ta" ? value : undefined;
}

export const searchV3Tool = {
  name: "th_search",
  description: SEARCH_DESCRIPTION,
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    title: "Search Articles",
  },

  async handler(
    params: z.input<typeof inputSchema>,
    env: Env,
    _requestId: string,
  ) {
    const language = params.language || "en";
    const limit = params.limit ?? 10;
    const client = new ApiClient(env);
    const data = await client.get<{
      language?: string;
      results?: ArticleSearchResult[];
    }>("/api/v1/search", {
      q: params.query,
      language,
      limit,
      types: params.type,
    });
    const catalogLanguage = data.language || language;
    const wanted = params.type;
    const results = (data.results ?? []).flatMap((item) => {
      const type = asType(item.resourceType);
      if (!type) return [];
      if (wanted && type !== wanted) return [];
      return [
        {
          path: item.path,
          type,
          title: item.title,
          score: item.score,
          next: {
            tool: "th_get_article" as const,
            args: {
              path: item.path,
              ...(catalogLanguage === "en"
                ? {}
                : { language: catalogLanguage }),
            },
          },
        },
      ];
    });
    return ok(
      { query: params.query, language: catalogLanguage, results },
      `${results.length} article(s) for "${params.query}"`,
    );
  },
};
