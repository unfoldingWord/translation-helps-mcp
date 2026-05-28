/**
 * Link normalization for Door43 rc:// URIs.
 *
 * rc:// is a URI scheme used in Door43 resource containers to link
 * Translation Word (TW) and Translation Academy (TA) articles.
 *
 * Format: rc://{language}/{type}/{path}
 * Examples:
 *   rc://en/tw/dict/bible/kt/love      → { type: "tw", path: "bible/kt/love" }
 *   rc://en/ta/man/translate/figs-metaphor → { type: "ta", path: "translate/figs-metaphor" }
 *
 * The canonical path strips the language + type prefix so the same article can
 * be found across languages.
 */

export type RcUriType = "tw" | "ta" | "unknown";

export interface ParsedRcUri {
  raw: string;
  language: string;
  type: RcUriType;
  /** canonical path: e.g. "bible/kt/love" or "translate/figs-metaphor" */
  path: string;
}

/**
 * Parse a rc:// URI into its constituent parts.
 *
 * Returns null when the input is not a valid rc:// URI.
 *
 * Canonical path rules:
 * - For tw: strip "rc://{lang}/tw/dict/" → path is everything after "dict/"
 *   e.g. "rc://en/tw/dict/bible/kt/love" → "bible/kt/love"
 * - For ta: strip "rc://{lang}/ta/man/" → path is everything after "man/"
 *   e.g. "rc://en/ta/man/translate/figs-metaphor" → "translate/figs-metaphor"
 * - Unknown types retain the path segment after "/type/" unchanged.
 */
export function parseRcUri(raw: string): ParsedRcUri | null {
  if (!raw || !raw.startsWith("rc://")) {
    return null;
  }

  // Remove the scheme and split: ["", "en", "tw", "dict", "bible", "kt", "love"]
  const withoutScheme = raw.slice("rc://".length); // "en/tw/dict/bible/kt/love"
  const parts = withoutScheme.split("/");

  if (parts.length < 3) {
    return null;
  }

  const [language, rawType, ...rest] = parts;

  if (!language || !rawType) {
    return null;
  }

  let type: RcUriType;
  let path: string;

  if (rawType === "tw") {
    type = "tw";
    // Convention: rc://{lang}/tw/dict/{path}
    // Strip the "dict" segment if present (index 0 of rest).
    const pathParts = rest[0] === "dict" ? rest.slice(1) : rest;
    path = pathParts.join("/");
  } else if (rawType === "ta") {
    type = "ta";
    // Convention: rc://{lang}/ta/man/{path}
    // Strip the "man" segment if present (index 0 of rest).
    const pathParts = rest[0] === "man" ? rest.slice(1) : rest;
    path = pathParts.join("/");
  } else {
    type = "unknown";
    path = rest.join("/");
  }

  if (!path) {
    return null;
  }

  return { raw, language, type, path };
}

/**
 * Extract all rc:// URIs from a text string.
 * Returns an array of canonical paths (deduplicated, stable order).
 */
export function extractRcPaths(text: string): string[] {
  const rcRegex = /rc:\/\/[^\s"')\]>,]+/g;
  const seen = new Set<string>();
  const paths: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = rcRegex.exec(text)) !== null) {
    // Strip trailing punctuation that is commonly attached at sentence end
    const raw = match[0].replace(/[.,;:!?)]+$/, "");
    const parsed = parseRcUri(raw);
    if (parsed && !seen.has(parsed.path)) {
      seen.add(parsed.path);
      paths.push(parsed.path);
    }
  }

  return paths;
}

/**
 * Normalise a Door43 language tag from underscore to BCP 47 hyphen format.
 * Door43 project names use underscores: "es_419", "en_ulb".
 * External APIs use BCP 47 hyphens: "es-419", "en".
 *
 * This is the canonical conversion used throughout the codebase.
 */
export function normalizeLanguageCode(tag: string): string {
  return tag.replace(/_/g, "-");
}

/**
 * Convert a BCP 47 language tag to Door43 underscore format.
 * "es-419" → "es_419"
 */
export function toDoor43LanguageCode(tag: string): string {
  return tag.replace(/-/g, "_");
}
