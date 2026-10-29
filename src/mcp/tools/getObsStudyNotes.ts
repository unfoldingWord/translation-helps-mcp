/**
 * get_obs_study_notes — fetch OBS Study Notes for a story:frame reference.
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

export type GetObsStudyNotesParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  notes: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const getObsStudyNotesTool: ToolModule<typeof inputSchema> = {
  name: "get_obs_study_notes",
  description:
    "Fetch Open Bible Stories Study Notes (OBS-SN) for a story:frame reference. " +
    "OBS-SN explains the story for readers and discussion groups — background on " +
    "people, places, and ideas in each frame — unlike OBS-TN (get_obs_notes), which " +
    "targets translators with quotes, support references, and translation strategies. " +
    'Use reference "1:1" for frame-specific notes, or "1" for all notes in a story. ' +
    "Pairs with get_obs_story and get_obs_study_questions. " +
    "Missing OBS-SN for the language: soft-fail with RESOURCE_NOT_AVAILABLE (isError:false).",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Get OBS Study Notes",
  },

  async handler(params: GetObsStudyNotesParams, env: Env, _requestId: string) {
    const { reference, language } = params;
    const client = new ApiClient(env);

    const data = await client.get<Record<string, unknown>>(
      "/api/v1/obs-study-notes",
      {
        reference,
        language,
      },
    );

    if (data.available === false) {
      return notAvailable(
        `OBS Study Notes for language "${language}"`,
        String(data.message ?? ""),
      );
    }

    const notes = (data.notes as unknown[]) ?? [];
    const label = formatObsReferenceLabel(reference);
    return ok(
      data,
      `${notes.length} OBS study note(s) for ${label} (${language})`,
    );
  },
};
