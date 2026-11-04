/**
 * get_word_article — Step 3 (study/drill) for Translation Words articles.
 *
 * Fetches the full Markdown body of a Translation Words dictionary article.
 * TW articles define biblical key terms (God, covenant, grace, righteousness…)
 * with information about meaning, usage, and translation suggestions.
 *
 * The `path` comes from a term, a close guess, or:
 *   - `get_passage_index` words[].twArticle.path
 *   - `search_articles` results[].path (when resourceType === "tw")
 *
 * When studying a passage step by step, take the path from the index.
 * A direct question about a term calls this tool with the term.
 */

import { z } from "zod";
import {
  languageParam,
  ok,
  resourceSourceSchema,
  withNotAvailableOutput,
  type ToolModule,
} from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import {
  prepareArticlePath,
  RESOLVED_FROM,
} from "../../core/articleResolve.js";
import { presentArticle, type ArticlePayload } from "./articlePresent.js";

const articleCandidate = z.object({
  path: z.string(),
  title: z.string(),
});

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "Exact path is best (bible/kt/covenant). covenant, sheol, son of god, and bible/other/hades also work.",
    ),
  language: languageParam,
});

export type GetWordArticleParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  path: z.string().optional(),
  language: z.string().optional(),
  title: z.string().optional(),
  article: z.string().optional(),
  requestedPath: z.string().optional(),
  resolvedFrom: z.enum(RESOLVED_FROM).optional(),
  note: z.string().optional(),
  related: z.array(articleCandidate).optional(),
  candidates: z.array(articleCandidate).optional(),
  source: resourceSourceSchema,
});

export const getWordArticleTool: ToolModule<typeof inputSchema> = {
  name: "get_word_article",
  description:
    "Fetch a Translation Words article: what a biblical term means and how to translate it. " +
    "For a direct question about a term, pass the term. An exact path is best; covenant, sheol, son of god, and bible/other/hades also work and are resolved " +
    "(the answer includes path, requestedPath, and resolvedFrom). " +
    "Pass language as the user's language, not en, when they asked for another one. " +
    "When studying a passage step by step, take path from get_passage_index words[].twArticle.path or from search_articles. " +
    "Links in the article are paths this tool accepts (bible/kt/promise). rc://*/tn/help/... links are note references, not article paths. related[] lists the article links. " +
    "Several matches return candidates — call again with one path. Missing article: soft-fail RESOURCE_NOT_AVAILABLE (isError:false).",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Get Word Article" },

  async handler(params: GetWordArticleParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const requestedPath = params.path;
    const prepared = prepareArticlePath(requestedPath);
    const encodedPath = prepared.split("/").map(encodeURIComponent).join("/");
    const data = await client.get<ArticlePayload>(
      `/api/v1/words/${encodedPath}`,
      { language: params.language, requestedPath, prepared: "1" },
    );
    const presented = presentArticle(data, "tw", prepared);
    const slug =
      String(presented.path ?? prepared)
        .split("/")
        .pop() ?? prepared;
    return ok(presented, `Word article: ${slug}`);
  },
};
