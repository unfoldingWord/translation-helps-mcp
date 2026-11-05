/**
 * get_note — Step 3 (study) drill-down for a single translation note.
 *
 * Fetches the full note body for a specific note `id` (from `get_passage_index`).
 * Returns the note text, which explains a translation issue, alternative rendering,
 * cultural context, or grammar point.
 *
 * For a direct question about the notes on a verse, call this with the reference.
 * When studying a passage step by step, pass `id` from `get_passage_index`.
 * Pass `taArticle.path` to `get_academy_article`.
 */

import { z } from "zod";
import {
  referenceParam,
  languageParam,
  ok,
  metaOutputSchema,
  notAvailable,
  readResourceSource,
  resourceSourceSchema,
  withNotAvailableOutput,
  type ToolModule,
} from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import {
  bookNameToUsfm,
  parseReference,
  rcToTaPath,
  resolveTitleFromPath,
} from "@translation-helps/door43";
import { rewriteNoteVerseLinks } from "../../core/noteText.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
  id: z
    .string()
    .optional()
    .describe(
      "The note ID from `get_passage_index` notes[].id. " +
        "If omitted, all notes for the reference are returned (unless `phrase` is given).",
    ),
  phrase: z
    .string()
    .optional()
    .describe(
      "A word or phrase from the strategic-language text (e.g. 'teaching us', 'instruyéndonos'). " +
        "When provided, only notes whose `quote` field contains this phrase (case-insensitive) " +
        "OR whose `note` body mentions it are returned. " +
        "Use this to find the exact note that covers a phrase the user wants to explore — " +
        "the `quote` field holds the original-language words the note addresses.",
    ),
});

export type GetNoteParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  id: z.union([z.string(), z.null()]).optional(),
  phrase: z.union([z.string(), z.null()]).optional(),
  notes: z.array(z.record(z.string(), z.unknown())).optional(),
  source: resourceSourceSchema,
  meta: metaOutputSchema,
});

export const getNoteTool: ToolModule<typeof inputSchema> = {
  name: "get_note",
  description:
    "Fetch the full body of translation notes for a verse. For a direct question about the notes, call this with the reference. " +
    "Each note has book (USFM code), note, supportReference (an rc:// Translation Academy link), and taArticle.{path,title}. " +
    "Pass taArticle.path to get_academy_article. The rc:// form is also accepted; taArticle.path is the path to reuse. " +
    "Verse links in the note are references such as Genesis 1:29. rc://*/tn/help/... is a note reference, not an article path. " +
    "When studying a passage step by step, pass id from get_passage_index. " +
    "Pass phrase to match a strategic-language phrase against quote and the note body. " +
    "Empty notes: [] when none match — not an error. " +
    "available: false means this language has no notes for that book: say so and do not answer from memory.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Get Note" },

  async handler(params: GetNoteParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { reference, language, id, phrase } = params;

    const data = await client.get<{
      notes: Array<Record<string, unknown>>;
      book?: string;
      language?: string;
      available?: boolean;
      message?: string;
      source?: unknown;
      meta?: { cache?: string };
    }>("/api/v1/notes", { reference, language });

    if (data.available === false) {
      const book = typeof data.book === "string" ? data.book : "";
      const lang = data.language || language;
      return notAvailable(
        book
          ? `translation notes for "${book}" in language "${lang}"`
          : `translation notes for language "${lang}"`,
        typeof data.message === "string" ? data.message : undefined,
        undefined,
        readResourceSource(data.source),
      );
    }

    let notes = data.notes ?? [];
    const referenceBook = bookNameToUsfm(
      parseReference(reference).book || String(data.book ?? ""),
    );

    // Keep only verse-level notes (exclude intro)
    notes = notes.filter(
      (n) => n["verse"] !== "intro" && n["verse"] !== "front",
    );

    if (id) {
      notes = notes.filter((n) => n["id"] === id);
    } else if (phrase) {
      // Match notes whose quote or note body contains the phrase (case-insensitive)
      const needle = phrase.toLowerCase();
      const matched = notes.filter((n) => {
        const q = String(n["quote"] ?? "").toLowerCase();
        const body = String(n["note"] ?? "").toLowerCase();
        return q.includes(needle) || body.includes(needle);
      });
      // Return matched notes if any; otherwise fall back to all notes so the LLM
      // can still see the full set and make a best-effort connection.
      if (matched.length > 0) notes = matched;
    }

    notes = notes.map((row) => shapeNote(row, referenceBook));

    const cache = data.meta?.cache;
    const source = readResourceSource(data.source);
    return ok(
      {
        reference,
        language,
        id: id ?? null,
        phrase: phrase ?? null,
        notes,
        ...(source ? { source } : {}),
        ...(cache ? { meta: { cache } } : {}),
      },
      `${notes.length} note(s) for ${reference}${phrase ? ` matching phrase "${phrase}"` : ""}${cache ? ` [${cache}]` : ""}`,
    );
  },
};

function shapeNote(
  row: Record<string, unknown>,
  referenceBook: string,
): Record<string, unknown> {
  const rawBook = String(row["book"] ?? "").trim();
  const book = rawBook ? bookNameToUsfm(rawBook) : referenceBook;
  const supportReference = String(row["supportReference"] ?? "");
  const path = supportReference ? rcToTaPath(supportReference) : null;
  const title = String(
    row["supportReferenceTitle"] ??
      (supportReference ? resolveTitleFromPath(supportReference) : "") ??
      "",
  );
  const note = row["note"];
  return {
    ...row,
    book,
    note:
      typeof note === "string"
        ? rewriteNoteVerseLinks(note, book || referenceBook)
        : note,
    taArticle: path ? { path, title } : null,
  };
}
