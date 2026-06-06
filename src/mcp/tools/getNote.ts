/**
 * get_note — Step 3 (study) drill-down for a single translation note.
 *
 * Fetches the full note body for a specific note `id` (from `get_passage_index`).
 * Returns the note text, which explains a translation issue, alternative rendering,
 * cultural context, or grammar point.
 *
 * BEFORE: call `get_passage_index` to get note `id` values.
 * AFTER:  call `get_academy_article(taArticle.path)` for the linked TA article,
 *         or `get_questions` to verify a translation draft.
 */

import { z } from "zod";
import { referenceParam, languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";

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

export const getNoteTool: ToolModule<typeof inputSchema> = {
  name: "get_note",
  description:
    "STEP 3 (study/drill): Fetch the full body of one or more translation notes for a verse. " +
    "Each note object contains: `id`, `quote` (the ORIGINAL-LANGUAGE words the note covers), " +
    "`note` (the full explanation), `supportReference` (rc:// path to a Translation Academy article), " +
    "`occurrence`, and `verse`. " +
    "Pass `id` (from `get_passage_index`) for a specific note. " +
    "Pass `phrase` to find notes that cover a given strategic-language phrase — " +
    "the system matches against `quote` and note body so you can connect a user question like " +
    "'what does X mean?' to the exact authoritative note. " +
    "Omit both `id` and `phrase` to retrieve all verse notes. " +
    "BEFORE: call `get_passage_index`. " +
    "AFTER: call `get_academy_article(supportReference)` for the linked translation principle.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Get Note" },

  async handler(params: GetNoteParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { reference, language, id, phrase } = params;

    const data = await client.get<{ notes: Array<Record<string, unknown>> }>(
      "/api/v1/notes",
      { reference, language },
    );

    let notes = data.notes ?? [];

    // Keep only verse-level notes (exclude intro)
    notes = notes.filter((n) => n["verse"] !== "intro" && n["verse"] !== "front");

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

    return ok(
      { reference, language, id: id ?? null, phrase: phrase ?? null, notes },
      `${notes.length} note(s) for ${reference}${phrase ? ` matching phrase "${phrase}"` : ""}`,
    );
  },
};
