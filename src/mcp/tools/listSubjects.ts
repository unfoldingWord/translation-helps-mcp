/**
 * list_subjects — discover resource subject types in the catalog.
 */

import { z } from "zod";
import { ok, type ToolModule } from "./shared.js";
import { listSubjects as dcsListSubjects } from "../../core/resources/dcsClient.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({});

export const listSubjectsTool: ToolModule<typeof inputSchema> = {
  name: "list_subjects",
  description:
    "List all resource subject types available in the Door43 catalog " +
    '(e.g. "Aligned Bible", "Translation Notes", "Translation Academy"). ' +
    "Use to understand what resource categories exist before calling list_resources_for_language.",
  inputSchema,
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
