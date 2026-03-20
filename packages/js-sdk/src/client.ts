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
  ListLanguagesOptions,
  ListSubjectsOptions,
  ListResourcesForLanguageOptions,
} from "./types.js";
import { ContextManager } from "./ContextManager.js";
import {
  StateInjectionInterceptor,
  type InterceptorOptions,
  type ToolContextConfig,
} from "./StateInjectionInterceptor.js";
import { DEFAULT_TOOL_CONTEXT_CONFIG } from "./defaultToolConfig.js";
import {
  languageCodeValidator,
  organizationValidator,
  stageValidator,
  referenceValidator,
  formatValidator,
  booleanValidator,
} from "./validators.js";

const DEFAULT_SERVER_URL = "https://tc-helps.mcp.servant.bible/api/mcp";
const DEFAULT_TIMEOUT = 90000; // Increased from 30s to 90s for cold cache scenarios (DCS ZIP downloads can be slow)

export interface EnhancedClientOptions extends ClientOptions {
  enableInterceptor?: boolean;
  toolContextConfig?: ToolContextConfig;
  interceptorOptions?: InterceptorOptions;
  initialContext?: Record<string, any>;
}

export class TranslationHelpsClient {
  private serverUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  private enableMetrics: boolean;
  private toolsCache: MCPTool[] | null = null;
  private promptsCache: MCPPrompt[] | null = null;
  private initialized = false;

  // State Injection Interceptor
  private contextManager: ContextManager;
  private interceptor: StateInjectionInterceptor | null = null;
  private interceptorEnabled = false;

  constructor(options: EnhancedClientOptions = {}) {
    this.serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.enableMetrics = options.enableMetrics || false;
    this.headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    // Initialize Context Manager
    this.contextManager = new ContextManager();

    // Register validation rules
    this.contextManager.addValidationRule("language", languageCodeValidator);
    this.contextManager.addValidationRule(
      "organization",
      organizationValidator,
    );
    this.contextManager.addValidationRule("stage", stageValidator);
    this.contextManager.addValidationRule("reference", referenceValidator);
    this.contextManager.addValidationRule("format", formatValidator);
    this.contextManager.addValidationRule("includeAlignment", booleanValidator);
    this.contextManager.addValidationRule("includeContext", booleanValidator);
    this.contextManager.addValidationRule("includeIntro", booleanValidator);

    // Initialize interceptor if enabled
    if (options.enableInterceptor) {
      this.enableStateInjection(
        options.toolContextConfig,
        options.interceptorOptions,
      );
    }

    // Pre-populate context if provided
    if (options.initialContext) {
      this.contextManager.setMany(options.initialContext);
    }
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
        console.log("[SDK] 🚨 MCP Error Response:", data.error);
        console.log("[SDK] 🔍 Has data.error.data?", !!data.error.data);
        console.log("[SDK] 🔍 data.error.data:", data.error.data);

        const error: any = new Error(data.error.message || "MCP server error");

        // Preserve error.data for AI agents (contains validBookCodes, languageVariants, etc.)
        if (data.error.data) {
          console.log(
            "[SDK] ✅ Preserving error.data with",
            Object.keys(data.error.data),
          );
          error.details = data.error.data;

          // Attach validBookCodes directly for easy access
          if (data.error.data.validBookCodes) {
            console.log(
              "[SDK] ✅ Attaching validBookCodes:",
              data.error.data.validBookCodes.length,
              "codes",
            );
            error.validBookCodes = data.error.data.validBookCodes;
            error.invalidCode = data.error.data.invalidCode;
          }

          // Attach languageVariants directly for easy access
          if (data.error.data.languageVariants) {
            console.log(
              "[SDK] ✅ Attaching languageVariants:",
              data.error.data.languageVariants,
            );
            error.languageVariants = data.error.data.languageVariants;
            error.requestedLanguage = data.error.data.requestedLanguage;
          }

          // Attach availableBooks directly for easy access
          if (data.error.data.availableBooks) {
            console.log(
              "[SDK] ✅ Attaching availableBooks:",
              data.error.data.availableBooks.length,
              "books",
            );
            error.availableBooks = data.error.data.availableBooks;
            error.requestedBook = data.error.data.requestedBook;
            error.language = data.error.data.language;
          }
        } else {
          console.warn("[SDK] ⚠️ No data.error.data found in response");
        }

        console.log(
          "[SDK] 🎯 Throwing error with details:",
          !!error.details,
          "validBookCodes:",
          !!error.validBookCodes,
        );
        throw error;
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
        response.headers.forEach((value: string, key: string) => {
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

    // Apply state injection interceptor if enabled
    let finalArguments = arguments_;
    let interceptionMetadata: any = null;

    if (this.interceptorEnabled && this.interceptor) {
      const result = this.interceptor.intercept(name, arguments_);
      finalArguments = result.arguments;

      // Store metadata for debugging/logging
      if (result.modified) {
        interceptionMetadata = {
          injected: result.injected,
          synced: result.synced,
          originalArgs: arguments_,
          finalArgs: finalArguments,
        };

        console.log(
          `[SDK] 🔄 State Injection Applied: tool=${name}, ` +
            `injected=[${Object.keys(result.injected).join(", ")}], ` +
            `synced=[${Object.keys(result.synced).join(", ")}]`,
        );
      }
    }

    // Call the MCP server with potentially modified arguments
    const response = await this.sendRequest("tools/call", {
      name,
      arguments: finalArguments,
    });

    // Attach interception metadata if metrics are enabled
    if (this.enableMetrics && interceptionMetadata) {
      if (!response.metadata) {
        response.metadata = {};
      }
      response.metadata.stateInjection = interceptionMetadata;
    }

    return response;
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
    const params: Record<string, any> = {
      reference: options.reference,
      language: options.language || "en",
      format: options.format || "text",
      includeVerseNumbers: options.includeVerseNumbers !== false,
    };

    // Only include organization if explicitly provided (defaults to searching all orgs)
    if (options.organization !== undefined) {
      params.organization = options.organization;
    }

    // Add optional parameters if provided
    if (options.resource !== undefined) {
      params.resource = options.resource;
    }
    if (options.includeAlignment !== undefined) {
      params.includeAlignment = options.includeAlignment;
    }

    const response = await this.callTool("fetch_scripture", params);

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
    const params: Record<string, any> = {
      reference: options.reference,
      language: options.language || "en",
      includeIntro: options.includeIntro !== false,
      includeContext: options.includeContext !== false,
    };

    // Only include organization if explicitly provided
    if (options.organization !== undefined) {
      params.organization = options.organization;
    }

    const response = await this.callTool("fetch_translation_notes", params);

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
    const params: Record<string, any> = {
      reference: options.reference,
      language: options.language || "en",
    };

    // Only include organization if explicitly provided
    if (options.organization !== undefined) {
      params.organization = options.organization;
    }

    const response = await this.callTool("fetch_translation_questions", params);

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
    const params: Record<string, any> = {
      reference: options.reference,
      term: options.term,
      language: options.language || "en",
      category: options.category,
    };

    // Only include organization if explicitly provided
    if (options.organization !== undefined) {
      params.organization = options.organization;
    }

    const response = await this.callTool("fetch_translation_word", params);

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
    const params: Record<string, any> = {
      reference: options.reference,
      language: options.language || "en",
    };

    // Only include organization if explicitly provided
    if (options.organization !== undefined) {
      params.organization = options.organization;
    }

    const response = await this.callTool(
      "fetch_translation_word_links",
      params,
    );

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
    const params: Record<string, any> = {
      reference: options.reference,
      rcLink: options.rcLink,
      moduleId: options.moduleId,
      path: options.path,
      language: options.language || "en",
      format: options.format || "json",
    };

    // Only include organization if explicitly provided
    if (options.organization !== undefined) {
      params.organization = options.organization;
    }

    const response = await this.callTool("fetch_translation_academy", params);

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

  // ============================================================================
  // State Injection Interceptor Methods
  // ============================================================================

  /**
   * Enable the State Injection Interceptor
   */
  enableStateInjection(
    toolConfig?: ToolContextConfig,
    options?: InterceptorOptions,
  ): void {
    const finalConfig = toolConfig || DEFAULT_TOOL_CONTEXT_CONFIG;
    this.interceptor = new StateInjectionInterceptor(
      this.contextManager,
      finalConfig,
      options || {},
    );
    this.interceptorEnabled = true;
  }

  /**
   * Disable the State Injection Interceptor
   */
  disableStateInjection(): void {
    this.interceptor = null;
    this.interceptorEnabled = false;
  }

  /**
   * Get the context manager instance
   */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /**
   * Get the interceptor instance
   */
  getInterceptor(): StateInjectionInterceptor | null {
    return this.interceptor;
  }

  /**
   * Set a context value
   */
  setContext(key: string, value: any): boolean {
    return this.contextManager.set(key, value);
  }

  /**
   * Get a context value
   */
  getContext(key: string): any | undefined {
    return this.contextManager.get(key);
  }

  /**
   * Set multiple context values at once
   */
  setContextMany(values: Record<string, any>): Record<string, boolean> {
    return this.contextManager.setMany(values);
  }

  /**
   * Clear all context
   */
  clearContext(): void {
    this.contextManager.clear();
  }

  /**
   * Get all context values
   */
  getAllContext(): Record<string, any> {
    return this.contextManager.getAll();
  }

  // ============================================================================
  // End State Injection Interceptor Methods
  // ============================================================================
}
