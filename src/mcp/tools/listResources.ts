/**
 * list_resources — availability summary for a language (workflow discovery).
 *
 * Backed by GET /api/v1/resources. Returns which resource types / versions
 * exist for a language (catalog metadata only — no zip fetching).
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  language: languageParam,
});

export type ListResourcesParams = z.infer<typeof inputSchema>;

interface ResourceAvailability {
  type: string;
  subject: string;
  abbreviation: string;
  role: string;
}

export const listResourcesTool: ToolModule<typeof inputSchema> = {
  name: "list_resources",
  description:
    "List which translation resource types are available for a language. " +
    "Returns an availability summary (`type`, `abbreviation`, `role`) from the Door43 catalog — " +
    "scripture versions, notes, words, academy, questions, and original-language sources. " +
    "Use this for discovery: confirm a language has the resources you need before calling get_passage / get_note / etc. " +
    "Limitation: this is a presence check, not a full catalog listing with zip URLs.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "List Resources" },

  async handler(params: ListResourcesParams, env: Env, requestId: string) {
    const client = new ApiClient(env);
    const data = await client.get<{
      language: string;
      requestedLanguage?: string;
      available: ResourceAvailability[];
    }>("/api/v1/resources", { language: params.language });

    const available = data.available ?? [];
    return ok(
      {
        language: data.language ?? params.language,
        requestedLanguage: data.requestedLanguage ?? params.language,
        available,
        // Alias for harness summarizeResult / discovery consumers
        resources: available,
        requestId,
      },
      `${available.length} resource(s) available for ${data.language ?? params.language}`,
    );
  },
};
