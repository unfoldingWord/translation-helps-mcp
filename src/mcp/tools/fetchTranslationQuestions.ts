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
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
  organization: z
    .string()
    .default("unfoldingWord")
    .describe("Organization on Door43."),
});

export type FetchTranslationQuestionsParams = z.infer<typeof inputSchema>;

export const fetchTranslationQuestionsTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_questions",
  description:
    "Fetch comprehension questions (TQ) for a Bible passage. These help translators verify their translation conveys the correct meaning.",
  inputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Questions",
  },

  async handler(
    params: FetchTranslationQuestionsParams,
    env: Env,
    requestId: string,
  ) {
    const { reference, language, organization } = params;

    const refMatch = reference.match(
      /^([1-3]?[A-Za-z]{2,4})\s+(\d+)(?::(\d+)(?:-(\d+))?)?/,
    );
    if (!refMatch) throw Errors.invalidReference(reference);
    const [, bookRaw, chapter, verseStart] = refMatch;
    const book = bookRaw.toUpperCase();

    const resolved = await getResourceZipUrl(
      language,
      "TSV Translation Questions",
      organization,
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
        ing.path?.includes(book.toLowerCase())
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

    const questions = parseTq(tsv, chapter, verseStart);
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

interface Question {
  book: string;
  chapter: string;
  verse: string;
  id: string;
  question: string;
  response: string;
}

function parseTq(tsv: string, chapter: string, verse?: string): Question[] {
  return tsv
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("Book"))
    .map((l) => {
      const [book, ch, vs, id, question, response] = l.split("\t");
      return {
        book,
        chapter: ch,
        verse: vs,
        id,
        question: question?.trim(),
        response: response?.trim() ?? "",
      };
    })
    .filter((q) => q.chapter === chapter && (!verse || q.verse === verse));
}
