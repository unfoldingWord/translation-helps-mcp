/**
 * get_academy_article — Step 3 (study/drill) for Translation Academy articles.
 *
 * Fetches the full Markdown body of a Translation Academy article.
 * TA articles explain translation principles (e.g., metaphor, abstract nouns,
 * implicit information) and checking procedures.
 *
 * The `path` comes from a term, a close guess, or:
 *   - `get_note` / `get_passage_index` notes[].taArticle.path
 *   - `search_articles` results[].path (when resourceType === "ta")
 *
 * When studying a passage step by step, take the path from the index or the note.
 * A direct question about a translation concept calls this tool with the term.
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
      "Exact path is best (translate/figs-metaphor). figs-metaphor, metaphor, and rc://*/ta/man/translate/figs-metaphor also work.",
    ),
  language: languageParam,
});

export type GetAcademyArticleParams = z.infer<typeof inputSchema>;

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
});

export const getAcademyArticleTool: ToolModule<typeof inputSchema> = {
  name: "get_academy_article",
  description:
    "Fetch a Translation Academy article: how to translate a figure, a grammar point, or a checking step. " +
    "For a direct question about a translation concept, pass the term or call search_articles. An exact path is best; figs-metaphor and metaphor also work and are resolved " +
    "(the answer includes path, requestedPath, and resolvedFrom). " +
    "Pass language as the user's language, not en, when they asked for another one. " +
    "When studying a passage step by step, take path from get_note or get_passage_index notes[].taArticle.path. " +
    "Links in the article are paths this tool accepts (translate/figs-simile). rc://*/tn/help/... links are note references, not article paths. related[] lists the article links. " +
    "Several matches return candidates — call again with one path. Missing article: soft-fail RESOURCE_NOT_AVAILABLE (isError:false).",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Get Academy Article" },

  async handler(params: GetAcademyArticleParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const requestedPath = params.path;
    const prepared = prepareArticlePath(requestedPath);
    const encodedPath = prepared.split("/").map(encodeURIComponent).join("/");
    const data = await client.get<ArticlePayload>(
      `/api/v1/academy/${encodedPath}`,
      { language: params.language, requestedPath },
    );
    const presented = presentArticle(data, "ta", prepared);
    const slug =
      String(presented.path ?? prepared)
        .split("/")
        .pop() ?? prepared;
    return ok(presented, `Academy article: ${slug}`);
  },
};
