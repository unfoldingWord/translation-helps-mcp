/**
 * v3 th_get_passage — scripture text or an OBS story, one reference.
 *
 * Bible calls GET /api/v1/scripture (the v2 get_passage route).
 * OBS calls GET /api/v1/obs (the v2 get_obs_story route).
 */

import { z } from "zod";
import { ErrorCode, TranslationHelpsError } from "../../../core/errors.js";
import { ApiClient } from "../../apiClient.js";
import type { Env } from "../../agent.js";
import {
  mapApiCacheStatus,
  okCached,
  notAvailable,
  withNotAvailableOutput,
  type ToolModule,
} from "../../tools/shared.js";
import { v3LanguageParam } from "../params.js";
import {
  introductionNotesMessage,
  V3_LIST_RESOURCES_HINT,
} from "../instructions.js";
import { readReference, type ReferenceRead } from "../readReference.js";

const inputSchema = z.object({
  reference: z
    .string()
    .min(1)
    .describe(
      'Bible: book and chapter or verses, e.g. "JHN 3:16", "John 3:16-18", "GEN 1"; book names may be in the request\'s language ("Juan 3:16" with language "es"). Open Bible Stories: "OBS 3:5", "OBS 3:1-3" or "OBS 3". A book alone is not accepted here.',
    ),
  language: v3LanguageParam,
  format: z
    .enum(["text", "usfm"])
    .optional()
    .describe(
      '"text" = plain prose (default), "usfm" = raw USFM markup. Ignored for OBS. Omitted means "text".',
    ),
});

const BOOK_ALONE =
  'A book alone is not a passage. Give a chapter, for example "JON 1". th_get_passage_index takes a whole book.';

/**
 * What the tool returns, when to use the index or notes instead, and
 * `format`. A book alone is rejected by the handler; the reference
 * parameter says so, so this text does not repeat it.
 */
export const GET_PASSAGE_DESCRIPTION =
  'Returns the text of a Bible passage or an Open Bible Stories frame. For the Bible it returns every version the language has, each labelled by role: literal (e.g. ULT), simplified (e.g. UST) and original (Hebrew or Greek, always included). When a version lacks the book, another stands in and versionsNote says which, so tell the reader. For Open Bible Stories it returns each frame\'s text and image URL. Use it to read or quote the text; for the notes, key terms and translation issues of the same passage use th_get_passage_index, and for an introduction use th_get_notes. format "usfm" returns raw USFM for the Bible and is ignored for Open Bible Stories; the default is plain text.';

/** Cache name only. Durations stay in the logs. */
const v3MetaOutputSchema = z
  .object({
    cache: z.string().optional(),
  })
  .optional();

const outputSchema = withNotAvailableOutput({
  kind: z.enum(["bible", "obs"]).optional(),
  reference: z.string().optional(),
  language: z.string().optional(),
  book: z.string().optional(),
  chapter: z.string().optional(),
  verse: z.union([z.string(), z.null()]).optional(),
  versions: z
    .array(
      z.object({
        resourceType: z.string(),
        role: z.string(),
        text: z.string(),
        source: z.string(),
      }),
    )
    .optional(),
  versionsNote: z.string().optional(),
  meta: v3MetaOutputSchema,
  story: z.union([z.number(), z.null()]).optional(),
  frame: z.number().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  frames: z
    .array(
      z.object({
        index: z.number(),
        imageUrl: z.union([z.string(), z.null()]),
        text: z.string(),
      }),
    )
    .optional(),
  attribution: z.union([z.string(), z.null()]).optional(),
  note: z.string().optional(),
});

export const getPassageV3Tool: ToolModule<typeof inputSchema> = {
  name: "th_get_passage",
  description: GET_PASSAGE_DESCRIPTION,
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    title: "Get Passage",
  },

  async handler(params, env: Env, _requestId: string) {
    const value = requireRead(params);
    const language = params.language || "en";

    if (value.kind === "book") {
      throw invalid(BOOK_ALONE);
    }
    if (value.kind === "bible" && isIntro(value)) {
      throw invalid(introductionNotesMessage(value.reference));
    }

    const client = new ApiClient(env);
    const format = params.format ?? "text";
    if (value.kind === "obs") {
      const data = await client.get<Record<string, unknown>>("/api/v1/obs", {
        reference: value.reference,
        language,
      });
      if (data.available === false) {
        return notAvailable(
          `Open Bible Stories for language "${language}"`,
          String(data.message ?? ""),
          V3_LIST_RESOURCES_HINT,
        );
      }
      return okCached(
        {
          kind: "obs" as const,
          reference: value.reference,
          language: stringField(data.language) ?? language,
          ...(data.story !== undefined ? { story: data.story } : {}),
          ...(typeof data.frame === "number" ? { frame: data.frame } : {}),
          ...(stringField(data.title) ? { title: data.title } : {}),
          ...(stringField(data.text) ? { text: data.text } : {}),
          ...(Array.isArray(data.frames) ? { frames: data.frames } : {}),
          ...(data.attribution !== undefined
            ? { attribution: data.attribution }
            : {}),
          ...(stringField(data.note) ? { note: data.note } : {}),
        },
        "none",
        `OBS ${value.reference} (${language})`,
      );
    }

    const data = await client.get<{
      reference: string;
      language: string;
      book?: string;
      chapter?: string;
      verse?: string | null;
      versions: Array<{
        resourceType: string;
        role: string;
        text: string;
        source: string;
      }>;
      versionsNote?: string;
      meta?: { cache?: string; timings?: Record<string, number> };
    }>("/api/v1/scripture", {
      reference: value.reference,
      language,
      format,
    });

    const versions = data.versions ?? [];
    const effectiveLanguage = data.language ?? language;
    const prefetchPromise = client.prefetch(value.reference, effectiveLanguage);
    if (typeof env.waitUntil === "function") {
      env.waitUntil(prefetchPromise);
    }
    const cache = data.meta?.cache;
    return okCached(
      {
        kind: "bible" as const,
        reference: value.reference,
        language: effectiveLanguage,
        book: data.book,
        chapter: data.chapter,
        verse: data.verse ?? null,
        versions,
        ...(data.versionsNote ? { versionsNote: data.versionsNote } : {}),
        ...(cache ? { meta: { cache } } : {}),
      },
      mapApiCacheStatus(cache),
      `${versions.length} scripture version(s) for ${value.reference}${cache ? ` [${cache}]` : ""}` +
        (data.versionsNote ? `. ${data.versionsNote}` : ""),
    );
  },
};

function requireRead(params: {
  reference?: string;
  language?: string;
}): ReferenceRead {
  const read = readReference(params, params.language);
  if (!read.ok) throw invalid(read.message);
  return read.value;
}

function isIntro(value: Extract<ReferenceRead, { kind: "bible" }>): boolean {
  return (
    value.verse === "intro" || value.chapter === "front" || value.book === ""
  );
}

function invalid(message: string): TranslationHelpsError {
  return new TranslationHelpsError({
    code: ErrorCode.INVALID_REFERENCE,
    message,
  });
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
