/**
 * get_obs_study_questions — fetch OBS Study Questions for a story:frame reference.
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

export type GetObsStudyQuestionsParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  questions: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const getObsStudyQuestionsTool: ToolModule<typeof inputSchema> = {
  name: "get_obs_study_questions",
  description:
    "Fetch Open Bible Stories Study Questions (OBS-SQ) for a story:frame reference. " +
    "OBS-SQ provides meaning, application, and summary questions for discussion groups — " +
    'rows often cover a RANGE of frames (e.g. "1:1-8"), so a request for "1:3" returns ' +
    "every question whose range covers that frame (same as v1). Unlike OBS-TQ " +
    "(get_obs_questions), which checks translator comprehension frame-by-frame. " +
    'Use reference "1:3" for questions covering that frame, or "1" for the whole story. ' +
    "Pairs with get_obs_story and get_obs_study_notes. " +
    "Missing OBS-SQ for the language: soft-fail with RESOURCE_NOT_AVAILABLE (isError:false).",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Get OBS Study Questions",
  },

  async handler(
    params: GetObsStudyQuestionsParams,
    env: Env,
    _requestId: string,
  ) {
    const { reference, language } = params;
    const client = new ApiClient(env);

    const data = await client.get<Record<string, unknown>>(
      "/api/v1/obs-study-questions",
      {
        reference,
        language,
      },
    );

    if (data.available === false) {
      return notAvailable(
        `OBS Study Questions for language "${language}"`,
        String(data.message ?? ""),
      );
    }

    const questions = (data.questions as unknown[]) ?? [];
    const label = formatObsReferenceLabel(reference);
    return ok(
      data,
      `${questions.length} OBS study question(s) for ${label} (${language})`,
    );
  },
};
