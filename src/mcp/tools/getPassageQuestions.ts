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
  notAvailable,
  readResourceSource,
  resourceSourceSchema,
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
  source: resourceSourceSchema,
  meta: metaOutputSchema,
});

export const getPassageQuestionsTool: ToolModule<typeof inputSchema> = {
  name: "get_questions",
  description:
    "Fetch Translation Questions for a verse. For a direct question about the questions for a passage, call this with the reference. " +
    "When studying a passage step by step, use it after a translation draft to check that the meaning came through. " +
    "Returns questions[] with { reference, question, response }. response is the expected answer. " +
    "Empty questions: [] means this verse has none. " +
    "available: false means this language has no questions for that book: say so and do not answer from memory.",
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
      book?: string;
      language?: string;
      available?: boolean;
      message?: string;
      source?: unknown;
      meta?: { cache?: string };
    }>("/api/v1/questions", { reference, language });

    if (data.available === false) {
      const book = typeof data.book === "string" ? data.book : "";
      const lang = data.language || language;
      return notAvailable(
        book
          ? `translation questions for "${book}" in language "${lang}"`
          : `translation questions for language "${lang}"`,
        typeof data.message === "string" ? data.message : undefined,
        undefined,
        readResourceSource(data.source),
      );
    }

    const questions = data.questions ?? [];
    const cache = data.meta?.cache;
    const source = readResourceSource(data.source);
    return ok(
      {
        reference,
        language,
        questions,
        ...(source ? { source } : {}),
        ...(cache ? { meta: { cache } } : {}),
      },
      `${questions.length} question(s) for ${reference}${cache ? ` [${cache}]` : ""}`,
    );
  },
};
