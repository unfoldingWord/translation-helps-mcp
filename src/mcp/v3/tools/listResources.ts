/**
 * v3 th_list_resources — languages, or what one language has.
 *
 * No language: GET /api/v1/languages, the v2 list_languages handler
 * (filter, limit, offset).
 * With a language: GET /api/v1/resources, the v2 list_resources handler
 * (book or reference).
 */

import { z } from "zod";
import type { Env } from "../../agent.js";
import { listLanguagesTool } from "../../tools/listLanguages.js";
import { listResourcesTool } from "../../tools/listResources.js";
import {
  resourceAvailabilityItemSchema,
  withNotAvailableOutput,
  type ToolModule,
} from "../../tools/shared.js";

/** Proposal text, unchanged. filter / limit / offset are parameter docs. */
export const LIST_RESOURCES_DESCRIPTION =
  "Without a language: the languages available. With one: what it has, optionally for one book.";

const inputSchema = z.object({
  language: z
    .string()
    .min(2)
    .optional()
    .describe(
      "BCP-47 language code. Omit it to list languages instead of resources.",
    ),
  book: z
    .string()
    .min(2)
    .max(20)
    .optional()
    .describe(
      'Optional USFM book code or name (for example "TIT"). Filters book-scoped resources.',
    ),
  reference: z
    .string()
    .min(2)
    .optional()
    .describe(
      'Optional passage reference (for example "TIT 1:1"). The book is used like `book`.',
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
      "When listing languages: maximum rows (default 50). Ignored when `language` is set.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "When listing languages: rows to skip (default 0). Ignored when `language` is set.",
    ),
});

const outputSchema = {
  ...withNotAvailableOutput({
    total_count: z.number().optional(),
    has_more: z.boolean().optional(),
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
    requestId: z.string().optional(),
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
      return listLanguagesTool.handler(
        {
          filter: params.filter,
          limit: params.limit ?? 50,
          offset: params.offset ?? 0,
        },
        env,
        requestId,
      );
    }
    return listResourcesTool.handler(
      {
        language: params.language,
        ...(params.book ? { book: params.book } : {}),
        ...(params.reference ? { reference: params.reference } : {}),
      },
      env,
      requestId,
    );
  },
};
