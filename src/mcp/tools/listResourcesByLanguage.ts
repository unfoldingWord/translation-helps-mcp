/**
 * list_resources_by_language — alias for list_resources_for_language.
 *
 * Models that were trained on v1 names may call this with the old name.
 * This alias delegates directly to the same implementation so both names work.
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
});

const outputSchema = {
  language: z.string(),
  total: z.number(),
  resources: z.array(
    z
      .object({
        subject: z.string().optional(),
        organization: z.string().optional(),
        zipUrl: z.string().optional(),
      })
      .passthrough(),
  ),
  requestId: z.string(),
};

export const listResourcesByLanguageTool: ToolModule<typeof inputSchema> = {
  name: "list_resources_by_language",
  description:
    "List all translation resources available for a specific language code. " +
    "Alias for list_resources_for_language — prefer that tool for new integrations. " +
    "Use this to confirm that a resource type (TN, TW, TA, etc.) exists for a language before calling fetch_* tools. " +
    "Returns an array of resource entries with `subject`, `organization`, and `zipUrl` fields.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "List Resources By Language" },

  async handler(
    params: z.infer<typeof inputSchema>,
    _env: Env,
    requestId: string,
  ) {
    const resources = await dcsList(params.language, {
      subject: params.subject,
      stage: params.stage as "prod" | "preprod" | "latest",
    });

    return ok(
      {
        language: params.language,
        total: resources.length,
        resources,
        requestId,
      },
      `${resources.length} resources for ${params.language}`,
    );
  },
};
