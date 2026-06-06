/**
 * fetch_translation_word_links — get the translation words that appear at a reference.
 * Use this FIRST to discover which word paths to pass to fetch_translation_word.
 */

import { z } from "zod";
import {
  referenceParam,
  languageParam,
  ok,
  type ToolModule,
} from "./shared.js";
import { Errors } from "../../core/errors.js";
import { getResourceZipUrl } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import { parseReferenceForTool } from "../../core/resources/referenceParser.js";
import { parseTranslationWordLinksTsv } from "../../core/parsers/tsv.js";
import type { TranslationWordLinkRow } from "../../core/contracts/index.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
});

export type FetchTranslationWordLinksParams = z.infer<typeof inputSchema>;

const outputSchema = {
  reference: z.string(),
  language: z.string(),
  book: z.string(),
  chapter: z.string(),
  verse: z.string().optional(),
  wordLinks: z.array(
    z.object({
      book: z.string(),
      chapter: z.string(),
      verse: z.string(),
      twId: z.string(),
      supportReference: z.string(),
      origWords: z.string(),
      occurrence: z.string(),
      twLink: z.string(),
      wordPath: z
        .string()
        .describe(
          'Pass this to fetch_translation_word as the `path` parameter, e.g. "bible/kt/grace".',
        ),
    }),
  ),
  requestId: z.string(),
};

export const fetchTranslationWordLinksTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_word_links",
  description:
    "List the Translation Word entries linked at a specific Bible reference. " +
    "Use this to discover which key biblical terms appear at a passage before fetching their definitions. " +
    'Returns an array of word link objects each containing a `wordPath` (e.g. "bible/kt/grace") — pass this path directly to fetch_translation_word. ' +
    "Also returns the original-language words (`origWords`) and the TWLink for traceability. " +
    "Limitation: only returns links explicitly tagged in the TWL resource; not every word in the verse will have a TW entry.",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Word Links",
  },

  async handler(
    params: FetchTranslationWordLinksParams,
    env: Env,
    requestId: string,
  ) {
    const { reference, language } = params;

    const parsed = parseReferenceForTool(reference);
    if (!parsed) throw Errors.invalidReference(reference);
    const { book, chapter, verseStart } = parsed;

    const resolved = await getResourceZipUrl(
      language,
      "TSV Translation Words Links",
      "unfoldingWord",
      "prod",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (!resolved)
      throw Errors.resourceNotFound(`Translation Word Links for "${language}"`);

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    const paths = [`twl_${book}.tsv`, `${book}.tsv`];
    for (const ing of resolved.entry.ingredients) {
      if (
        ing.identifier?.toUpperCase() === book ||
        ing.path?.toUpperCase().includes(book)
      ) {
        paths.unshift(ing.path.replace(/^\.\//, ""));
      }
    }

    let tsv: string | null = null;
    for (const path of paths) {
      tsv = await fetcher.extractFileFromZip(zipBuffer, path);
      if (tsv) break;
    }
    if (!tsv)
      throw Errors.resourceNotFound(`Word Links file for book "${book}"`);

    const links = parseTranslationWordLinksTsv(tsv, chapter, verseStart);
    return ok(
      {
        reference,
        language,
        book,
        chapter,
        verse: verseStart,
        wordLinks: links,
        requestId,
      },
      `${links.length} word links found at ${reference}`,
    );
  },
};

// Re-export the shared type so existing consumers still compile.
export type { TranslationWordLinkRow as WordLink };
