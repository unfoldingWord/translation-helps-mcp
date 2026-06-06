/**
 * list_languages — discover available language codes.
 */

import { z } from "zod";
import { ok, type ToolModule } from "./shared.js";
import { listLanguages as dcsListLanguages } from "../../core/resources/dcsClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      'Optional substring filter on language code or name. E.g. "es" shows Spanish variants.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(9999)
    .default(50)
    .describe("Maximum number of results to return (default 50). Pass a high value to get all."),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination (default 0)."),
});

const outputSchema = {
  total_count: z.number().describe("Total number of matching languages before pagination."),
  has_more: z.boolean().describe("True if more results exist beyond this page."),
  limit: z.number(),
  offset: z.number(),
  languages: z.array(
    z.object({
      code: z.string(),
      name: z.string().optional(),
    }),
  ),
  requestId: z.string(),
};

export const listLanguagesTool: ToolModule<typeof inputSchema> = {
  name: "list_languages",
  description:
    "List language codes available in the Door43 catalog for unfoldingWord resources. " +
    "Use this to discover valid BCP-47 codes before calling fetch_* or list_resources_for_language. " +
    "Returns `{ code, name }` entries; use the `filter` parameter to narrow results (e.g. filter \"es\" for Spanish variants). " +
    "Limitation: lists languages that have at least one resource — not all languages have every resource type.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "List Languages" },

  async handler(
    params: z.infer<typeof inputSchema>,
    env: Env,
    requestId: string,
  ) {
    let languages = await dcsListLanguages(env.TRANSLATION_HELPS_CACHE);
    if (params.filter) {
      const f = params.filter.toLowerCase();
      languages = languages.filter(
        (l) =>
          l.code.toLowerCase().includes(f) || l.name?.toLowerCase().includes(f),
      );
    }
    const total_count = languages.length;
    const page = languages.slice(params.offset, params.offset + params.limit);
    const has_more = params.offset + params.limit < total_count;

    return ok(
      { total_count, has_more, limit: params.limit, offset: params.offset, languages: page, requestId },
      `${page.length} of ${total_count} languages`,
    );
  },
};
