/**
 * Sanitize article paths used for TW/TA zip lookups and MCP tools.
 *
 * Rejects path traversal (`..`), absolute paths, control characters, and
 * anything outside a conservative allowlist so zip entry lookups cannot
 * escape the intended article tree.
 */

import { TranslationHelpsError, ErrorCode } from "./errors.js";

/** Max length for a relative article path (segments + slashes). */
export const MAX_ARTICLE_PATH_LENGTH = 256;

/**
 * Safe relative path: letters, digits, underscore, slash, dot, hyphen.
 * Must start with an alphanumeric character (no leading `/` or `.`).
 */
const SAFE_ARTICLE_PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/;

export function isSafeArticlePath(path: string): boolean {
  try {
    assertSafeArticlePath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and normalize an article path.
 * Returns the trimmed path on success; throws TranslationHelpsError otherwise.
 */
export function assertSafeArticlePath(raw: string): string {
  if (typeof raw !== "string") {
    throw invalidArticlePath(String(raw), "Path must be a string");
  }

  let path = raw.trim();
  if (!path) {
    throw invalidArticlePath(raw, "Path must not be empty");
  }

  // Decode once if percent-encoded (URL route params may already be decoded).
  if (/%[0-9A-Fa-f]{2}/.test(path)) {
    try {
      path = decodeURIComponent(path);
    } catch {
      throw invalidArticlePath(raw, "Path contains invalid percent-encoding");
    }
    path = path.trim();
  }

  if (path.length > MAX_ARTICLE_PATH_LENGTH) {
    throw invalidArticlePath(
      raw,
      `Path exceeds ${MAX_ARTICLE_PATH_LENGTH} characters`,
    );
  }

  // Control chars U+0000–U+001F and DEL — intentional allowlist enforcement.
  // eslint-disable-next-line no-control-regex -- reject ASCII control characters in paths
  if (/[\x00-\x1f\x7f]/.test(path)) {
    throw invalidArticlePath(raw, "Path must not contain control characters");
  }

  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-zA-Z]:/.test(path)
  ) {
    throw invalidArticlePath(raw, "Absolute paths are not allowed");
  }

  if (path.includes("\\")) {
    throw invalidArticlePath(raw, "Backslashes are not allowed");
  }

  if (!SAFE_ARTICLE_PATH_RE.test(path)) {
    throw invalidArticlePath(
      raw,
      "Path may only contain letters, digits, underscore, slash, dot, and hyphen",
    );
  }

  const segments = path.split("/");
  for (const seg of segments) {
    if (!seg) {
      throw invalidArticlePath(raw, "Empty path segments are not allowed");
    }
    if (seg === "." || seg === "..") {
      throw invalidArticlePath(raw, "Path traversal segments are not allowed");
    }
  }

  return path;
}

/**
 * Sanitize for API/MCP use. Returns `{ ok: true, path }` or `{ ok: false, error }`.
 */
export function sanitizeArticlePath(
  raw: string,
): { ok: true; path: string } | { ok: false; error: TranslationHelpsError } {
  try {
    return { ok: true, path: assertSafeArticlePath(raw) };
  } catch (e) {
    if (e instanceof TranslationHelpsError) {
      return { ok: false, error: e };
    }
    return {
      ok: false,
      error: invalidArticlePath(String(raw), "Invalid article path"),
    };
  }
}

function invalidArticlePath(
  path: string,
  reason: string,
): TranslationHelpsError {
  return new TranslationHelpsError({
    code: ErrorCode.INVALID_PARAMS,
    message: `Invalid article path: ${reason}`,
    hints: [
      {
        message:
          'Use a relative path from search/index results, e.g. "bible/kt/god" or "translate/figs-metaphor".',
        example: "bible/kt/god",
      },
    ],
    context: { path },
  });
}
