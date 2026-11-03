/**
 * v3 th_get_questions — translation or study questions for Bible and OBS.
 *
 * Bible translation: GET /api/v1/questions (v2 get_questions).
 * Bible study: not available (no study-question resource today).
 * OBS translation: GET /api/v1/obs-questions (OBS-TQ).
 * OBS study: GET /api/v1/obs-study-questions (OBS-SQ).
 */

import { z } from "zod";
import { ErrorCode, TranslationHelpsError } from "../../../core/errors.js";
import { ApiClient } from "../../apiClient.js";
import type { Env } from "../../agent.js";
import {
  metaOutputSchema,
  notAvailable,
  ok,
  withNotAvailableOutput,
} from "../../tools/shared.js";
import { v3LanguageParam } from "../params.js";
import {
  introductionNotesMessage,
  V3_LIST_RESOURCES_HINT,
} from "../instructions.js";
import { readReference, type ReferenceRead } from "../readReference.js";

const inputSchema = z.object({
  reference: z.string().min(1).describe("A Bible passage or an OBS reference."),
  language: v3LanguageParam,
  kind: z
    .enum(["translation", "study"])
    .default("translation")
    .describe(
      '"translation" (default) or "study". The Bible has translation questions only. OBS study questions are OBS-SQ.',
    ),
});

/**
 * Proposal description, plus where study questions exist. A Bible `study`
 * call is a soft "not available", and the model should see that before it calls.
 */
export const GET_QUESTIONS_DESCRIPTION =
  "Comprehension questions. kind is translation (default) or study. " +
  "Bible study questions are not available; OBS study questions are OBS-SQ.";

const outputSchema = withNotAvailableOutput({
  kind: z.enum(["bible", "obs"]).optional(),
  questionKind: z.enum(["translation", "study"]).optional(),
  reference: z.string().optional(),
  language: z.string().optional(),
  questions: z.array(z.record(z.string(), z.unknown())).optional(),
  meta: metaOutputSchema,
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

    if (data.available === false) {
      return notAvailable(
        value.kind === "obs"
          ? `OBS ${questionKind} questions for language "${language}"`
          : `translation questions for language "${language}"`,
        String(data.message ?? ""),
        V3_LIST_RESOURCES_HINT,
      );
    }

    const questions = Array.isArray(data.questions) ? data.questions : [];
    const meta = data.meta;
    return ok(
      {
        kind: value.kind,
        questionKind,
        reference: value.reference,
        language: stringField(data.language) ?? language,
        questions,
        ...(meta && typeof meta === "object" ? { meta } : {}),
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
