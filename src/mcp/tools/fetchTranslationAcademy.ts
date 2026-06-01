/**
 * fetch_translation_academy — get a Translation Academy article.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { Errors, TranslationHelpsError, ErrorCode } from "../../core/errors.js";
import { getResourceZipUrl } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  path: z
    .string()
    .describe(
      'The article path within Translation Academy, e.g. "translate/figs-metaphor" or "checking/accuracy". ' +
        "Use rag_query to discover relevant articles if you do not know the path.",
    ),
  language: languageParam,
  organization: z
    .string()
    .default("unfoldingWord")
    .describe("Organization on Door43."),
});

export type FetchTranslationAcademyParams = z.infer<typeof inputSchema>;

export const fetchTranslationAcademyTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_academy",
  description:
    "Fetch a Translation Academy (TA) article by its path. " +
    "Articles cover translation principles, checking procedures, and linguistic topics. " +
    "Use rag_query to find relevant article paths if you do not know them.",
  inputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Academy Article",
  },

  async handler(
    params: FetchTranslationAcademyParams,
    env: Env,
    requestId: string,
  ) {
    const { path: articlePath, language, organization } = params;

    if (!articlePath || articlePath.trim().length < 3) {
      throw Errors.missingParam("path", "fetch_translation_academy");
    }

    const resolved = await getResourceZipUrl(
      language,
      "Translation Academy",
      organization,
    );
    if (!resolved)
      throw Errors.resourceNotFound(`Translation Academy for "${language}"`);

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    const clean = articlePath.replace(/^\//, "").replace(/\.md$/, "");
    const candidates = [
      `${clean}.md`,
      clean,
      `content/${clean}.md`,
      `content/${clean}/01.md`,
    ];

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
              'Use rag_query with query like "figures of speech" to discover article paths.',
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
