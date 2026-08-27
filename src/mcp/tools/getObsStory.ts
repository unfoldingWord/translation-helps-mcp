/**
 * get_obs_story — fetch Open Bible Stories text for a story:frame reference.
 */

import { z } from "zod";
import {
  languageParam,
  ok,
  notAvailable,
  withNotAvailableOutput,
  type ToolModule,
} from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import { formatObsReferenceLabel } from "@translation-helps/door43";

const OBS_REFERENCE_DESCRIPTION =
  "An OBS story:frame reference. " +
  'Examples: "1:1" (story 1, frame 1), "1:0" (story 1 title), "front" (front matter). ' +
  "Story numbers run from 1 to 50; frames are 1-indexed. " +
  'Omitting the frame (e.g. "1") returns all frames of the story. ' +
  'An optional "OBS" prefix is accepted ("OBS 1" ≡ "1").';

const inputSchema = z.object({
  reference: z.string().min(1).describe(OBS_REFERENCE_DESCRIPTION),
  language: languageParam,
});

export type GetObsStoryParams = z.infer<typeof inputSchema>;

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  story: z.union([z.number(), z.null()]).optional(),
  frame: z.number().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  frames: z
    .array(
      z.object({
        index: z.number(),
        imageUrl: z.union([z.string(), z.null()]),
        text: z.string(),
      }),
    )
    .optional(),
  attribution: z.union([z.string(), z.null()]).optional(),
  note: z.string().optional(),
});

export const getObsStoryTool: ToolModule<typeof inputSchema> = {
  name: "get_obs_story",
  description:
    "Fetch Open Bible Stories (OBS) text for a specific story and frame. " +
    "OBS is a set of 50 illustrated Bible stories designed for communities without written Scripture. " +
    "Returns the story title and one or more frame objects, each containing the frame text and image URL. " +
    'Use reference "1:1" for story 1, frame 1; "2" or "2:*" for all frames of story 2. ' +
    "Use get_obs_notes and get_obs_questions for translation helps on the same reference. " +
    "Missing OBS for the language: soft-fail with RESOURCE_NOT_AVAILABLE (isError:false).",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Get OBS Story Text",
  },

  async handler(params: GetObsStoryParams, env: Env, _requestId: string) {
    const { reference, language } = params;
    const client = new ApiClient(env);
    const label = formatObsReferenceLabel(reference);

    const data = await client.get<Record<string, unknown>>("/api/v1/obs", {
      reference,
      language,
    });

    if (data.available === false) {
      return notAvailable(
        `Open Bible Stories for language "${language}"`,
        String(data.message ?? ""),
      );
    }

    return ok(
      data,
      `${label} (${language}) — ${(data.frames as unknown[])?.length ?? 0} frame(s)`,
    );
  },
};
