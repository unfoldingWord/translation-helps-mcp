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
import {
  languageParam,
  ok,
  withNotAvailableOutput,
  type ToolModule,
} from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import { assertSafeArticlePath } from "../../core/articlePath.js";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "The TW article path from `get_passage_index` words[].twArticle.path or `search_articles`. " +
        'Examples: "bible/kt/god", "bible/kt/covenant", "bible/other/king", "bible/names/paul".',
    ),
  language: languageParam,
});

export type GetWordArticleParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  path: z.string().optional(),
  language: z.string().optional(),
  title: z.string().optional(),
  article: z.string().optional(),
});

export const getWordArticleTool: ToolModule<typeof inputSchema> = {
  name: "get_word_article",
  description:
    "STEP 3 (study/drill): Fetch the full text of a Translation Words article (key term dictionary entry) by path. " +
    "TW articles define what a biblical term means, how it is used, and how to translate it. " +
    "Get the `path` from `get_passage_index` words[].twArticle.path or from `search_articles`. " +
    "Always pass `language` as the user's resource language (e.g. hi for Hindi) — " +
    "do not default to en when they asked for another language; many GLs have their own TW on Door43. " +
    "BEFORE: call `get_passage_index` (survey step). " +
    "AFTER: call `get_questions` to verify a draft. " +
    "Missing article/path: soft-fail with RESOURCE_NOT_AVAILABLE (isError:false).",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Get Word Article" },

  async handler(params: GetWordArticleParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const path = assertSafeArticlePath(params.path);
    const { language } = params;

    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const data = await client.get<{
      path: string;
      language: string;
      article: string;
    }>(`/api/v1/words/${encodedPath}`, { language });

    const slug = path.split("/").pop() ?? path;
    return ok(data, `Word article: ${slug}`);
  },
};
