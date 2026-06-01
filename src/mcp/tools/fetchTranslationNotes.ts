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
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
  organization: z
    .string()
    .default("unfoldingWord")
    .describe("Content organization on Door43 (default: unfoldingWord)."),
});

export type FetchTranslationNotesParams = z.infer<typeof inputSchema>;

export const fetchTranslationNotesTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_notes",
  description:
    "Fetch translation notes (TN) for a specific Bible reference. Notes explain difficult phrases, cultural context, and translation strategies. Use after fetch_scripture to understand a passage.",
  inputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Notes",
  },

  async handler(
    params: FetchTranslationNotesParams,
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
      "TSV Translation Notes",
      organization,
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

    // TN files: tn_<BOOK>.tsv
    const paths = [`tn_${book}.tsv`, `${book}.tsv`];
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
      throw Errors.resourceNotFound(
        `Translation Notes file for book "${book}"`,
      );

    const notes = parseTsv(tsv, chapter, verseStart);

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

interface Note {
  book: string;
  chapter: string;
  verse: string;
  id: string;
  supportReference: string;
  quote: string;
  occurrence: string;
  note: string;
}

function parseTsv(tsv: string, chapter: string, verse?: string): Note[] {
  const lines = tsv.split("\n");
  const results: Note[] = [];

  for (const line of lines) {
    if (!line.trim() || line.startsWith("Book")) continue;
    const cols = line.split("\t");
    if (cols.length < 8) continue;
    const [book, ch, vs, id, supRef, quote, occurrence, note] = cols;
    if (ch !== chapter) continue;
    if (verse && vs !== verse) continue;
    results.push({
      book,
      chapter: ch,
      verse: vs,
      id,
      supportReference: supRef,
      quote,
      occurrence,
      note: note?.trim() ?? "",
    });
  }

  return results;
}
