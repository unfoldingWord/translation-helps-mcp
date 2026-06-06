/**
 * fetch_translation_academy — get a Translation Academy article.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { Errors, TranslationHelpsError, ErrorCode } from "../../core/errors.js";
import { getResourceZipUrl } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import { buildTaPathCandidates } from "../../core/parsers/markdown.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  path: z
    .string()
    .describe(
      'The article path within Translation Academy, e.g. "translate/figs-metaphor" or "checking/accuracy". ' +
        "Use search_articles to discover relevant articles if you do not know the path.",
    ),
  language: languageParam,
});

export type FetchTranslationAcademyParams = z.infer<typeof inputSchema>;

const outputSchema = {
  language: z.string(),
  path: z.string().describe("Resolved path of the article in the zip."),
  article: z.string().describe("Full Markdown content of the Translation Academy article."),
  requestId: z.string(),
};

export const fetchTranslationAcademyTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_academy",
  description:
    "Fetch a Translation Academy (TA) article by its path. " +
    "TA articles teach translation principles (figures of speech, grammar patterns, cultural topics) and checking procedures. " +
    "Use this when a translation note's `supportReference` points to a TA article, or when you want to explain a translation principle to a translator. " +
    "Returns the full Markdown article text. " +
    "Limitation: you must know the exact path; use search_articles or list_translation_academy to discover paths if you do not know them.",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Academy Article",
  },

  async handler(
    params: FetchTranslationAcademyParams,
    env: Env,
    requestId: string,
  ) {
    const { path: articlePath, language } = params;

    if (!articlePath || articlePath.trim().length < 3) {
      throw Errors.missingParam("path", "fetch_translation_academy");
    }

    const resolved = await getResourceZipUrl(
      language,
      "Translation Academy",
      "unfoldingWord",
      "prod",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (!resolved)
      throw Errors.resourceNotFound(`Translation Academy for "${language}"`);

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    const candidates = buildTaPathCandidates(articlePath);

    let article: string | null = null;
    let resolvedPath = "";
    for (const c of candidates) {
      article = await fetcher.extractFileFromZip(zipBuffer, c);
      if (article) {
        resolvedPath = c;
        break;
      }
    }

    if (!article) {
      throw new TranslationHelpsError({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: `Translation Academy article not found: "${articlePath}"`,
        hints: [
          {
            message:
              'Use search_articles with query like "figures of speech" to discover article paths.',
          },
          {
            message:
              'Example paths: "translate/figs-metaphor", "translate/translate-names".',
          },
        ],
      });
    }

    return ok(
      { language, path: resolvedPath, article, requestId },
      `Translation Academy: ${resolvedPath}`,
    );
  },
};
