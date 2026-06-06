/**
 * Translation Helps MCP Client v2
 *
 * Connects to the Translation Helps MCP server via Streamable HTTP at /mcp.
 * Compatible with MCP SDK 1.x Streamable HTTP transport.
 *
 * ### Progressive-disclosure workflow
 * 1. `listLanguages`     — discover valid language codes
 * 2. `getPassage`        — scripture text (all versions) — cheap, repeatable
 * 3. `getPassageContext` — book/chapter intro notes + resource availability
 * 4. `getPassageIndex`   — compact index of issues + key terms (no bodies)
 * 5. `getNote`           — full note body by id
 * 6. `getAcademyArticle` — full TA article by path
 * 7. `getWordArticle`    — full TW article by path
 * 8. `getQuestions`      — comprehension questions for a passage
 * 9. `searchArticles`    — lateral concept → article path discovery
 */

import type {
  ClientOptions,
  // Workflow tools
  ListLanguagesOptions,
  GetPassageOptions,
  GetPassageContextOptions,
  GetPassageIndexOptions,
  GetNoteOptions,
  GetAcademyArticleOptions,
  GetWordArticleOptions,
  GetQuestionsOptions,
  SearchArticlesOptions,
  // Legacy tools
  FetchScriptureOptions,
  FetchTranslationNotesOptions,
  FetchTranslationQuestionsOptions,
  FetchTranslationWordOptions,
  FetchTranslationWordLinksOptions,
  FetchTranslationAcademyOptions,
  ListResourcesForLanguageOptions,
  GetBundleOptions,
  ListTranslationAcademyOptions,
  ListTranslationWordsOptions,
  MCPToolResult,
  ToolName,
} from "./types.js";

const DEFAULT_SERVER_URL = "https://translation-helps-mcp.workers.dev/mcp";

export class TranslationHelpsClient {
  private serverUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  private requestId = 0;

  constructor(options: ClientOptions = {}) {
    this.serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL;
    this.timeout = options.timeout ?? 90_000;
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...options.headers,
    };
  }

  /** Low-level MCP JSON-RPC call. */
  async callTool(
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const id = ++this.requestId;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.serverUrl, {
        method: "POST",
        headers: this.headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from MCP server`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      let json: unknown;

      if (contentType.includes("text/event-stream")) {
        const text = await response.text();
        const dataLines = text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        for (const line of dataLines) {
          try {
            json = JSON.parse(line);
            break;
          } catch {
            /* skip non-JSON events */
          }
        }
      } else {
        json = await response.json();
      }

      const result = (json as { result?: MCPToolResult })?.result;
      if (!result) throw new Error("No result in MCP response");
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** List all tools exposed by the server. */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const id = ++this.requestId;
    const response = await fetch(this.serverUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }),
    });
    const json = (await response.json()) as {
      result?: { tools?: Array<{ name: string; description: string }> };
    };
    return json.result?.tools ?? [];
  }

  // ---------------------------------------------------------------------------
  // Workflow tools — primary progressive-disclosure interface
  // ---------------------------------------------------------------------------

  /**
   * Discover available language codes. Call first to validate language codes.
   *
   * @example
   * const result = await client.listLanguages({ filter: "es" });
   */
  async listLanguages(opts?: ListLanguagesOptions): Promise<MCPToolResult> {
    return this.callTool("list_languages", (opts ?? {}) as unknown as Record<string, unknown>);
  }

  /**
   * Get the scripture TEXT for a passage — all versions (literal, simplified,
   * original) in one call. Cheap and repeatable: call it whenever you need to
   * (re-)read the verse text while studying or drafting. For book/chapter
   * background and resource availability, use `getPassageContext`.
   *
   * @example
   * const result = await client.getPassage({
   *   reference: "JHN 3:16",
   *   language: "en",
   * });
   */
  async getPassage(opts: GetPassageOptions): Promise<MCPToolResult> {
    return this.callTool("get_passage", opts as unknown as Record<string, unknown>);
  }

  /**
   * Step 1 (orient): Get the background AROUND a passage — book/chapter intro
   * notes (tagged scope: "book"/"chapter") and a summary of which resources
   * exist for the language. Does NOT return verse text — use `getPassage` for that.
   *
   * @example
   * const result = await client.getPassageContext({
   *   reference: "JHN 3:16",
   *   language: "en",
   * });
   */
  async getPassageContext(opts: GetPassageContextOptions): Promise<MCPToolResult> {
    return this.callTool("get_passage_context", opts as unknown as Record<string, unknown>);
  }

  /**
   * Step 2 (survey): Get a compact, self-describing index of translation issues
   * and key terms without full article bodies. Use note IDs and article paths
   * to drill into specific items with getNote / getAcademyArticle / getWordArticle.
   *
   * @example
   * const result = await client.getPassageIndex({
   *   reference: "JHN 3:16",
   *   language: "en",
   * });
   */
  async getPassageIndex(opts: GetPassageIndexOptions): Promise<MCPToolResult> {
    return this.callTool("get_passage_index", opts as unknown as Record<string, unknown>);
  }

  /**
   * Step 3 (drill): Fetch the full body of a specific translation note by ID,
   * or all verse-level notes for a reference.
   *
   * @example
   * const result = await client.getNote({
   *   reference: "JHN 3:16",
   *   language: "en",
   *   id: "abc123",
   * });
   */
  async getNote(opts: GetNoteOptions): Promise<MCPToolResult> {
    return this.callTool("get_note", opts as unknown as Record<string, unknown>);
  }

  /**
   * Step 3 (drill): Fetch the full Markdown content of a Translation Academy article.
   * Use the path from a note's taArticle.path field.
   *
   * @example
   * const result = await client.getAcademyArticle({
   *   path: "translate/figs-metaphor",
   *   language: "en",
   * });
   */
  async getAcademyArticle(opts: GetAcademyArticleOptions): Promise<MCPToolResult> {
    return this.callTool("get_academy_article", opts as unknown as Record<string, unknown>);
  }

  /**
   * Step 3 (drill): Fetch the full Markdown content of a Translation Words article.
   * Use the path from a word-link's twArticle.path field.
   *
   * @example
   * const result = await client.getWordArticle({
   *   path: "bible/kt/grace",
   *   language: "en",
   * });
   */
  async getWordArticle(opts: GetWordArticleOptions): Promise<MCPToolResult> {
    return this.callTool("get_word_article", opts as unknown as Record<string, unknown>);
  }

  /**
   * Step 4 (check): Fetch comprehension questions for a passage.
   * Use to verify understanding before drafting a translation.
   *
   * @example
   * const result = await client.getQuestions({
   *   reference: "JHN 3:16",
   *   language: "en",
   * });
   */
  async getQuestions(opts: GetQuestionsOptions): Promise<MCPToolResult> {
    return this.callTool("get_questions", opts as unknown as Record<string, unknown>);
  }

  /**
   * Lateral discovery: Search Translation Academy and Translation Words articles
   * by concept. Returns ranked paths to pass to getAcademyArticle or getWordArticle.
   *
   * @example
   * const result = await client.searchArticles({
   *   query: "How should I translate figurative language?",
   *   language: "en",
   *   resourceTypes: ["ta"],
   *   topK: 5,
   * });
   */
  async searchArticles(opts: SearchArticlesOptions): Promise<MCPToolResult> {
    return this.callTool("search_articles", opts as unknown as Record<string, unknown>);
  }

  // ---------------------------------------------------------------------------
  // Legacy methods — kept for ContextHarness / backward compatibility
  // ---------------------------------------------------------------------------

  /** @deprecated Use getPassage instead */
  async fetchScripture(opts: FetchScriptureOptions): Promise<MCPToolResult> {
    return this.callTool("fetch_scripture", opts as unknown as Record<string, unknown>);
  }

  /** @deprecated Use getNote instead */
  async fetchTranslationNotes(opts: FetchTranslationNotesOptions): Promise<MCPToolResult> {
    return this.callTool("fetch_translation_notes", opts as unknown as Record<string, unknown>);
  }

  /** @deprecated Use getQuestions instead */
  async fetchTranslationQuestions(opts: FetchTranslationQuestionsOptions): Promise<MCPToolResult> {
    return this.callTool("fetch_translation_questions", opts as unknown as Record<string, unknown>);
  }

  /** @deprecated Use getPassageIndex instead */
  async fetchTranslationWordLinks(opts: FetchTranslationWordLinksOptions): Promise<MCPToolResult> {
    return this.callTool("fetch_translation_word_links", opts as unknown as Record<string, unknown>);
  }

  /** @deprecated Use getWordArticle instead */
  async fetchTranslationWord(opts: FetchTranslationWordOptions): Promise<MCPToolResult> {
    return this.callTool("fetch_translation_word", opts as unknown as Record<string, unknown>);
  }

  /** @deprecated Use getAcademyArticle instead */
  async fetchTranslationAcademy(opts: FetchTranslationAcademyOptions): Promise<MCPToolResult> {
    return this.callTool("fetch_translation_academy", opts as unknown as Record<string, unknown>);
  }

  async listSubjects(): Promise<MCPToolResult> {
    return this.callTool("list_subjects", {});
  }

  async listResourcesForLanguage(opts: ListResourcesForLanguageOptions): Promise<MCPToolResult> {
    return this.callTool("list_resources_for_language", opts as unknown as Record<string, unknown>);
  }

  /** @deprecated Use getPassageContext + getPassageIndex instead */
  async getBundle(opts: GetBundleOptions): Promise<MCPToolResult> {
    return this.callTool("get_bundle", opts as unknown as Record<string, unknown>);
  }

  async listTranslationAcademy(opts: ListTranslationAcademyOptions = {}): Promise<MCPToolResult> {
    return this.callTool("list_translation_academy", opts as unknown as Record<string, unknown>);
  }

  async listTranslationWords(opts: ListTranslationWordsOptions = {}): Promise<MCPToolResult> {
    return this.callTool("list_translation_words", opts as unknown as Record<string, unknown>);
  }
}
