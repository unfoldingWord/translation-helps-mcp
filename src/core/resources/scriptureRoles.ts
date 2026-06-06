/**
 * src/core/resources/scriptureRoles.ts
 *
 * Maps scripture resource abbreviations to human-meaningful roles.
 * Used by /scripture endpoint and get_passage_context MCP tool.
 */
import type { ScriptureVersionRole } from "../contracts/index.js";

/** Known literal / formal-equivalent abbreviations → role "literal" */
const LITERAL_ABBREVS = new Set(["ult", "glt", "udb", "ub"]);

/** Known simplified / meaning-based abbreviations → role "simplified" */
const SIMPLIFIED_ABBREVS = new Set(["ust", "gst"]);

/**
 * Resolve the semantic role of a scripture version from its catalog abbreviation.
 * Original-language texts should be pre-tagged as "original" before calling this.
 */
export function resolveScriptureVersionRole(abbrev: string): ScriptureVersionRole {
  const lower = abbrev.toLowerCase();
  if (LITERAL_ABBREVS.has(lower)) return "literal";
  if (SIMPLIFIED_ABBREVS.has(lower)) return "simplified";
  // Heuristic: if it ends with "lt" it's likely a literal translation
  if (lower.endsWith("lt")) return "literal";
  if (lower.endsWith("st")) return "simplified";
  return "other";
}
