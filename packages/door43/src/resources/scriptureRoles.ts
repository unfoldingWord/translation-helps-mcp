/**
 * Maps scripture resource abbreviations to human-meaningful roles.
 * Used by /scripture endpoint, list_resources, and get_passage tools.
 */
import type { ScriptureVersionRole } from "../contracts/index.js";

/**
 * Known literal / formal-equivalent abbreviations → role "literal".
 * Includes English ULT/GLT and gateway-language literals (TPL, HGLT, …).
 */
const LITERAL_ABBREVS = new Set([
  "ult",
  "glt",
  "tpl", // Texto Puente Literal (es-419)
  "hglt",
  "udb",
  "ub",
  "ilt",
  "rlt",
]);

/** Known simplified / meaning-based abbreviations → role "simplified" */
const SIMPLIFIED_ABBREVS = new Set(["ust", "gst"]);

/**
 * Resolve the semantic role of a scripture version from its catalog abbreviation.
 * Original-language texts should be pre-tagged as "original" before calling this.
 */
export function resolveScriptureVersionRole(
  abbrev: string,
): ScriptureVersionRole {
  const lower = abbrev.toLowerCase().trim();
  if (!lower) return "other";
  if (LITERAL_ABBREVS.has(lower)) return "literal";
  if (SIMPLIFIED_ABBREVS.has(lower)) return "simplified";
  // Heuristic: gateway literals often end with "lt" (ult, glt, hglt, …)
  if (lower.endsWith("lt")) return "literal";
  // Gateway simplified often end with "st" (ust, gst, …)
  if (lower.endsWith("st")) return "simplified";
  return "other";
}
