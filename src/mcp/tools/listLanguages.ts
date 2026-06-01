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
});

export const listLanguagesTool: ToolModule<typeof inputSchema> = {
  name: "list_languages",
  description:
    "List all language codes available in the Door43 catalog. " +
    "Use this to find valid language codes before calling other tools.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "List Languages" },

  async handler(
    params: z.infer<typeof inputSchema>,
    _env: Env,
    requestId: string,
  ) {
    let languages = await dcsListLanguages();
    if (params.filter) {
      const f = params.filter.toLowerCase();
      languages = languages.filter(
        (l) =>
          l.code.toLowerCase().includes(f) || l.name?.toLowerCase().includes(f),
      );
    }
    return ok(
      { total: languages.length, languages, requestId },
      `${languages.length} languages found`,
    );
  },
};
