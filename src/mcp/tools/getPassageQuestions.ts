/**
 * get_passage_questions — Step 4 (check) of the passage-understanding workflow.
 *
 * Returns Translation Questions for a passage. Use these comprehension questions
 * to verify that a proposed translation draft correctly communicates the meaning
 * of the original text to a native speaker.
 *
 * For a direct question about the questions for a verse, call this with the reference.
 * When studying a passage step by step, use it after a translation draft.
 */

import { z } from "zod";
import {
  referenceParam,
  languageParam,
  ok,
  metaOutputSchema,
  withNotAvailableOutput,
  type ToolModule,
} from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
});

export type GetPassageQuestionsParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  questions: z.array(z.record(z.string(), z.unknown())).optional(),
  meta: metaOutputSchema,
});

export const getPassageQuestionsTool: ToolModule<typeof inputSchema> = {
  name: "get_questions",
  description:
    "Fetch Translation Questions for a verse. For a direct question about the questions for a passage, call this with the reference. " +
    "When studying a passage step by step, use it after a translation draft to check that the meaning came through. " +
    "Returns questions[] with { reference, question, response }. response is the expected answer. " +
    "Empty questions: [] means none are available — not an error.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Get Passage Questions" },

  async handler(
    params: GetPassageQuestionsParams,
    env: Env,
    _requestId: string,
  ) {
    const client = new ApiClient(env);
    const { reference, language } = params;

    const data = await client.get<{
      questions: Array<Record<string, unknown>>;
      meta?: { cache?: string };
    }>("/api/v1/questions", { reference, language });

    const questions = data.questions ?? [];
    const cache = data.meta?.cache;
    return ok(
      {
        reference,
        language,
        questions,
        ...(cache ? { meta: { cache } } : {}),
      },
      `${questions.length} question(s) for ${reference}${cache ? ` [${cache}]` : ""}`,
    );
  },
};
