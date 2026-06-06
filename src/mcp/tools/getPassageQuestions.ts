/**
 * get_passage_questions — Step 4 (check) of the passage-understanding workflow.
 *
 * Returns Translation Questions for a passage. Use these comprehension questions
 * to verify that a proposed translation draft correctly communicates the meaning
 * of the original text to a native speaker.
 *
 * BEFORE: steps 1-3 (context → index → study), then produce a translation draft.
 * AFTER:  revise the draft based on which questions a native speaker would answer
 *         differently from the expected response.
 */

import { z } from "zod";
import { referenceParam, languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
});

export type GetPassageQuestionsParams = z.infer<typeof inputSchema>;

export const getPassageQuestionsTool: ToolModule<typeof inputSchema> = {
  name: "get_questions",
  description:
    "STEP 4 (check): Fetch Translation Questions for a passage. " +
    "Questions are yes/no or short-answer comprehension checks that verify a translation communicates the intended meaning. " +
    "Use after producing a translation draft to identify meaning gaps. " +
    "Returns `questions[]` with `{ reference, question, response }` — `response` is the expected correct answer. " +
    "BEFORE: complete steps 1-3 (context → index → study) and draft a translation. " +
    "Empty array means no questions are available for this language/passage.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Get Passage Questions" },

  async handler(params: GetPassageQuestionsParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { reference, language } = params;

    const data = await client.get<{ questions: Array<Record<string, unknown>> }>(
      "/api/v1/questions",
      { reference, language },
    );

    const questions = data.questions ?? [];
    return ok(
      { reference, language, questions },
      `${questions.length} question(s) for ${reference}`,
    );
  },
};
