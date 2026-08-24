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
import { languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import type { ResourceAvailability } from "@translation-helps/door43";

/**
 * Unlike other passage tools, this one also accepts a BARE BOOK reference
 * (no chapter/verse) — it then returns only the book-level intro (front:intro).
 */
const contextReferenceParam = z
  .string()
  .min(3)
  .describe(
    "A Bible passage OR a bare book name. " +
      'With chapter ("TIT 1", "JHN 3:16") returns book + chapter intro notes. ' +
      'With only a book name or USFM code ("TIT", "Titus", "1 John") returns just the book overview (front:intro). ' +
      "The book name may be localized when it matches the `language` parameter.",
  );

const inputSchema = z.object({
  reference: contextReferenceParam,
  language: languageParam,
});

export type GetPassageContextParams = z.infer<typeof inputSchema>;

export const getPassageContextTool: ToolModule<typeof inputSchema> = {
  name: "get_passage_context",
  description:
    "STEP 1b (orient — background): Load the background AROUND a passage — book/chapter introductions and a summary of which resources exist. " +
    'Returns `context[]` with book-level and chapter-level intro notes (each tagged `scope:"book"` or `scope:"chapter"` — cultural background, overview, themes) ' +
    "and `availability` listing which resource types exist for this language (filtered to the reference book when catalog ingredients allow). " +
    'Also accepts a BARE BOOK reference (e.g. "TIT" or "Titus") — then returns only the book overview (front:intro), ideal when the user names a whole book. ' +
    "BEFORE this: call `get_passage` first (Step 1a) to read the text and warm the server cache. " +
    "This does NOT return the verse text — use `get_passage` for that. " +
    "Call this once per passage, then call `get_passage_index` (Step 2) to survey translation issues and key terms in the specific verses.",
  inputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Get Passage Context (Background)",
  },

  async handler(params: GetPassageContextParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { reference, language } = params;

    // Parse book + chapter from reference for intro-note filtering
    const bookChapter = extractBookChapter(reference);

    // Bare book (no chapter): the notes API requires a chapter, so query
    // "{book} 1" and keep only the book-level intro (front:intro) below.
    const bookOnly = isBookOnlyReference(reference);
    const apiReference = bookOnly ? `${reference.trim()} 1` : reference;

    const [notesData, resourcesData] = await Promise.allSettled([
      client.get<{ notes: Array<Record<string, unknown>> }>("/api/v1/notes", {
        reference: apiReference,
        language,
      }),
      client.get<{ available: ResourceAvailability[] }>("/api/v1/resources", {
        language,
        ...(bookChapter?.book
          ? { book: bookChapter.book }
          : bookOnly
            ? { book: reference.trim() }
            : {}),
      }),
    ]);

    const notesError =
      notesData.status === "rejected"
        ? settledRejectionMessage(notesData.reason)
        : undefined;
    const availabilityError =
      resourcesData.status === "rejected"
        ? settledRejectionMessage(resourcesData.reason)
        : undefined;

    const allNotes: Array<Record<string, unknown>> =
      notesData.status === "fulfilled" ? (notesData.value.notes ?? []) : [];

    // Keep only intro-level notes (front:intro = book intro, N:intro = chapter intro).
    // The parser always returns these alongside verse notes, so we just filter.
    // For a bare-book reference, keep only the book overview (front:intro).
    const contextNotes = allNotes
      .filter((n) => String(n["verse"] ?? "") === "intro")
      .filter((n) => !bookOnly || String(n["chapter"] ?? "") === "front")
      .map((n) => ({
        ...n,
        // Annotate scope so the LLM knows whether this is book-level or chapter-level context
        scope: String(n["chapter"] ?? "") === "front" ? "book" : "chapter",
      }));

    const availability: ResourceAvailability[] =
      resourcesData.status === "fulfilled"
        ? (resourcesData.value.available ?? [])
        : [];

    const summaryParts = [
      `${contextNotes.length} context note(s)`,
      `${availability.length} resource type(s) available`,
    ];
    if (notesError) summaryParts.push(`notes fetch failed: ${notesError}`);
    if (availabilityError)
      summaryParts.push(`availability fetch failed: ${availabilityError}`);

    return ok(
      {
        reference,
        language,
        context: contextNotes,
        availability,
        book:
          bookChapter?.book ??
          (bookOnly ? reference.trim().toUpperCase() : undefined),
        chapter: bookChapter?.chapter,
        ...(bookOnly ? { scope: "book" } : {}),
        ...(notesError ? { notesError } : {}),
        ...(availabilityError ? { availabilityError } : {}),
      },
      summaryParts.join(", "),
    );
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function settledRejectionMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason ?? "unknown error");
}

/**
 * True when the reference names a book without any chapter/verse.
 * Handles ordinal book names: "1 John" is book-only, "1 John 2" is not.
 */
function isBookOnlyReference(reference: string): boolean {
  const withoutOrdinal = reference.trim().replace(/^[123]\s+/, "");
  return !/\d/.test(withoutOrdinal);
}

function extractBookChapter(
  reference: string,
): { book: string; chapter: string } | null {
  // e.g. "JHN 3:16" → { book: "JHN", chapter: "3" }
  const m = reference.trim().match(/^(\S+)\s+(\d+)/);
  if (!m) return null;
  return { book: m[1].toUpperCase(), chapter: m[2] };
}
