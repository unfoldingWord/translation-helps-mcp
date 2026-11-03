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
const SEARCH = "th_search";

const REFERENCE_TOOLS = new Set([PASSAGE, QUESTIONS, INDEX, NOTES]);

/** Fields the reader does not own, copied through after it rebuilds the args. */
const EXTRA_FIELDS: Record<string, readonly string[]> = {
  [PASSAGE]: ["format"],
  [QUESTIONS]: ["kind"],
  [INDEX]: ["limit", "offset", "rollupOffset"],
  [NOTES]: ["ids", "id", "phrase", "kind"],
};

export function normalizeV3ToolArgs(
  toolName: string,
  rawArgs: unknown,
): Record<string, unknown> {
  if (toolName === SEARCH) {
    return normalizeSearchType(normalizeToolArgs("list_languages", rawArgs));
  }

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

function aliasString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join(",");
    return joined || undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

/**
 * `type` is the v3 field. `types` and `resourceType` are the v2 names.
 * "ta,tw" means both, so the field is omitted and the search route defaults
 * to every catalog.
 */
function normalizeSearchType(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  const raw =
    aliasString(out.type) ??
    aliasString(out.types) ??
    aliasString(out.resourceType);
  delete out.type;
  delete out.types;
  delete out.resourceType;
  if (!raw) return out;

  const parts = [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (parts.length === 1 && (parts[0] === "tw" || parts[0] === "ta")) {
    out.type = parts[0];
    return out;
  }
  if (
    parts.length > 0 &&
    parts.every((part) => part === "tw" || part === "ta")
  ) {
    return out;
  }
  out.type = raw.toLowerCase();
  return out;
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
