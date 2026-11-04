/**
 * v3 th_get_questions — translation or study questions for Bible and OBS.
 *
 * Bible translation: GET /api/v1/questions (v2 get_questions).
 * Bible study: not available (no study-question resource today).
 * OBS translation: GET /api/v1/obs-questions.
 * OBS study: GET /api/v1/obs-study-questions.
 */

import { z } from "zod";
import { ErrorCode, TranslationHelpsError } from "../../../core/errors.js";
import { ApiClient } from "../../apiClient.js";
import type { Env } from "../../agent.js";
import {
  notAvailable,
  ok,
  readResourceSource,
  resourceSourceSchema,
  withNotAvailableOutput,
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
      'A Bible passage or an Open Bible Stories reference, e.g. "JHN 3:16", "John 3", "OBS 3:5" or "OBS 3".',
    ),
  language: v3LanguageParam,
  kind: z
    .enum(["translation", "study"])
    .default("translation")
    .describe(
      '"translation" (default) or "study". "study" is Open Bible Stories study questions for discussion groups, which often cover a range of frames. The Bible has translation questions only.',
    ),
});

/**
 * Study questions exist for Open Bible Stories. A Bible `study` call is a
 * soft "not available", and the description says so before the call.
 */
export const GET_QUESTIONS_DESCRIPTION =
  'Returns comprehension questions for a Bible passage or an Open Bible Stories reference, each with its expected answer. They check whether a translation draft says what the source says: use them after drafting, or when the user asks for questions on a passage. kind "study" returns Open Bible Stories study questions, about meaning and application for discussion groups, which often cover a range of frames; the Bible has only translation questions. Not every language or book has questions: available false means none exist. Do not answer from memory.';

const v3MetaOutputSchema = z
  .object({
    cache: z.string().optional(),
  })
  .optional();

const outputSchema = withNotAvailableOutput({
  kind: z.enum(["bible", "obs"]).optional(),
  questionKind: z.enum(["translation", "study"]).optional(),
  reference: z.string().optional(),
  language: z.string().optional(),
  questions: z.array(z.record(z.string(), z.unknown())).optional(),
  source: resourceSourceSchema,
  meta: v3MetaOutputSchema,
});

export const getQuestionsV3Tool = {
  name: "th_get_questions",
  description: GET_QUESTIONS_DESCRIPTION,
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    title: "Get Questions",
  },

  async handler(
    params: z.input<typeof inputSchema>,
    env: Env,
    _requestId: string,
  ) {
    const value = requireRead(params);
    const language = params.language || "en";
    const questionKind = params.kind ?? "translation";

    if (value.kind === "book") {
      throw invalid(
        'th_get_questions needs a chapter or an OBS story, for example "JHN 3" or "OBS 3". A book alone is not a passage.',
      );
    }
    if (value.kind === "bible" && isIntro(value)) {
      throw invalid(introductionNotesMessage(value.reference));
    }

    if (value.kind === "bible" && questionKind === "study") {
      return notAvailable(
        'Bible study questions (kind "study"; the Bible has translation questions only)',
        undefined,
        V3_LIST_RESOURCES_HINT,
      );
    }

    const client = new ApiClient(env);
    const path =
      value.kind === "obs"
        ? questionKind === "study"
          ? "/api/v1/obs-study-questions"
          : "/api/v1/obs-questions"
        : "/api/v1/questions";

    const data = await client.get<Record<string, unknown>>(path, {
      reference: value.reference,
      language,
    });

    const source = readResourceSource(data.source);
    if (data.available === false) {
      const book = stringField(data.book);
      return notAvailable(
        value.kind === "obs"
          ? `OBS ${questionKind} questions for language "${language}"`
          : book
            ? `translation questions for "${book}" in language "${language}"`
            : `translation questions for language "${language}"`,
        stringField(data.message),
        V3_LIST_RESOURCES_HINT,
        source,
      );
    }

    const questions = Array.isArray(data.questions) ? data.questions : [];
    const meta = cacheOnly(data.meta);
    return ok(
      {
        kind: value.kind,
        questionKind,
        reference: value.reference,
        language: stringField(data.language) ?? language,
        questions,
        ...(source ? { source } : {}),
        ...(meta ? { meta } : {}),
      },
      `${questions.length} ${questionKind} question(s) for ${value.reference} (${language})`,
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

function cacheOnly(meta: unknown): { cache: string } | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const cache = (meta as { cache?: unknown }).cache;
  return typeof cache === "string" && cache ? { cache } : undefined;
}
