/**
 * list_resources — availability summary for a language (workflow discovery).
 *
 * Backed by GET /api/v1/resources. Returns which resource types / versions
 * exist for a language (catalog metadata only — no zip fetching).
 *
 * Optional `book` / `reference` filters book-scoped resources so clients
 * are not told TN/TQ/etc. are available when that book is absent from the zip.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  language: languageParam,
  book: z
    .string()
    .min(2)
    .max(20)
    .optional()
    .describe(
      'Optional USFM book code or name (e.g. "TIT", "Titus"). ' +
        "When set, book-scoped resources (scripture, notes, questions, word links) " +
        "that list ingredients but omit this book are excluded.",
    ),
  reference: z
    .string()
    .min(2)
    .optional()
    .describe(
      'Optional passage reference (e.g. "TIT 1:1"). Book is extracted and used like `book`.',
    ),
});

export type ListResourcesParams = z.infer<typeof inputSchema>;

interface ResourceAvailability {
  type: string;
  subject: string;
  abbreviation: string;
  role: string;
  books?: string[];
  bookCount?: number;
  coversBook?: boolean;
  warning?: string;
}

export const listResourcesTool: ToolModule<typeof inputSchema> = {
  name: "list_resources",
  description:
    "List which translation resource types are available for a language. " +
    "Returns an availability summary (`type`, `abbreviation`, `role`) from the Door43 catalog — " +
    "scripture versions, notes, words, academy, questions, OBS, and original-language sources. " +
    "Pass `language` as the user's resource language (e.g. hi) — availability is per-language; " +
    "do not list English resources when the user asked for another language. " +
    "Book-scoped entries may include `books` / `bookCount` / `warning` when coverage is partial. " +
    "Pass optional `book` or `reference` to filter out resources that do not cover that book. " +
    "Use this for discovery: confirm a language has the resources you need before calling get_passage / get_note / etc. " +
    "Limitation: without `book`, this is a type-level presence check — not a guarantee every book exists.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "List Resources" },

  async handler(params: ListResourcesParams, env: Env, requestId: string) {
    const client = new ApiClient(env);
    const query: Record<string, string> = { language: params.language };
    if (params.book) query.book = params.book;
    if (params.reference) query.reference = params.reference;

    const data = await client.get<{
      language: string;
      requestedLanguage?: string;
      book?: string;
      available: ResourceAvailability[];
      coverage?: { note?: string; filteredByBook?: string };
    }>("/api/v1/resources", query);

    const available = data.available ?? [];
    const bookLabel = data.book ? ` (book ${data.book})` : "";
    return ok(
      {
        language: data.language ?? params.language,
        requestedLanguage: data.requestedLanguage ?? params.language,
        ...(data.book ? { book: data.book } : {}),
        available,
        // Alias for harness summarizeResult / discovery consumers
        resources: available,
        ...(data.coverage ? { coverage: data.coverage } : {}),
        requestId,
      },
      `${available.length} resource(s) available for ${data.language ?? params.language}${bookLabel}`,
    );
  },
};
