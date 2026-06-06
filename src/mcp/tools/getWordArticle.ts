/**
 * get_word_article — Step 3 (study/drill) for Translation Words articles.
 *
 * Fetches the full Markdown body of a Translation Words dictionary article.
 * TW articles define biblical key terms (God, covenant, grace, righteousness…)
 * with information about meaning, usage, and translation suggestions.
 *
 * The `path` comes from:
 *   - `get_passage_index` words[].twArticle.path
 *   - `search_articles` results[].path (when resourceType === "tw")
 *
 * BEFORE: call `get_passage_index` (or `search_articles`).
 * AFTER:  call `get_questions` to verify a draft.
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
      'The TW article path from `get_passage_index` words[].twArticle.path or `search_articles`. ' +
      'Examples: "bible/kt/god", "bible/kt/covenant", "bible/other/king", "bible/names/paul".',
    ),
  language: languageParam,
});

export type GetWordArticleParams = z.infer<typeof inputSchema>;

export const getWordArticleTool: ToolModule<typeof inputSchema> = {
  name: "get_word_article",
  description:
    "STEP 3 (study/drill): Fetch the full text of a Translation Words article (key term dictionary entry) by path. " +
    "TW articles define what a biblical term means, how it is used, and how to translate it. " +
    "Get the `path` from `get_passage_index` words[].twArticle.path or from `search_articles`. " +
    "BEFORE: call `get_passage_index` (survey step). " +
    "AFTER: call `get_questions` to verify a draft.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Get Word Article" },

  async handler(params: GetWordArticleParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { path, language } = params;

    const data = await client.get<{
      path: string;
      language: string;
      article: string;
    }>(`/api/v1/words/${path}`, { language });

    const slug = path.split("/").pop() ?? path;
    return ok(data, `Word article: ${slug}`);
  },
};
