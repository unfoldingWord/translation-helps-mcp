/**
 * Translation Helps MCP Client v2
 *
 * Connects to the Translation Helps MCP server via Streamable HTTP at /mcp.
 * Compatible with MCP SDK 1.x Streamable HTTP transport.
 */

import type {
  ClientOptions,
  FetchScriptureOptions,
  FetchTranslationNotesOptions,
  FetchTranslationQuestionsOptions,
  FetchTranslationWordOptions,
  FetchTranslationWordLinksOptions,
  FetchTranslationAcademyOptions,
  ListLanguagesOptions,
  ListResourcesForLanguageOptions,
  RagQueryOptions,
  GetBundleOptions,
  IndexResourceOptions,
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
  // Typed convenience methods — one per tool
  // ---------------------------------------------------------------------------

  async fetchScripture(opts: FetchScriptureOptions): Promise<MCPToolResult> {
    return this.callTool("fetch_scripture", opts as Record<string, unknown>);
  }

  async fetchTranslationNotes(
    opts: FetchTranslationNotesOptions,
  ): Promise<MCPToolResult> {
    return this.callTool(
      "fetch_translation_notes",
      opts as Record<string, unknown>,
    );
  }

  async fetchTranslationQuestions(
    opts: FetchTranslationQuestionsOptions,
  ): Promise<MCPToolResult> {
    return this.callTool(
      "fetch_translation_questions",
      opts as Record<string, unknown>,
    );
  }

  async fetchTranslationWordLinks(
    opts: FetchTranslationWordLinksOptions,
  ): Promise<MCPToolResult> {
    return this.callTool(
      "fetch_translation_word_links",
      opts as Record<string, unknown>,
    );
  }

  async fetchTranslationWord(
    opts: FetchTranslationWordOptions,
  ): Promise<MCPToolResult> {
    return this.callTool(
      "fetch_translation_word",
      opts as Record<string, unknown>,
    );
  }

  async fetchTranslationAcademy(
    opts: FetchTranslationAcademyOptions,
  ): Promise<MCPToolResult> {
    return this.callTool(
      "fetch_translation_academy",
      opts as Record<string, unknown>,
    );
  }

  async listLanguages(opts?: ListLanguagesOptions): Promise<MCPToolResult> {
    return this.callTool(
      "list_languages",
      (opts ?? {}) as Record<string, unknown>,
    );
  }

  async listSubjects(): Promise<MCPToolResult> {
    return this.callTool("list_subjects", {});
  }

  async listResourcesForLanguage(
    opts: ListResourcesForLanguageOptions,
  ): Promise<MCPToolResult> {
    return this.callTool(
      "list_resources_for_language",
      opts as Record<string, unknown>,
    );
  }

  async ragQuery(opts: RagQueryOptions): Promise<MCPToolResult> {
    return this.callTool("rag_query", opts as Record<string, unknown>);
  }

  async getBundle(opts: GetBundleOptions): Promise<MCPToolResult> {
    return this.callTool("get_bundle", opts as Record<string, unknown>);
  }

  async indexResource(opts: IndexResourceOptions): Promise<MCPToolResult> {
    return this.callTool("index_resource", opts as Record<string, unknown>);
  }
}
