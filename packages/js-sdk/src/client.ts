/**
 * Translation Helps MCP Client
 *
 * Connects to the Translation Helps MCP server via HTTP (remote) or STDIO (local).
 */

import type {
  ClientOptions,
  MCPTool,
  MCPPrompt,
  MCPResponse,
  FetchScriptureOptions,
  FetchTranslationNotesOptions,
  FetchTranslationQuestionsOptions,
  FetchTranslationWordOptions,
  FetchTranslationWordLinksOptions,
  FetchTranslationAcademyOptions,
  GetLanguagesOptions,
  ListLanguagesOptions,
  ListSubjectsOptions,
  ListResourcesForLanguageOptions,
} from "./types.js";

const DEFAULT_SERVER_URL = "https://tc-helps.mcp.servant.bible/api/mcp";
const DEFAULT_TIMEOUT = 30000;

export class TranslationHelpsClient {
  private serverUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  private enableMetrics: boolean;
  private toolsCache: MCPTool[] | null = null;
  private promptsCache: MCPPrompt[] | null = null;
  private initialized = false;

  constructor(options: ClientOptions = {}) {
    this.serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.enableMetrics = options.enableMetrics || false;
    this.headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };
  }

  /**
   * Initialize connection to the MCP server
   */
  async connect(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize the server
      const initResponse = await this.sendRequest("initialize");

      if (!initResponse.serverInfo) {
        throw new Error("Invalid server response: missing serverInfo");
      }

      // Cache tools and prompts
      await this.refreshTools();
      await this.refreshPrompts();

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Send a request to the MCP server
   */
  private async sendRequest(
    method: string,
    params?: Record<string, any>,
  ): Promise<any> {
    const payload: any = { method };
    if (params) {
      payload.params = params;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startTime = Date.now();

    try {
      const response = await fetch(this.serverUrl, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;

      // Handle MCP error responses (JSON-RPC 2.0 format)
      if (data.error) {
        throw new Error(data.error.message || "MCP server error");
      }

      // Extract result from JSON-RPC 2.0 format if present
      // The server now always returns JSON-RPC 2.0 format: { jsonrpc: "2.0", result: {...}, id: ... }
      // But we need to support both formats for backward compatibility
      const responseData = data.result !== undefined ? data.result : data;

      // Extract metrics from headers if enabled
      if (this.enableMetrics) {
        const metadata: any = {
          responseTime,
          statusCode: response.status,
          headers: {},
        };

        // Extract all headers
        response.headers.forEach((value, key) => {
          metadata.headers[key] = value;
        });

        // Extract specific diagnostic headers
        const xrayHeader =
          response.headers.get("X-XRay-Trace") ||
          response.headers.get("x-xray-trace");
        if (xrayHeader) {
          try {
            const cleaned = xrayHeader.replace(/\s+/g, "");
            metadata.xrayTrace = JSON.parse(atob(cleaned));
          } catch (_e) {
            // Ignore parse errors
          }
        }

        const rt = response.headers.get("X-Response-Time");
        if (rt) {
          const rtNum = parseInt(rt.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(rtNum)) {
            metadata.responseTime = rtNum; // Use server-reported time if available
          }
        }

        const cacheStatus = response.headers.get("X-Cache-Status");
        if (cacheStatus) {
          metadata.cacheStatus = cacheStatus.toLowerCase();
          console.log(
            `[SDK DEBUG] Captured X-Cache-Status header: ${cacheStatus} → ${metadata.cacheStatus}`,
          );
        } else {
          console.log(
            `[SDK DEBUG] ⚠️ X-Cache-Status header not found in response`,
          );
        }

        const traceId = response.headers.get("X-Trace-Id");
        if (traceId) {
          metadata.traceId = traceId;
        }

        // DEBUG: Log what we captured
        console.log(`[SDK DEBUG] Captured metadata:`, {
          cacheStatus: metadata.cacheStatus,
          responseTime: metadata.responseTime,
          traceId: metadata.traceId,
          hasXrayTrace: !!metadata.xrayTrace,
          xrayTraceCacheStats: metadata.xrayTrace?.cacheStats,
          allHeaders: Object.keys(metadata.headers),
        });

        // Attach metadata to response (use responseData to handle JSON-RPC format)
        if (!responseData.metadata) {
          responseData.metadata = {};
        }
        Object.assign(responseData.metadata, metadata);

        console.log(`[SDK DEBUG] Final response.metadata:`, {
          cacheStatus: responseData.metadata.cacheStatus,
          hasXrayTrace: !!responseData.metadata.xrayTrace,
          xrayTraceKeys: responseData.metadata.xrayTrace
            ? Object.keys(responseData.metadata.xrayTrace)
            : [],
        });
      }

      return responseData;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Refresh the tools cache
   */
  private async refreshTools(): Promise<void> {
    const response = await this.sendRequest("tools/list");
    this.toolsCache = response.tools || [];
  }

  /**
   * Refresh the prompts cache
   */
  private async refreshPrompts(): Promise<void> {
    const response = await this.sendRequest("prompts/list");
    this.promptsCache = response.prompts || [];
  }

  /**
   * Ensure the client is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.connect();
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<MCPTool[]> {
    await this.ensureInitialized();
    if (!this.toolsCache) {
      await this.refreshTools();
    }
    return this.toolsCache || [];
  }

  /**
   * List available prompts
   */
  async listPrompts(): Promise<MCPPrompt[]> {
    await this.ensureInitialized();
    if (!this.promptsCache) {
      await this.refreshPrompts();
    }
    return this.promptsCache || [];
  }

  /**
   * Call a tool by name
   */
  async callTool(
    name: string,
    arguments_: Record<string, any>,
  ): Promise<MCPResponse> {
    await this.ensureInitialized();
    return await this.sendRequest("tools/call", {
      name,
      arguments: arguments_,
    });
  }

  /**
   * Get a prompt template
   */
  async getPrompt(
    name: string,
    arguments_: Record<string, any> = {},
  ): Promise<MCPResponse> {
    await this.ensureInitialized();
    return await this.sendRequest("prompts/get", {
      name,
      arguments: arguments_,
    });
  }

  // Convenience methods for common operations

  /**
   * Fetch Bible scripture text
   */
  async fetchScripture(options: FetchScriptureOptions): Promise<string> {
    const response = await this.callTool("fetch_scripture", {
      reference: options.reference,
      language: options.language || "en",
      organization: options.organization || "unfoldingWord",
      format: options.format || "text",
      includeVerseNumbers: options.includeVerseNumbers !== false,
    });

    // Extract text from response
    if (response.content && response.content[0]?.text) {
      return response.content[0].text;
    }

    throw new Error("Invalid response format from fetch_scripture");
  }

  /**
   * Fetch translation notes
   */
  async fetchTranslationNotes(
    options: FetchTranslationNotesOptions,
  ): Promise<any> {
    const response = await this.callTool("fetch_translation_notes", {
      reference: options.reference,
      language: options.language || "en",
      organization: options.organization || "unfoldingWord",
      includeIntro: options.includeIntro !== false,
      includeContext: options.includeContext !== false,
    });

    if (response.content && response.content[0]?.text) {
      return JSON.parse(response.content[0].text);
    }

    throw new Error("Invalid response format from fetch_translation_notes");
  }

  /**
   * Fetch translation questions
   */
  async fetchTranslationQuestions(
    options: FetchTranslationQuestionsOptions,
  ): Promise<any> {
    const response = await this.callTool("fetch_translation_questions", {
      reference: options.reference,
      language: options.language || "en",
      organization: options.organization || "unfoldingWord",
    });

    if (response.content && response.content[0]?.text) {
      return JSON.parse(response.content[0].text);
    }

    throw new Error("Invalid response format from fetch_translation_questions");
  }

  /**
   * Fetch translation word (by term or reference)
   */
  async fetchTranslationWord(
    options: FetchTranslationWordOptions,
  ): Promise<any> {
    const response = await this.callTool("fetch_translation_word", {
      reference: options.reference,
      term: options.term,
      language: options.language || "en",
      organization: options.organization || "unfoldingWord",
      category: options.category,
    });

    if (response.content && response.content[0]?.text) {
      return JSON.parse(response.content[0].text);
    }

    throw new Error("Invalid response format from fetch_translation_word");
  }

  /**
   * Fetch translation word links
   */
  async fetchTranslationWordLinks(
    options: FetchTranslationWordLinksOptions,
  ): Promise<any> {
    const response = await this.callTool("fetch_translation_word_links", {
      reference: options.reference,
      language: options.language || "en",
      organization: options.organization || "unfoldingWord",
    });

    if (response.content && response.content[0]?.text) {
      return JSON.parse(response.content[0].text);
    }

    throw new Error(
      "Invalid response format from fetch_translation_word_links",
    );
  }

  /**
   * Fetch translation academy articles
   */
  async fetchTranslationAcademy(
    options: FetchTranslationAcademyOptions,
  ): Promise<any> {
    const response = await this.callTool("fetch_translation_academy", {
      reference: options.reference,
      rcLink: options.rcLink,
      moduleId: options.moduleId,
      path: options.path,
      language: options.language || "en",
      organization: options.organization || "unfoldingWord",
      format: options.format || "json",
    });

    if (response.content && response.content[0]?.text) {
      const text = response.content[0].text;
      if (options.format === "markdown") {
        return text;
      }
      return JSON.parse(text);
    }

    throw new Error("Invalid response format from fetch_translation_academy");
  }

  /**
   * Get available languages
   */
  async getLanguages(options: GetLanguagesOptions = {}): Promise<any> {
    const response = await this.callTool("get_languages", {
      organization: options.organization,
    });

    if (response.content && response.content[0]?.text) {
      return JSON.parse(response.content[0].text);
    }

    throw new Error("Invalid response format from get_languages");
  }

  /**
   * Get system prompt
   */
  async getSystemPrompt(includeImplementationDetails = false): Promise<string> {
    const response = await this.callTool("get_system_prompt", {
      includeImplementationDetails,
    });

    if (response.content && response.content[0]?.text) {
      return response.content[0].text;
    }

    throw new Error("Invalid response format from get_system_prompt");
  }

  /**
   * List available languages from Door43 catalog
   */
  async listLanguages(options: ListLanguagesOptions = {}): Promise<any> {
    const response = await this.callTool("list_languages", {
      organization: options.organization,
      stage: options.stage || "prod",
    });

    if (response.content && response.content[0]?.text) {
      return JSON.parse(response.content[0].text);
    }

    throw new Error("Invalid response format from list_languages");
  }

  /**
   * List available resource subjects from Door43 catalog
   */
  async listSubjects(options: ListSubjectsOptions = {}): Promise<any> {
    const response = await this.callTool("list_subjects", {
      language: options.language,
      organization: options.organization,
      stage: options.stage || "prod",
    });

    if (response.content && response.content[0]?.text) {
      return JSON.parse(response.content[0].text);
    }

    throw new Error("Invalid response format from list_subjects");
  }

  /**
   * List all resources for a specific language (RECOMMENDED - much faster!)
   * Single API call (~1-2 seconds)
   * Use this after listLanguages() to discover what's available for a chosen language
   *
   * @param options - Language (required) and optional filters
   * @param options.topic - Filter by topic tag. Defaults to "tc-ready" if not provided.
   */
  async listResourcesForLanguage(
    options: ListResourcesForLanguageOptions,
  ): Promise<any> {
    const params: Record<string, any> = {
      language: options.language,
      stage: options.stage || "prod",
    };

    if (options.organization !== undefined)
      params.organization = options.organization;
    if (options.subject) params.subject = options.subject;
    if (options.limit) params.limit = options.limit;
    // topic defaults to "tc-ready" on the server if not provided
    if (options.topic) params.topic = options.topic;

    const response = await this.callTool("list_resources_for_language", params);

    if (response.content && response.content[0]?.text) {
      return JSON.parse(response.content[0].text);
    }

    throw new Error("Invalid response format from list_resources_for_language");
  }

  /**
   * Check if client is initialized
   */
  isConnected(): boolean {
    return this.initialized;
  }
}
