/**
 * TypeScript types for Translation Helps MCP Client v2.
 */

export interface ClientOptions {
  /** MCP server URL (default: https://translation-helps-mcp.workers.dev/mcp) */
  serverUrl?: string;
  /** Request timeout in ms (default: 90000) */
  timeout?: number;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
}

export type ToolName =
  | "fetch_scripture"
  | "fetch_translation_notes"
  | "fetch_translation_questions"
  | "fetch_translation_word_links"
  | "fetch_translation_word"
  | "fetch_translation_academy"
  | "list_languages"
  | "list_subjects"
  | "list_resources_for_language"
  | "rag_query"
  | "get_bundle"
  | "index_resource";

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
// Tool option types — one interface per tool
// ---------------------------------------------------------------------------

export interface FetchScriptureOptions {
  /** Bible passage: "JHN 3:16", "MAT 5:3-12", "GEN 1:1" */
  reference: string;
  /** BCP-47 language code (default: "en") */
  language?: string;
  /** Organization (default: "unfoldingWord") */
  organization?: string;
  /** Resource type: "ult" | "ust" | "glt" | "gst" (default: "ult") */
  resourceType?: "ult" | "ust" | "glt" | "gst";
  /** Output format: "text" | "usfm" (default: "text") */
  format?: "text" | "usfm";
}

export interface FetchTranslationNotesOptions {
  reference: string;
  language?: string;
  organization?: string;
}

export interface FetchTranslationQuestionsOptions {
  reference: string;
  language?: string;
  organization?: string;
}

export interface FetchTranslationWordLinksOptions {
  reference: string;
  language?: string;
  organization?: string;
}

export interface FetchTranslationWordOptions {
  /** Exact word path from fetch_translation_word_links, e.g. "bible/kt/grace" */
  path?: string;
  /** Fallback word or phrase — use path when available */
  term?: string;
  language?: string;
  organization?: string;
}

export interface FetchTranslationAcademyOptions {
  /** Article path, e.g. "translate/figs-metaphor" */
  path: string;
  language?: string;
  organization?: string;
}

export interface ListLanguagesOptions {
  /** Substring filter on language code or name */
  filter?: string;
}

export interface ListSubjectsOptions {}

export interface ListResourcesForLanguageOptions {
  language: string;
  subject?: string;
  organization?: string;
  stage?: "prod" | "preprod" | "latest";
}

export interface RagQueryOptions {
  query: string;
  reference?: string;
  language?: string;
  resourceTypes?: Array<"tn" | "tw" | "ta" | "tq">;
  topK?: number;
  enableRerank?: boolean;
}

export interface GetBundleOptions {
  reference: string;
  language?: string;
  organization?: string;
  includeScripture?: boolean;
  includeNotes?: boolean;
  includeWords?: boolean;
  includeQuestions?: boolean;
}

export interface IndexResourceOptions {
  language: string;
  subject: string;
  organization?: string;
  stage?: "prod" | "preprod" | "latest";
  adminToken: string;
}
