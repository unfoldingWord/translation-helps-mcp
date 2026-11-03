/**
 * Argument normalization for /v3/mcp, before Zod sees the tool schema.
 *
 * v2's tool sets (REFERENCE_TOOLS, OBS_REFERENCE_TOOLS, PATH_TOOLS) do not
 * include the th_ names. get_passage there is Bible-only, so Class O does
 * not run for that name or for th_get_passage. This function recognizes the
 * prefixed v3 names and calls normalizeToolArgs with an unprefixed name:
 * list_languages for Class D, and readReference, which uses get_obs_story
 * and get_passage.
 */

import { normalizeToolArgs } from "../normalizeToolArgs.js";
import { readReference } from "./readReference.js";

const PASSAGE = "th_get_passage";
const QUESTIONS = "th_get_questions";

export function normalizeV3ToolArgs(
  toolName: string,
  rawArgs: unknown,
): Record<string, unknown> {
  if (toolName !== PASSAGE && toolName !== QUESTIONS) {
    return normalizeToolArgs(unprefixed(toolName), rawArgs);
  }

  // Class D (language_code / lang → language) without Class C or Class O.
  const base = normalizeToolArgs("list_languages", rawArgs);
  const language =
    typeof base.language === "string" ? base.language : undefined;
  const read = readReference(rawArgs, language);
  const kind = toolName === QUESTIONS ? questionKind(rawArgs) : undefined;
  const format = toolName === PASSAGE ? passageFormat(rawArgs) : undefined;

  if (!read.ok) {
    return {
      reference: `\u0000${read.message}`,
      ...(language !== undefined ? { language } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(format !== undefined ? { format } : {}),
    };
  }

  return {
    reference: read.value.reference,
    ...(language !== undefined ? { language } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(format !== undefined ? { format } : {}),
  };
}

/** `th_list_resources` → `list_resources`. Other names pass through. */
function unprefixed(toolName: string): string {
  return toolName.startsWith("th_") ? toolName.slice(3) : toolName;
}

function passageFormat(rawArgs: unknown): unknown {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return undefined;
  }
  if (!("format" in rawArgs)) return undefined;
  return rawArgs.format;
}

function questionKind(rawArgs: unknown): unknown {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return undefined;
  }
  if (!("kind" in rawArgs)) return undefined;
  return rawArgs.kind;
}
