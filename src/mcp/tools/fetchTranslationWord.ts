/**
 * fetch_translation_word — get the dictionary article for a Translation Word.
 *
 * Accepts EITHER a `path` (preferred, e.g. "bible/kt/grace") OR a `term`
 * (e.g. "grace"). When only `term` is supplied we attempt a best-effort lookup.
 * If neither matches, an error is returned with a hint to use
 * fetch_translation_word_links first.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { Errors, TranslationHelpsError, ErrorCode } from "../../core/errors.js";
import { getResourceZipUrl } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import type { Env } from "../agent.js";

const inputSchema = z
  .object({
    path: z
      .string()
      .optional()
      .describe(
        'Preferred: the exact word path from fetch_translation_word_links, e.g. "bible/kt/grace" or "bible/other/sheep". ' +
          "This resolves unambiguously to a dictionary article.",
      ),
    term: z
      .string()
      .optional()
      .describe(
        'Fallback: a word or short phrase, e.g. "grace", "holy spirit". ' +
          "May be ambiguous — provide `path` when available.",
      ),
    language: languageParam,
    organization: z
      .string()
      .default("unfoldingWord")
      .describe("Organization on Door43."),
  })
  .refine((data) => data.path !== undefined || data.term !== undefined, {
    message:
      "Provide either path (preferred) or term. Use fetch_translation_word_links to get the path.",
  });

export type FetchTranslationWordParams = z.infer<typeof inputSchema>;

export const fetchTranslationWordTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_word",
  description:
    "Get the dictionary article for a specific Translation Word. " +
    'Provide `path` (e.g. "bible/kt/grace") from fetch_translation_word_links, ' +
    "or `term` as a fallback. Returns the full Markdown article.",
  inputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Word",
  },

  async handler(
    params: FetchTranslationWordParams,
    env: Env,
    requestId: string,
  ) {
    const { path: wordPath, term, language, organization } = params;

    const resolved = await getResourceZipUrl(
      language,
      "Translation Words",
      organization,
    );
    if (!resolved)
      throw Errors.resourceNotFound(`Translation Words for "${language}"`);

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    // Build candidate paths
    const candidates: string[] = [];
    if (wordPath) {
      // Normalise: strip leading "/" and "bible/" prefix variations
      const clean = wordPath.replace(/^\//, "").replace(/\.md$/, "");
      candidates.push(`${clean}.md`, clean, `${clean.toLowerCase()}.md`);
    }
    if (term) {
      const slug = term.toLowerCase().replace(/\s+/g, "");
      candidates.push(
        `bible/kt/${slug}.md`,
        `bible/other/${slug}.md`,
        `bible/names/${slug}.md`,
        `kt/${slug}.md`,
        `other/${slug}.md`,
        `names/${slug}.md`,
      );
    }

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
        message: `Translation Word not found: ${wordPath ?? term}`,
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
