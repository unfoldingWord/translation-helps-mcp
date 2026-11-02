/**
 * Argument normalization for /v3/mcp, before Zod sees the tool schema.
 *
 * v2's normalizeToolArgs stays as it is: get_passage there is Bible-only, so
 * Class O does not run for that name. v3 tools share those names and accept
 * Bible and OBS, so this function is the one the v3 server applies.
 */

import { normalizeToolArgs } from "../normalizeToolArgs.js";
import { readReference } from "./readReference.js";

export function normalizeV3ToolArgs(
  toolName: string,
  rawArgs: unknown,
): Record<string, unknown> {
  if (toolName !== "get_passage" && toolName !== "get_questions") {
    return normalizeToolArgs(toolName, rawArgs);
  }

  // Class D (language_code / lang → language) without Class C or Class O.
  const base = normalizeToolArgs("list_languages", rawArgs);
  const language =
    typeof base.language === "string" ? base.language : undefined;
  const read = readReference(rawArgs, language);
  const kind = toolName === "get_questions" ? questionKind(rawArgs) : undefined;

  if (!read.ok) {
    return {
      reference: `\u0000${read.message}`,
      ...(language !== undefined ? { language } : {}),
      ...(kind !== undefined ? { kind } : {}),
    };
  }

  return {
    reference: read.value.reference,
    ...(language !== undefined ? { language } : {}),
    ...(kind !== undefined ? { kind } : {}),
  };
}

function questionKind(rawArgs: unknown): unknown {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return undefined;
  }
  if (!("kind" in rawArgs)) return undefined;
  return rawArgs.kind;
}
