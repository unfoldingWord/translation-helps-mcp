/**
 * RC-link resolution utilities.
 *
 * Parses rc:// URIs from unfoldingWord resources and converts them to
 * the concrete paths expected by MCP tool parameters.
 *
 * URI format: rc://{lang}/{resource}/{type}/{path...}
 *   - lang may be "*" (wildcard = any language)
 *   - resource: ult, ust, tn, tw, ta, tq, twl, obs, …
 *   - type: book, help, dict, man, bundle
 *
 * Examples:
 *   rc://en/ult/book/gen/01/02           -> ULT Genesis 1:2
 *   rc://{star}/ta/man/translate/figs-metaphor -> TA article
 *   rc://{star}/tw/dict/bible/kt/god     -> TW article
 *   rc://en/tn/help/gen/01/02            -> TN at reference
 */

export interface RcLink {
  lang: string;       // "*" for wildcard
  resource: string;   // ult, ust, tn, tw, ta, tq, twl, …
  type: string;       // book, help, dict, man, bundle
  path: string;       // rest of the path after type
  raw: string;        // original URI
}

/**
 * Parse an rc:// URI into its components.
 * Returns null for malformed / non-rc URIs.
 */
export function parseRcLink(uri: string): RcLink | null {
  if (!uri || !uri.startsWith("rc://")) return null;
  // Strip leading "rc://"
  const rest = uri.slice(5);
  // rc://{lang}/{resource}/{type}/{...path}
  const parts = rest.split("/");
  if (parts.length < 4) return null;
  const [lang, resource, type, ...pathParts] = parts;
  return {
    lang: lang ?? "*",
    resource: resource ?? "",
    type: type ?? "",
    path: pathParts.join("/"),
    raw: uri,
  };
}

/**
 * Convert a TA SupportReference rc:// link to the article path expected
 * by fetch_translation_academy.
 *
 * "rc://{star}/ta/man/translate/figs-metaphor" -> "translate/figs-metaphor"
 * "rc://en/ta/man/checking/accuracy"           -> "checking/accuracy"
 *
 * Returns null if the URI doesn't resolve to a TA article.
 */
export function rcToTaPath(uri: string): string | null {
  const rc = parseRcLink(uri);
  if (!rc) return null;
  if (rc.resource !== "ta" || rc.type !== "man") return null;
  // path is everything after "man/" e.g. "translate/figs-metaphor"
  return rc.path || null;
}

/**
 * Convert a TWL TWLink rc:// URI to the article path expected
 * by fetch_translation_word.
 *
 * "rc://{star}/tw/dict/bible/kt/grace"    -> "bible/kt/grace"
 * "rc://{star}/tw/dict/bible/other/sheep" -> "bible/other/sheep"
 *
 * Returns null if the URI doesn't resolve to a TW article.
 */
export function rcToTwPath(uri: string): string | null {
  const rc = parseRcLink(uri);
  if (!rc) return null;
  if (rc.resource !== "tw" || rc.type !== "dict") return null;
  return rc.path || null;
}

/**
 * Extract all unique TA article paths from an array of TN SupportReferences.
 * Deduplicates and skips non-TA links.
 */
export function extractTaPathsFromNotes(
  supportReferences: (string | undefined | null)[],
): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const ref of supportReferences) {
    if (!ref) continue;
    const path = rcToTaPath(ref.trim());
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Extract all unique TW article paths from an array of TWL TWLink values.
 * Deduplicates and skips non-TW links.
 */
export function extractTwPathsFromLinks(
  twLinks: (string | undefined | null)[],
): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const link of twLinks) {
    if (!link) continue;
    const path = rcToTwPath(link.trim());
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}
