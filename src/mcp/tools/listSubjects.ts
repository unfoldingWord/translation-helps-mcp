/**
 * list_subjects — discover resource subject types in the catalog.
 */

import { z } from "zod";
import { ok, type ToolModule } from "./shared.js";
import { listSubjects as dcsListSubjects } from "../../core/resources/dcsClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({});

const outputSchema = {
  total: z.number(),
  subjects: z.array(z.string()),
  requestId: z.string(),
};

export const listSubjectsTool: ToolModule<typeof inputSchema> = {
  name: "list_subjects",
  description:
    "List all resource subject types available in the Door43 catalog. " +
    'Returns string labels such as "Aligned Bible", "Translation Notes", "Translation Academy", "Translation Words". ' +
    "Use this to understand what resource categories exist and to construct valid `subject` filter values for list_resources_for_language. " +
    "Takes no parameters. Limitation: subject names are in English regardless of the requested language.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "List Subjects" },

  async handler(
    _params: z.infer<typeof inputSchema>,
    _env: Env,
    requestId: string,
  ) {
    const subjects = await dcsListSubjects();
    return ok({ total: subjects.length, subjects, requestId });
  },
};
