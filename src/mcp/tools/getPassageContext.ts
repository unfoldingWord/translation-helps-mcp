/**
 * get_passage_context — Step 1 (orient) of the passage-understanding workflow.
 *
 * Returns the orientation material AROUND a passage (NOT the verse text — for
 * that, call `get_passage`):
 *   - `context[]`      Book-intro (`front:intro`) and chapter-intro notes, each
 *                      tagged with `scope: "book" | "chapter"`.
 *   - `availability`   Which resource types are present for the language (cheap catalog check).
 *
 * Call this once at the start of a passage. For the scripture text, call
 * `get_passage`. After orient → call `get_passage_index` (survey).
 */

import { z } from "zod";
import { referenceParam, languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import type { ResourceAvailability } from "../../core/contracts/index.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
});

export type GetPassageContextParams = z.infer<typeof inputSchema>;

export const getPassageContextTool: ToolModule<typeof inputSchema> = {
  name: "get_passage_context",
  description:
    "STEP 1b (orient — background): Load the background AROUND a passage — book/chapter introductions and a summary of which resources exist. " +
    "Returns `context[]` with book-level and chapter-level intro notes (each tagged `scope:\"book\"` or `scope:\"chapter\"` — cultural background, overview, themes) " +
    "and `availability` listing which resource types exist for this language. " +
    "BEFORE this: call `get_passage` first (Step 1a) to read the text and warm the server cache. " +
    "This does NOT return the verse text — use `get_passage` for that. " +
    "Call this once per passage, then call `get_passage_index` (Step 2) to survey translation issues and key terms in the specific verses.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Get Passage Context (Background)" },

  async handler(params: GetPassageContextParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { reference, language } = params;

    // Parse book + chapter from reference for intro-note filtering
    const bookChapter = extractBookChapter(reference);

    const [notesData, resourcesData] = await Promise.allSettled([
      client.get<{ notes: Array<Record<string, unknown>> }>("/api/v1/notes", { reference, language }),
      client.get<{ available: ResourceAvailability[] }>("/api/v1/resources", { language }),
    ]);

    const allNotes: Array<Record<string, unknown>> =
      notesData.status === "fulfilled" ? notesData.value.notes : [];

    // Keep only intro-level notes (front:intro = book intro, N:intro = chapter intro).
    // The parser always returns these alongside verse notes, so we just filter.
    const contextNotes = allNotes
      .filter((n) => String(n["verse"] ?? "") === "intro")
      .map((n) => ({
        ...n,
        // Annotate scope so the LLM knows whether this is book-level or chapter-level context
        scope: String(n["chapter"] ?? "") === "front" ? "book" : "chapter",
      }));

    const availability: ResourceAvailability[] =
      resourcesData.status === "fulfilled" ? (resourcesData.value.available ?? []) : [];

    return ok(
      {
        reference,
        language,
        context: contextNotes,
        availability,
        book: bookChapter?.book,
        chapter: bookChapter?.chapter,
      },
      `${contextNotes.length} context note(s), ${availability.length} resource type(s) available`,
    );
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBookChapter(reference: string): { book: string; chapter: string } | null {
  // e.g. "JHN 3:16" → { book: "JHN", chapter: "3" }
  const m = reference.trim().match(/^(\S+)\s+(\d+)/);
  if (!m) return null;
  return { book: m[1].toUpperCase(), chapter: m[2] };
}
