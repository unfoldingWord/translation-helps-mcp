/**
 * Translation Helps MCP Client v2
 *
 * Connects to the Translation Helps MCP server via Streamable HTTP at /mcp.
 * Compatible with MCP SDK 1.x Streamable HTTP transport.
 *
 * ### Progressive-disclosure workflow
 * 1. `listLanguages`     — discover valid language codes
 * 2. `listResources`     — resource availability for a language
 * 3. `getPassage`        — scripture text (all versions) — cheap, repeatable
 * 4. `getPassageContext` — book/chapter intro notes + resource availability
 * 5. `getPassageIndex`   — compact index of issues + key terms (no bodies)
 * 6. `getNote`           — full note body by id
 * 7. `getAcademyArticle` — full TA article by path
 * 8. `getWordArticle`    — full TW article by path
 * 9. `getQuestions`      — comprehension questions for a passage
 * 10. `searchArticles`   — lateral concept → article path discovery
 */

import type {
  ClientOptions,
  // Workflow tools
  ListLanguagesOptions,
  ListResourcesOptions,
  GetPassageOptions,
  GetPassageContextOptions,
  GetPassageIndexOptions,
  GetNoteOptions,
  GetAcademyArticleOptions,
  GetWordArticleOptions,
  GetQuestionsOptions,
  SearchArticlesOptions,
  // OBS tools
  GetObsStoryOptions,
  GetObsNotesOptions,
  GetObsQuestionsOptions,
  MCPToolResult,
  ToolName,
} from "./types.js";

const DEFAULT_SERVER_URL = "https://translation-helps-mcp-v2.workers.dev/mcp";

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
    return this.callTool(
      "list_languages",
      (opts ?? {}) as unknown as Record<string, unknown>,
    );
  }

  /**
   * List which translation resource types are available for a language.
   * Returns an availability summary (type, abbreviation, role) from the
   * Door43 catalog. Pass optional `book` / `reference` to filter book-scoped
   * resources that do not cover that book (partial TN/TQ coverage).
   *
   * @example
   * const result = await client.listResources({ language: "en" });
   * const tit = await client.listResources({ language: "hi", book: "TIT" });
   */
  async listResources(opts: ListResourcesOptions): Promise<MCPToolResult> {
    return this.callTool(
      "list_resources",
      opts as unknown as Record<string, unknown>,
    );
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
    return this.callTool(
      "get_passage",
      opts as unknown as Record<string, unknown>,
    );
  }

  /**
   * Step 1 (orient): Get the background AROUND a passage — book/chapter intro
   * notes (tagged scope: "book"/"chapter") and a summary of which resources
   * exist for the language. Does NOT return verse text — use `getPassage` for that.
   *
   * Also accepts a bare book reference (e.g. "TIT" or "Titus") — then returns
   * only the book overview (front:intro).
   *
   * @example
   * const result = await client.getPassageContext({
   *   reference: "JHN 3:16",
   *   language: "en",
   * });
   */
  async getPassageContext(
    opts: GetPassageContextOptions,
  ): Promise<MCPToolResult> {
    return this.callTool(
      "get_passage_context",
      opts as unknown as Record<string, unknown>,
    );
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
    return this.callTool(
      "get_passage_index",
      opts as unknown as Record<string, unknown>,
    );
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
    return this.callTool(
      "get_note",
      opts as unknown as Record<string, unknown>,
    );
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
  async getAcademyArticle(
    opts: GetAcademyArticleOptions,
  ): Promise<MCPToolResult> {
    return this.callTool(
      "get_academy_article",
      opts as unknown as Record<string, unknown>,
    );
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
    return this.callTool(
      "get_word_article",
      opts as unknown as Record<string, unknown>,
    );
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
    return this.callTool(
      "get_questions",
      opts as unknown as Record<string, unknown>,
    );
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
    return this.callTool(
      "search_articles",
      opts as unknown as Record<string, unknown>,
    );
  }

  // ---------------------------------------------------------------------------
  // OBS methods (Open Bible Stories)
  // ---------------------------------------------------------------------------

  /**
   * Fetch Open Bible Stories text for a story:frame reference.
   * OBS is a set of 50 illustrated Bible stories for communities
   * without written Scripture.
   *
   * @example
   * const result = await client.getObsStory({ reference: "1:1", language: "en" });
   * // Returns story title + frame text and image URL for story 1, frame 1
   */
  async getObsStory(opts: GetObsStoryOptions): Promise<MCPToolResult> {
    return this.callTool(
      "get_obs_story",
      opts as unknown as Record<string, unknown>,
    );
  }

  /**
   * Fetch OBS Translation Notes for a story:frame reference.
   * Notes explain difficult words, cultural context, and translation strategies.
   *
   * @example
   * const result = await client.getObsNotes({ reference: "1:1", language: "en" });
   */
  async getObsNotes(opts: GetObsNotesOptions): Promise<MCPToolResult> {
    return this.callTool(
      "get_obs_notes",
      opts as unknown as Record<string, unknown>,
    );
  }

  /**
   * Fetch OBS Translation Questions for a story:frame reference.
   * Use after drafting a translation to verify comprehension.
   *
   * @example
   * const result = await client.getObsQuestions({ reference: "1:1", language: "en" });
   */
  async getObsQuestions(opts: GetObsQuestionsOptions): Promise<MCPToolResult> {
    return this.callTool(
      "get_obs_questions",
      opts as unknown as Record<string, unknown>,
    );
  }
}
