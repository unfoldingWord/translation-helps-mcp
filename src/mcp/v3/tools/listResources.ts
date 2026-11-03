/**
 * v3 th_list_resources — languages, or what one language has.
 *
 * No language: GET /api/v1/languages, the v2 list_languages handler
 * (filter, limit, offset).
 * With a language: GET /api/v1/resources, the v2 list_resources handler.
 * A reference is reduced to its book before Zod sees the arguments.
 */

import { z } from "zod";
import type { Env } from "../../agent.js";
import { listLanguagesTool } from "../../tools/listLanguages.js";
import { listResourcesTool } from "../../tools/listResources.js";
import {
  ok,
  resourceAvailabilityItemSchema,
  withNotAvailableOutput,
  type ToolModule,
  type ToolResult,
} from "../../tools/shared.js";

export const LIST_RESOURCES_DESCRIPTION =
  'Without language, lists the languages that have resources, with their code, own name and English name. Use filter to find one ("es", "Bengali") and pass its code to the other tools. With language, lists which resources that language has (Bible versions, notes, questions, word links, Translation Words and Academy, Open Bible Stories and its helps) with their abbreviations; with book, only those that cover that book. Use it to find a language code, or to check what exists before telling a user that a resource is missing.';

const inputSchema = z.object({
  language: z
    .string()
    .min(2)
    .optional()
    .describe(
      'Language code (BCP-47) of the resources to read, e.g. "en", "es-419", "hi". Use the language the user asked for or writes in; do not fall back to "en" when they want another language. Omit it to list language codes instead of resources.',
    ),
  book: z
    .string()
    .min(2)
    .max(20)
    .optional()
    .describe(
      'Optional USFM book code or name (for example "TIT" or "Jonah"). Limits the list to resources that cover that book.',
    ),
  filter: z
    .string()
    .optional()
    .describe(
      'When listing languages (no `language`): substring of the code, name or English name. For example "es" or "Bengali".',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(9999)
    .optional()
    .describe(
      "When listing languages: maximum rows (default 50). total, has_more and next_offset describe the page. Ignored when language is set.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "When listing languages: rows to skip (default 0). Pass next_offset back here. Ignored when language is set.",
    ),
});

const outputSchema = {
  ...withNotAvailableOutput({
    total: z
      .number()
      .optional()
      .describe(
        "How many languages match, before this page. Present on the language list.",
      ),
    has_more: z
      .boolean()
      .optional()
      .describe("True when another page of languages remains."),
    next_offset: z
      .number()
      .optional()
      .describe(
        "Pass this as offset to read the next page of languages. Absent on the last page.",
      ),
    limit: z.number().optional(),
    offset: z.number().optional(),
    languages: z
      .array(
        z.object({
          code: z.string(),
          name: z.string().optional(),
          englishName: z.string().optional(),
        }),
      )
      .optional(),
    language: z.string().optional(),
    requestedLanguage: z.string().optional(),
    book: z.string().optional(),
    resources: z.array(resourceAvailabilityItemSchema).optional(),
    coverage: z
      .object({
        note: z.string().optional(),
        filteredByBook: z.string().optional(),
      })
      .optional(),
  }),
  available: z
    .union([z.boolean(), z.array(resourceAvailabilityItemSchema)])
    .optional(),
};

export const listResourcesV3Tool: ToolModule<typeof inputSchema> = {
  name: "th_list_resources",
  description: LIST_RESOURCES_DESCRIPTION,
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    title: "List Resources",
  },

  async handler(params, env: Env, requestId: string) {
    if (!params.language?.trim()) {
      return publishList(
        renameLanguagePage(
          await listLanguagesTool.handler(
            {
              filter: params.filter,
              limit: params.limit ?? 50,
              offset: params.offset ?? 0,
            },
            env,
            requestId,
          ),
        ),
      );
    }
    return publishList(
      await listResourcesTool.handler(
        {
          language: params.language,
          ...(params.book ? { book: params.book } : {}),
        },
        env,
        requestId,
      ),
    );
  },
};

/**
 * The language list uses the same paging names as the other v3 tools.
 * `total_count` stays on the v2 list_languages tool.
 */
function renameLanguagePage(result: ToolResult): ToolResult {
  const data = { ...(result.structuredContent ?? {}) };
  if (typeof data.total_count === "number") {
    const total = data.total_count;
    const offset = typeof data.offset === "number" ? data.offset : 0;
    const page = Array.isArray(data.languages) ? data.languages.length : 0;
    data.total = total;
    delete data.total_count;
    if (data.has_more === true) data.next_offset = offset + page;
  }
  return { ...result, structuredContent: data };
}

/** requestId is a log id. The model sees the same payload without it. */
function publishList(result: ToolResult): ToolResult {
  const data = { ...(result.structuredContent ?? {}) };
  delete data.requestId;
  const human = result.content.find(
    (part) => !part.text.trim().startsWith("{"),
  )?.text;
  const next = ok(data, human);
  if (result.cacheStatus) next.cacheStatus = result.cacheStatus;
  return next;
}
