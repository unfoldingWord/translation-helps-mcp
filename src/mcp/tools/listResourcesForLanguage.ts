/**
 * list_resources_for_language — discover all resources for a given language.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { listResourcesForLanguage as dcsList } from "../../core/resources/dcsClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  language: languageParam,
  subject: z
    .string()
    .optional()
    .describe(
      'Filter by subject, e.g. "Translation Notes" or "Aligned Bible". See list_subjects.',
    ),
  stage: z
    .enum(["prod", "preprod", "latest"])
    .default("prod")
    .describe(
      '"prod" = stable releases (default), "preprod" = release candidates, "latest" = development.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(9999)
    .default(50)
    .describe("Maximum number of results to return (default 50)."),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination (default 0)."),
});

const outputSchema = {
  language: z.string(),
  total_count: z.number().describe("Total number of matching resources before pagination."),
  has_more: z.boolean(),
  limit: z.number(),
  offset: z.number(),
  resources: z.array(
    z.object({
      subject: z.string().optional(),
      organization: z.string().optional(),
      zipUrl: z.string().optional(),
    }).passthrough(),
  ),
  requestId: z.string(),
};

export const listResourcesForLanguageTool: ToolModule<typeof inputSchema> = {
  name: "list_resources_for_language",
  description:
    "List all translation resources available for a specific language code. " +
    "Use this to confirm that a particular resource type (TN, TW, TA, etc.) exists for a language before calling fetch_* tools, or to discover what is available. " +
    "Returns an array of resource entries with `subject`, `organization`, and `zipUrl` fields. " +
    "Limitation: only returns prod-stage unfoldingWord resources by default; use the `stage` parameter for pre-release content.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "List Resources For Language" },

  async handler(
    params: z.infer<typeof inputSchema>,
    env: Env,
    requestId: string,
  ) {
    const allResources = await dcsList(params.language, {
      subject: params.subject,
      stage: params.stage as "prod" | "preprod" | "latest",
      kv: env.TRANSLATION_HELPS_CACHE,
    });

    const total_count = allResources.length;
    const resources = allResources.slice(params.offset, params.offset + params.limit);
    const has_more = params.offset + params.limit < total_count;

    return ok(
      {
        language: params.language,
        total_count,
        has_more,
        limit: params.limit,
        offset: params.offset,
        resources,
        requestId,
      },
      `${resources.length} of ${total_count} resources for ${params.language}`,
    );
  },
};
