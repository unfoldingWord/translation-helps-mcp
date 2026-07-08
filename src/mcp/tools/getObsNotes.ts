/**
 * get_obs_notes — fetch OBS Translation Notes for a story:frame reference.
 */

import { z } from "zod";
import { languageParam, ok, notAvailable, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: z
    .string()
    .min(1)
    .describe(
      'OBS story:frame reference, e.g. "1:1", "1:0", "front". ' +
        "Omit the frame to get notes for an entire story.",
    ),
  language: languageParam,
});

export type GetObsNotesParams = z.infer<typeof inputSchema>;

export const getObsNotesTool: ToolModule<typeof inputSchema> = {
  name: "get_obs_notes",
  description:
    "Fetch Open Bible Stories Translation Notes (OBS-TN) for a story:frame reference. " +
    "OBS-TN notes explain difficult words, cultural context, and translation strategies " +
    "for each frame of the 50 OBS stories — analogous to TN for Bible passages. " +
    'Use reference "1:1" for frame-specific notes, or "1" for all notes in a story. ' +
    "Pairs with get_obs_story to provide the story text context.",
  inputSchema,
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
    return ok(
      data,
      `${notes.length} OBS note(s) for ${reference} (${language})`,
    );
  },
};
