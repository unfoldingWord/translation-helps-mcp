/**
 * get_passage — scripture text for a reference (all versions).
 *
 * The lightweight workhorse: returns ONLY the scripture `versions[]` for a
 * passage — no intro notes, no availability check. Cheap and repeatable, so
 * the LLM can re-read the text freely while drilling and drafting without
 * re-paying for book/chapter introductions.
 *
 * Each version is labeled with a semantic `role`:
 *   - `literal`    word-for-word form (e.g. ULT/GLT)
 *   - `simplified` meaning-based (e.g. UST/GST)
 *   - `original`   Hebrew/Greek source (UHB/UGNT) — always included
 *
 * For book/chapter background + what resources exist, call `get_passage_context`.
 */

import { z } from "zod";
import { referenceParam, languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import type { ScriptureVersion } from "../../core/contracts/index.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
});

export type GetPassageParams = z.infer<typeof inputSchema>;

export const getPassageTool: ToolModule<typeof inputSchema> = {
  name: "get_passage",
  description:
    "STEP 1a (orient — text): Fetch the scripture TEXT for a passage — ALL available versions in one call. " +
    "Returns `versions[]`, each labeled by `role`: `literal` (word-for-word, e.g. ULT), " +
    "`simplified` (meaning-based, e.g. UST), and `original` (Hebrew/Greek source, always included). " +
    "Use `role:literal` to translate form and `role:simplified` to translate meaning; compare against `role:original` for the source wording. " +
    "Call this FIRST when studying or translating a passage — it also warms the server cache for all subsequent steps. " +
    "It is cheap and repeatable: re-call it any time you need to re-read the verse while studying or drafting. " +
    "After this → call `get_passage_context` (Step 1b) for background notes, then `get_passage_index` (Step 2) to survey translation issues.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Get Passage" },

  async handler(params: GetPassageParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { reference, language } = params;

    const data = await client.get<{
      reference: string;
      language: string;
      book?: string;
      chapter?: string;
      verse?: string | null;
      versions: ScriptureVersion[];
    }>("/api/v1/scripture", { reference, language });

    const versions = data.versions ?? [];
    // Use the effective language returned by the server — may differ from the
    // input when a variant was resolved (e.g. "es" → "es-419").
    const effectiveLanguage = data.language ?? language;

    // Kick off background cache warming for the next workflow steps
    // (get_passage_context, get_passage_index, get_note, get_questions).
    // Fire-and-forget — the REST API worker uses ctx.waitUntil() to ensure
    // completion. Never blocks or errors the scripture response.
    client.prefetch(reference, effectiveLanguage);

    return ok(
      {
        reference,
        language: effectiveLanguage,
        book: data.book,
        chapter: data.chapter,
        verse: data.verse ?? null,
        versions,
      },
      `${versions.length} scripture version(s) for ${reference}`,
    );
  },
};
