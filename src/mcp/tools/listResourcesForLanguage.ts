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
  organization: z
    .string()
    .optional()
    .describe("Filter by organization. Default: all."),
  stage: z
    .enum(["prod", "preprod", "latest"])
    .default("prod")
    .describe(
      '"prod" = stable releases (default), "preprod" = release candidates, "latest" = development.',
    ),
});

export const listResourcesForLanguageTool: ToolModule<typeof inputSchema> = {
  name: "list_resources_for_language",
  description:
    "List all translation resources available for a specific language code. " +
    "Returns subjects, organizations, and zip URLs. " +
    "Use this to confirm a resource exists before calling fetch_* tools.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "List Resources For Language" },

  async handler(
    params: z.infer<typeof inputSchema>,
    _env: Env,
    requestId: string,
  ) {
    const resources = await dcsList(params.language, {
      subject: params.subject,
      organization: params.organization,
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
