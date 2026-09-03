/**
 * get_obs_questions — fetch OBS Translation Questions for a story:frame reference.
 */

import { z } from "zod";
import {
  languageParam,
  OBS_REFERENCE_DESCRIPTION,
  ok,
  notAvailable,
  withNotAvailableOutput,
  type ToolModule,
} from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import { formatObsReferenceLabel } from "@translation-helps/door43";

const inputSchema = z.object({
  reference: z
    .string()
    .min(1)
    .describe(`An OBS story:frame reference. ${OBS_REFERENCE_DESCRIPTION}`),
  language: languageParam,
});

export type GetObsQuestionsParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  questions: z.array(z.record(z.unknown())).optional(),
});

export const getObsQuestionsTool: ToolModule<typeof inputSchema> = {
  name: "get_obs_questions",
  description:
    "Fetch Open Bible Stories Translation Questions (OBS-TQ) for a story:frame reference. " +
    "OBS-TQ provides comprehension questions and expected answers for each frame of the 50 OBS stories. " +
    "Use these after a translator has produced a draft to verify the translation conveys the correct meaning. " +
    'Use reference "1:1" for frame-level questions, or "1" for all questions in a story. ' +
    "Pairs with get_obs_story to provide the story text context. " +
    "Missing OBS-TQ for the language: soft-fail with RESOURCE_NOT_AVAILABLE (isError:false).",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Get OBS Translation Questions",
  },

  async handler(params: GetObsQuestionsParams, env: Env, _requestId: string) {
    const { reference, language } = params;
    const client = new ApiClient(env);

    const data = await client.get<Record<string, unknown>>(
      "/api/v1/obs-questions",
      {
        reference,
        language,
      },
    );

    if (data.available === false) {
      return notAvailable(
        `OBS Translation Questions for language "${language}"`,
        String(data.message ?? ""),
      );
    }

    const questions = (data.questions as unknown[]) ?? [];
    const label = formatObsReferenceLabel(reference);
    return ok(
      data,
      `${questions.length} OBS question(s) for ${label} (${language})`,
    );
  },
};
