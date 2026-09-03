/**
 * TypeScript types for Translation Helps MCP Client v2.
 *
 * The server exposes a progressive-disclosure workflow:
 *   1. listLanguages       — orient: discover valid language codes
 *   2. listResources       — orient: resource availability for a language
 *   3. getPassageContext   — orient: scripture versions + intro notes + availability
 *   4. getPassageIndex     — survey: compact index of issues + key terms (no bodies)
 *   5. getNote             — drill: full note body by id
 *   6. getAcademyArticle   — drill: full TA article by path
 *   7. getWordArticle      — drill: full TW article by path
 *   8. getQuestions        — check: comprehension questions for a passage
 *   9. searchArticles      — lateral: concept → article path
 */

export interface ClientOptions {
  /** MCP server URL (default: https://translation-helps-mcp-v2.workers.dev/mcp) */
  serverUrl?: string;
  /** Request timeout in ms (default: 90000) */
  timeout?: number;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
}

/** Tool names exposed on the MCP surface (13 tools) */
export type ToolName =
  | "list_languages"
  | "list_resources"
  | "get_passage"
  | "get_passage_context"
  | "get_passage_index"
  | "get_note"
  | "get_academy_article"
  | "get_word_article"
  | "get_questions"
  | "search_articles"
  // OBS tools
  | "get_obs_story"
  | "get_obs_notes"
  | "get_obs_questions";

/**
 * MCP tool call result.
 *
 * Prefer `structuredContent` when present (MCP 2025-06-18+). Older clients
 * that only read `content` still get a JSON text fallback from the server.
 *
 * Soft not-available responses use `isError: false` with
 * `code: "RESOURCE_NOT_AVAILABLE"` in structuredContent / content JSON.
 */
export interface MCPToolResult {
  content: Array<{ type: "text"; text: string }>;
  /** Authoritative structured payload when the server provides it */
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Soft-NA envelope when a resource does not exist for the request (isError: false). */
export interface ResourceNotAvailable {
  available: false;
  code: "RESOURCE_NOT_AVAILABLE";
  message: string;
  hints?: string[];
}

/** True when parsed tool data is a soft resource-not-available result. */
export function isResourceNotAvailable(
  data: unknown,
): data is ResourceNotAvailable {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.available === false && d.code === "RESOURCE_NOT_AVAILABLE";
}

/**
 * Prefer `structuredContent`, else parse JSON from `content` text items.
 */
export function getStructuredContent<T = unknown>(
  result: MCPToolResult,
): T | undefined {
  if (result.structuredContent !== undefined) {
    return result.structuredContent as T;
  }
  try {
    return parseResult<T>(result);
  } catch {
    return undefined;
  }
}

/** Extract and parse the structured JSON from a tool result. */
export function parseResult<T = unknown>(result: MCPToolResult): T {
  if (result.structuredContent !== undefined) {
    return result.structuredContent as T;
  }
  for (const item of result.content) {
    if (item.type === "text") {
      try {
        return JSON.parse(item.text) as T;
      } catch {
        /* try next */
      }
    }
  }
  throw new Error("No parseable JSON in tool result");
}

// ---------------------------------------------------------------------------
// Workflow tool option types
// ---------------------------------------------------------------------------

export interface ListLanguagesOptions {
  /** Substring filter on language code or name */
  filter?: string;
  /** Max results (default 50). Pass a high value to get all. */
  limit?: number;
  /** Results to skip for pagination (default 0) */
  offset?: number;
}

export interface ListResourcesOptions {
  /** BCP-47 language code (required) */
  language: string;
  /**
   * Optional USFM book code or name (e.g. "TIT").
   * Filters out book-scoped resources whose ingredients omit this book.
   */
  book?: string;
  /** Optional passage reference; book is extracted like `book`. */
  reference?: string;
}

export interface GetPassageOptions {
  /**
   * Bible passage reference: "JHN 3:16", "MAT 5:3-12", "GEN 1"
   * Returns all scripture versions (literal, simplified, original) for the reference.
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** "text" = plain prose (default), "usfm" = raw USFM markup */
  format?: "text" | "usfm";
}

export interface GetPassageContextOptions {
  /**
   * Bible passage reference: "JHN 3:16", "MAT 5:3-12", "GEN 1" — or a bare
   * book name/code ("TIT", "Titus") to get only the book overview (front:intro).
   * Returns book/chapter intro notes + resource availability (NOT verse text — use getPassage).
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
}

export interface GetPassageIndexOptions {
  /**
   * Bible passage reference: "JHN 3:16", "MAT 5:3-12", "GEN 1"
   * A chapter ref returns all verse-level notes in the chapter.
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /**
   * When true, skip the notes fetch and return empty notes[]/issues[].
   * Use when getNote was already called in the same turn — only word-links needed.
   */
  skipNotes?: boolean;
}

export interface GetNoteOptions {
  /**
   * Bible passage reference: "JHN 3:16"
   * Required to locate the correct TSV file.
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /**
   * Specific note ID from get_passage_index (e.g. "abc123").
   * Omit to return all verse-level notes for the reference (unless `phrase` is set).
   */
  id?: string;
  /**
   * Strategic-language word/phrase to match against note quote or body
   * (case-insensitive). Use when the user asks about a specific phrase.
   */
  phrase?: string;
}

export interface GetAcademyArticleOptions {
  /**
   * Translation Academy article path from a note's taArticle.path
   * field, e.g. "translate/figs-metaphor".
   */
  path: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
}

export interface GetWordArticleOptions {
  /**
   * Translation Words article path from a word-link's twArticle.path
   * field, e.g. "bible/kt/grace".
   */
  path: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
}

export interface GetQuestionsOptions {
  /**
   * Bible passage reference: "JHN 3:16", "MAT 5:3-12"
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
}

export interface SearchArticlesOptions {
  /** Concept, term, or phrase to search for */
  query: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /**
   * Comma-separated resource types: "ta", "tw", or "ta,tw" (default all).
   * Matches the MCP `types` parameter.
   */
  types?: string;
  /** Max results (default 10, max 30). Matches the MCP `limit` parameter. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// OBS tool option types
// ---------------------------------------------------------------------------

export interface GetObsStoryOptions {
  /**
   * OBS story:frame reference.
   * Examples: "1:1" (single frame), "3:1-3" (frames 1–3 inclusive), "3" (whole story),
   * "1:0" (story title), "front" (front matter). Optional "OBS" prefix ("OBS 3:1-3").
   * Story numbers 1–50; frames are 1-indexed.
   */
  reference: string;
  /**
   * BCP-47 language code (default: "en").
   * ISO 639-2/639-3 aliases accepted (e.g. "spa" → "es", may resolve to "es-419").
   */
  language?: string;
}

export interface GetObsNotesOptions {
  /**
   * OBS story:frame reference.
   * Examples: "1:1" (single frame), "3:1-3" (frames 1–3 inclusive), "3" (whole story),
   * "1:0" (story title), "front" (front matter). Optional "OBS" prefix ("OBS 3:1-3").
   */
  reference: string;
  /**
   * BCP-47 language code (default: "en").
   * ISO 639-2/639-3 aliases accepted (e.g. "spa" → "es", may resolve to "es-419").
   */
  language?: string;
}

export interface GetObsQuestionsOptions {
  /**
   * OBS story:frame reference.
   * Examples: "1:1" (single frame), "3:1-3" (frames 1–3 inclusive), "3" (whole story),
   * "1:0" (story title), "front" (front matter). Optional "OBS" prefix ("OBS 3:1-3").
   */
  reference: string;
  /**
   * BCP-47 language code (default: "en").
   * ISO 639-2/639-3 aliases accepted (e.g. "spa" → "es", may resolve to "es-419").
   */
  language?: string;
}
