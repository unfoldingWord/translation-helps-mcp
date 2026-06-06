/**
 * fetch_translation_word — get the dictionary article for a Translation Word.
 *
 * Requires a `path` (e.g. "bible/kt/grace") obtained from fetch_translation_word_links.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { Errors, TranslationHelpsError, ErrorCode } from "../../core/errors.js";
import { getResourceZipUrl } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import { buildTwPathCandidates } from "../../core/parsers/markdown.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  path: z
    .string()
    .describe(
      'Word path from fetch_translation_word_links, e.g. "bible/kt/grace" or "bible/other/sheep". ' +
        "Use fetch_translation_word_links to get this path for a given Bible reference.",
    ),
  language: languageParam,
});

export type FetchTranslationWordParams = z.infer<typeof inputSchema>;

const outputSchema = {
  language: z.string(),
  path: z.string().describe("Resolved path used for the lookup."),
  article: z.string().describe("Full Markdown content of the dictionary article."),
  requestId: z.string(),
};

export const fetchTranslationWordTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_word",
  description:
    "Get the dictionary article for a specific Translation Word (TW). " +
    "Use this to explain the meaning, significance, and translation guidance for a biblical key term. " +
    "Requires a `path` obtained from fetch_translation_word_links or list_translation_words. " +
    "Returns the full Markdown article including definition, translation suggestions, and Bible examples. " +
    "Limitation: if you do not have the path, call fetch_translation_word_links for a reference or search_articles for a concept.",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Word",
  },

  async handler(
    params: FetchTranslationWordParams,
    env: Env,
    requestId: string,
  ) {
    const { path: wordPath, language } = params;

    const resolved = await getResourceZipUrl(
      language,
      "Translation Words",
      "unfoldingWord",
      "prod",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (!resolved)
      throw Errors.resourceNotFound(`Translation Words for "${language}"`);

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    const candidates = buildTwPathCandidates(wordPath);

    let article: string | null = null;
    let resolvedPath = "";
    for (const candidate of candidates) {
      article = await fetcher.extractFileFromZip(zipBuffer, candidate);
      if (article) {
        resolvedPath = candidate;
        break;
      }
    }

    if (!article) {
      throw new TranslationHelpsError({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: `Translation Word not found at path: "${wordPath}"`,
        hints: [
          {
            message:
              "Use fetch_translation_word_links to get the exact path for your reference.",
          },
          {
            message: `Example path format: "bible/kt/grace", "bible/other/sheep"`,
          },
        ],
      });
    }

    return ok(
      { language, path: resolvedPath, article, requestId },
      `Translation Word article: ${resolvedPath}`,
    );
  },
};
