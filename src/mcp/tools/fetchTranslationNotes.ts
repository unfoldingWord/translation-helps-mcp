/**
 * fetch_translation_notes — TSV translation notes from unfoldingWord.
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
import { parseTranslationNotesTsv } from "../../core/parsers/tsv.js";
import type { TranslationNoteRow } from "../../core/contracts/index.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
});

export type FetchTranslationNotesParams = z.infer<typeof inputSchema>;

const noteSchema = {
  book: z.string(),
  chapter: z.string(),
  verse: z.string(),
  id: z.string(),
  supportReference: z.string(),
  quote: z.string(),
  occurrence: z.string(),
  note: z.string(),
};

const outputSchema = {
  reference: z.string(),
  language: z.string(),
  book: z.string(),
  chapter: z.string(),
  verse: z.string().optional(),
  notes: z.array(z.object(noteSchema)),
  requestId: z.string(),
};

export const fetchTranslationNotesTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_notes",
  description:
    "Fetch translation notes (TN) for a specific Bible reference. " +
    "Notes explain difficult phrases, cultural context, translation strategies, and alternate renderings written for mother-tongue translators. " +
    "Use after fetch_scripture to identify which parts of a passage need closer attention. " +
    "Returns an array of note objects with `quote`, `note`, and `supportReference` fields; `supportReference` often contains an rc:// URI pointing to a Translation Academy article. " +
    "Limitation: notes are verse-specific; a chapter reference returns all verses in that chapter.",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Notes",
  },

  async handler(
    params: FetchTranslationNotesParams,
    env: Env,
    requestId: string,
  ) {
    const { reference, language } = params;

    const parsed = parseReferenceForTool(reference);
    if (!parsed) throw Errors.invalidReference(reference);
    const { book, chapter, verseStart } = parsed;

    const resolved = await getResourceZipUrl(
      language,
      "TSV Translation Notes",
      "unfoldingWord",
      "prod",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (!resolved) {
      throw Errors.resourceNotFound(
        `Translation Notes for language "${language}"`,
      );
    }

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    const paths = [`tn_${book}.tsv`, `${book}.tsv`];
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
      throw Errors.resourceNotFound(
        `Translation Notes file for book "${book}"`,
      );

    const notes = parseTranslationNotesTsv(tsv, chapter, verseStart);

    return ok(
      {
        reference,
        language,
        book,
        chapter,
        verse: verseStart,
        notes,
        requestId,
      },
      `${notes.length} translation notes for ${reference}`,
    );
  },
};

// Re-export the shared type so existing consumers of this tool file still compile.
export type { TranslationNoteRow as Note };
