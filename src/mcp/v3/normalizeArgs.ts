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
const INDEX = "th_get_passage_index";
const NOTES = "th_get_notes";

const REFERENCE_TOOLS = new Set([PASSAGE, QUESTIONS, INDEX, NOTES]);

/** Fields the reader does not own, copied through after it rebuilds the args. */
const EXTRA_FIELDS: Record<string, readonly string[]> = {
  [PASSAGE]: ["format"],
  [QUESTIONS]: ["kind"],
  [INDEX]: ["limit", "offset"],
  [NOTES]: ["ids", "id", "phrase", "kind"],
};

export function normalizeV3ToolArgs(
  toolName: string,
  rawArgs: unknown,
): Record<string, unknown> {
  if (!REFERENCE_TOOLS.has(toolName)) {
    return normalizeToolArgs(unprefixed(toolName), rawArgs);
  }

  // Class D (language_code / lang → language) without Class C or Class O.
  const base = normalizeToolArgs("list_languages", rawArgs);
  const language =
    typeof base.language === "string" ? base.language : undefined;
  const read = readReference(rawArgs, language);
  const extras = pickExtras(rawArgs, EXTRA_FIELDS[toolName] ?? []);

  if (!read.ok) {
    return {
      reference: `\u0000${read.message}`,
      ...(language !== undefined ? { language } : {}),
      ...extras,
    };
  }

  return {
    reference: read.value.reference,
    ...(language !== undefined ? { language } : {}),
    ...extras,
  };
}

/** `th_list_resources` → `list_resources`. Other names pass through. */
function unprefixed(toolName: string): string {
  return toolName.startsWith("th_") ? toolName.slice(3) : toolName;
}

function pickExtras(
  rawArgs: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return {};
  }
  const obj = rawArgs as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}
