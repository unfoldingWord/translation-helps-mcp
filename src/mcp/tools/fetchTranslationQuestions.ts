/**
 * fetch_translation_questions — comprehension questions for translators.
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
import { parseTranslationQuestionsTsv } from "../../core/parsers/tsv.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
});

export type FetchTranslationQuestionsParams = z.infer<typeof inputSchema>;

const outputSchema = {
  reference: z.string(),
  language: z.string(),
  book: z.string(),
  chapter: z.string(),
  verse: z.string().optional(),
  questions: z.array(
    z.object({
      book: z.string(),
      chapter: z.string(),
      verse: z.string(),
      id: z.string(),
      question: z.string(),
      response: z.string(),
    }),
  ),
  requestId: z.string(),
};

export const fetchTranslationQuestionsTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_questions",
  description:
    "Fetch comprehension questions (TQ) for a Bible passage. " +
    "Use these after a translator has produced a draft to verify their translation conveys the correct meaning — each question has an expected answer. " +
    "Returns an array of `{ question, response }` objects for the requested reference. " +
    "Limitation: TQ only exists for languages that have a published translation questions resource; check list_resources_for_language first if unsure.",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Questions",
  },

  async handler(
    params: FetchTranslationQuestionsParams,
    env: Env,
    requestId: string,
  ) {
    const { reference, language } = params;

    const parsed = parseReferenceForTool(reference);
    if (!parsed) throw Errors.invalidReference(reference);
    const { book, chapter, verseStart } = parsed;

    const resolved = await getResourceZipUrl(
      language,
      "TSV Translation Questions",
      "unfoldingWord",
      "prod",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (!resolved)
      throw Errors.resourceNotFound(`Translation Questions for "${language}"`);

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    const paths = [`tq_${book}.tsv`, `${book}.tsv`];
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
      throw Errors.resourceNotFound(`Translation Questions for book "${book}"`);

    const questions = parseTranslationQuestionsTsv(tsv, chapter, verseStart);
    return ok({
      reference,
      language,
      book,
      chapter,
      verse: verseStart,
      questions,
      requestId,
    });
  },
};

