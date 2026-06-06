/**
 * get_academy_article — Step 3 (study/drill) for Translation Academy articles.
 *
 * Fetches the full Markdown body of a Translation Academy article.
 * TA articles explain translation principles (e.g., metaphor, abstract nouns,
 * implicit information) and checking procedures.
 *
 * The `path` comes from:
 *   - `get_passage_index` notes[].taArticle.path
 *   - `search_articles` results[].path (when resourceType === "ta")
 *
 * BEFORE: call `get_passage_index` (or `search_articles`).
 * AFTER:  call `get_questions` to verify a draft, or `get_word_article` for key terms.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'The TA article path from `get_passage_index` notes[].taArticle.path or `search_articles`. ' +
      'Examples: "translate/figs-metaphor", "translate/translate-unknown", "checking/accuracy-check".',
    ),
  language: languageParam,
});

export type GetAcademyArticleParams = z.infer<typeof inputSchema>;

export const getAcademyArticleTool: ToolModule<typeof inputSchema> = {
  name: "get_academy_article",
  description:
    "STEP 3 (study/drill): Fetch the full text of a Translation Academy article by path. " +
    "TA articles explain HOW to translate: figurative language, implicit information, cultural concepts, grammar, checking procedures. " +
    "Get the `path` from `get_passage_index` notes[].taArticle.path or from `search_articles`. " +
    "BEFORE: call `get_passage_index` (survey step). " +
    "AFTER: call `get_questions` to verify a draft.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Get Academy Article" },

  async handler(params: GetAcademyArticleParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { path, language } = params;

    const data = await client.get<{
      path: string;
      language: string;
      article: string;
    }>(`/api/v1/academy/${path}`, { language });

    // Derive a display title from the path (e.g. "translate/figs-metaphor" → "figs-metaphor")
    const slug = path.split("/").pop() ?? path;
    return ok(data, `Academy article: ${slug}`);
  },
};
