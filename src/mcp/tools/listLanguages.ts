/**
 * list_languages — discover available language codes.
 *
 * Backed by GET /api/v1/languages via ApiClient (REST Data API).
 */

import { z } from "zod";
import { ok, withNotAvailableOutput, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      'Optional substring filter on language code, name or English name. E.g. "es" shows Spanish variants; "Bengali" finds bn.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(9999)
    .default(50)
    .describe(
      "Maximum number of results to return (default 50). Pass a high value to get all.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination (default 0)."),
});

/** Success fields are optional so RESOURCE_NOT_AVAILABLE also validates. */
const outputSchema = withNotAvailableOutput({
  total_count: z
    .number()
    .optional()
    .describe("Total number of matching languages before pagination."),
  has_more: z
    .boolean()
    .optional()
    .describe("True if more results exist beyond this page."),
  limit: z.number().optional(),
  offset: z.number().optional(),
  languages: z
    .array(
      z.object({
        code: z.string(),
        name: z
          .string()
          .optional()
          .describe("The language's own name, often in its own script."),
        englishName: z
          .string()
          .optional()
          .describe("English name of the language, when the catalog has one."),
      }),
    )
    .optional(),
  requestId: z.string().optional(),
});

export const listLanguagesTool: ToolModule<typeof inputSchema> = {
  name: "list_languages",
  description:
    "List language codes available in the Door43 catalog for unfoldingWord resources. " +
    "Use this to discover valid BCP-47 codes before calling get_passage, list_resources, or other tools. " +
    "Returns `{ code, name, englishName }` entries: `name` is the language's own name, often in its own script, and `englishName` its English name. " +
    'Use the `filter` parameter to narrow results by code or by either name (e.g. filter "es" for Spanish variants, "Bengali" for bn). ' +
    "Limitation: lists languages that have at least one resource — not all languages have every resource type.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "List Languages" },

  async handler(
    params: z.infer<typeof inputSchema>,
    env: Env,
    requestId: string,
  ) {
    const client = new ApiClient(env);
    const data = await client.get<{
      languages: Array<{
        code: string;
        name?: string;
        englishName?: string;
        direction?: string;
      }>;
    }>("/api/v1/languages");

    let languages = data.languages ?? [];
    if (params.filter) {
      const f = params.filter.toLowerCase();
      languages = languages.filter(
        (l) =>
          l.code.toLowerCase().includes(f) ||
          l.name?.toLowerCase().includes(f) ||
          l.englishName?.toLowerCase().includes(f),
      );
    }
    const total_count = languages.length;
    const page = languages.slice(params.offset, params.offset + params.limit);
    const has_more = params.offset + params.limit < total_count;

    return ok(
      {
        total_count,
        has_more,
        limit: params.limit,
        offset: params.offset,
        languages: page.map(({ code, name, englishName }) => ({
          code,
          name,
          ...(englishName ? { englishName } : {}),
        })),
        requestId,
      },
      `${page.length} of ${total_count} languages`,
    );
  },
};
