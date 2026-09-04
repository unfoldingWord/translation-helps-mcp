/**
 * get_obs_notes — fetch OBS Translation Notes for a story:frame reference.
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

export type GetObsNotesParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  notes: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const getObsNotesTool: ToolModule<typeof inputSchema> = {
  name: "get_obs_notes",
  description:
    "Fetch Open Bible Stories Translation Notes (OBS-TN) for a story:frame reference. " +
    "OBS-TN notes explain difficult words, cultural context, and translation strategies " +
    "for each frame of the 50 OBS stories — analogous to TN for Bible passages. " +
    'Use reference "1:1" for frame-specific notes, or "1" for all notes in a story. ' +
    "Pairs with get_obs_story to provide the story text context. " +
    "Missing OBS-TN for the language: soft-fail with RESOURCE_NOT_AVAILABLE (isError:false).",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Get OBS Translation Notes",
  },

  async handler(params: GetObsNotesParams, env: Env, _requestId: string) {
    const { reference, language } = params;
    const client = new ApiClient(env);

    const data = await client.get<Record<string, unknown>>(
      "/api/v1/obs-notes",
      {
        reference,
        language,
      },
    );

    if (data.available === false) {
      return notAvailable(
        `OBS Translation Notes for language "${language}"`,
        String(data.message ?? ""),
      );
    }

    const notes = (data.notes as unknown[]) ?? [];
    const label = formatObsReferenceLabel(reference);
    return ok(data, `${notes.length} OBS note(s) for ${label} (${language})`);
  },
};
