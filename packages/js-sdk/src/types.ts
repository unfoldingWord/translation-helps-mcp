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
  /** MCP server URL (default: https://translation-helps-mcp.workers.dev/mcp) */
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

export interface MCPToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Extract and parse the structured JSON from a tool result. */
export function parseResult<T = unknown>(result: MCPToolResult): T {
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
  /** Organization slug (optional; omit to search all owners, prefer UW among hits) */
  organization?: string;
}

export interface GetPassageIndexOptions {
  /**
   * Bible passage reference: "JHN 3:16", "MAT 5:3-12", "GEN 1"
   * A chapter ref returns all verse-level notes in the chapter.
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Organization slug (optional; omit to search all owners, prefer UW among hits) */
  organization?: string;
}

export interface GetNoteOptions {
  /**
   * Bible passage reference: "JHN 3:16"
   * Required to locate the correct TSV file.
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Organization slug (optional; omit to search all owners, prefer UW among hits) */
  organization?: string;
  /**
   * Specific note ID from get_passage_index (e.g. "abc123").
   * Omit to return all verse-level notes for the reference.
   */
  id?: string;
}

export interface GetAcademyArticleOptions {
  /**
   * Translation Academy article path from a note's taArticle.path
   * field, e.g. "translate/figs-metaphor".
   */
  path: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Organization slug (optional; omit to search all owners, prefer UW among hits) */
  organization?: string;
}

export interface GetWordArticleOptions {
  /**
   * Translation Words article path from a word-link's twArticle.path
   * field, e.g. "bible/kt/grace".
   */
  path: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Organization slug (optional; omit to search all owners, prefer UW among hits) */
  organization?: string;
}

export interface GetQuestionsOptions {
  /**
   * Bible passage reference: "JHN 3:16", "MAT 5:3-12"
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Organization slug (optional; omit to search all owners, prefer UW among hits) */
  organization?: string;
}

export interface SearchArticlesOptions {
  /** Concept, term, or phrase to search for */
  query: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Resource types to search: "ta" | "tw" (default: both) */
  resourceTypes?: Array<"ta" | "tw">;
  /** Max results (default: 5) */
  topK?: number;
}

// ---------------------------------------------------------------------------
// OBS tool option types
// ---------------------------------------------------------------------------

export interface GetObsStoryOptions {
  /**
   * OBS story:frame reference, e.g. "1:1" (story 1, frame 1),
   * "1:0" (story 1 title), "front" (front matter).
   * Story numbers run from 1 to 50.
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
}

export interface GetObsNotesOptions {
  /**
   * OBS story:frame reference, e.g. "1:1".
   * Omit the frame to get all notes for a story (e.g. "1").
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
}

export interface GetObsQuestionsOptions {
  /**
   * OBS story:frame reference, e.g. "1:1".
   * Omit the frame to get all questions for a story (e.g. "1").
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
}
