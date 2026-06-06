/**
 * TypeScript types for Translation Helps MCP Client v2.
 *
 * The server exposes a progressive-disclosure workflow:
 *   1. listLanguages       — orient: discover valid language codes
 *   2. getPassageContext   — orient: scripture versions + intro notes + availability
 *   3. getPassageIndex     — survey: compact index of issues + key terms (no bodies)
 *   4. getNote             — drill: full note body by id
 *   5. getAcademyArticle   — drill: full TA article by path
 *   6. getWordArticle      — drill: full TW article by path
 *   7. getQuestions        — check: comprehension questions for a passage
 *   8. searchArticles      — lateral: concept → article path
 */

export interface ClientOptions {
  /** MCP server URL (default: https://translation-helps-mcp.workers.dev/mcp) */
  serverUrl?: string;
  /** Request timeout in ms (default: 90000) */
  timeout?: number;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
}

/** Workflow tool names exposed on the MCP surface */
export type WorkflowToolName =
  | "list_languages"
  | "get_passage"
  | "get_passage_context"
  | "get_passage_index"
  | "get_note"
  | "get_academy_article"
  | "get_word_article"
  | "get_questions"
  | "search_articles";

/** Legacy tool names kept for ContextHarness / backward compatibility */
export type LegacyToolName =
  | "fetch_scripture"
  | "fetch_translation_notes"
  | "fetch_translation_questions"
  | "fetch_translation_word_links"
  | "fetch_translation_word"
  | "fetch_translation_academy"
  | "list_subjects"
  | "list_resources_for_language"
  | "list_resources_by_language"
  | "list_translation_academy"
  | "list_translation_words"
  | "get_bundle";

export type ToolName = WorkflowToolName | LegacyToolName;

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
// Workflow tool option types (new progressive-disclosure surface)
// ---------------------------------------------------------------------------

export interface ListLanguagesOptions {
  /** Substring filter on language code or name */
  filter?: string;
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
   * Bible passage reference: "JHN 3:16", "MAT 5:3-12", "GEN 1"
   * Returns book/chapter intro notes + resource availability (NOT verse text — use getPassage).
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Organization slug (default: "unfoldingWord") */
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
  /** Organization slug (default: "unfoldingWord") */
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
  /** Organization slug (default: "unfoldingWord") */
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
  /** Organization slug (default: "unfoldingWord") */
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
  /** Organization slug (default: "unfoldingWord") */
  organization?: string;
}

export interface GetQuestionsOptions {
  /**
   * Bible passage reference: "JHN 3:16", "MAT 5:3-12"
   */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Organization slug (default: "unfoldingWord") */
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
// Legacy tool option types — kept for backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use GetPassageOptions instead */
export interface FetchScriptureOptions {
  reference: string;
  language?: string;
  organization?: string;
  format?: "text" | "usfm";
}

/** @deprecated Use GetNoteOptions instead */
export interface FetchTranslationNotesOptions {
  reference: string;
  language?: string;
  organization?: string;
}

/** @deprecated Use GetQuestionsOptions instead */
export interface FetchTranslationQuestionsOptions {
  reference: string;
  language?: string;
  organization?: string;
}

/** @deprecated Use GetPassageIndexOptions instead */
export interface FetchTranslationWordLinksOptions {
  reference: string;
  language?: string;
  organization?: string;
}

/** @deprecated Use GetWordArticleOptions instead */
export interface FetchTranslationWordOptions {
  path?: string;
  term?: string;
  language?: string;
  organization?: string;
}

/** @deprecated Use GetAcademyArticleOptions instead */
export interface FetchTranslationAcademyOptions {
  path: string;
  language?: string;
  organization?: string;
}

export interface ListSubjectsOptions {}

export interface ListResourcesForLanguageOptions {
  language: string;
  subject?: string;
  organization?: string;
  stage?: "prod" | "preprod" | "latest";
}

/** @deprecated Use GetPassageContextOptions + getPassageIndex instead */
export interface GetBundleOptions {
  reference: string;
  language?: string;
  includeScripture?: boolean;
  includeNotes?: boolean;
  includeWords?: boolean;
}

export interface ListTranslationAcademyOptions {
  language?: string;
  category?: string;
}

export interface ListTranslationWordsOptions {
  language?: string;
  category?: "kt" | "other" | "names";
}
