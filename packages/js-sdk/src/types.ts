/**
 * Type definitions for Translation Helps MCP Client
 */

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPResponseMetadata {
  /**
   * Response time in milliseconds
   */
  responseTime?: number;

  /**
   * Cache status (hit/miss/bypass)
   */
  cacheStatus?: string;

  /**
   * Trace ID for debugging
   */
  traceId?: string;

  /**
   * X-Ray trace data (base64 decoded)
   */
  xrayTrace?: any;

  /**
   * HTTP status code
   */
  statusCode?: number;

  /**
   * All response headers (when metrics enabled)
   */
  headers?: Record<string, string>;
}

export interface MCPResponse {
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  /**
   * Metadata available when enableMetrics is true
   */
  metadata?: MCPResponseMetadata;
  [key: string]: any;
}

export interface ClientOptions {
  /**
   * Server URL for remote HTTP servers
   * Default: 'https://tc-helps.mcp.servant.bible/api/mcp'
   */
  serverUrl?: string;

  /**
   * Timeout for HTTP requests in milliseconds
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Custom headers to include in requests
   */
  headers?: Record<string, string>;

  /**
   * Enable metrics collection (response headers, timing, etc.)
   * Useful for development and debugging
   * Default: false
   */
  enableMetrics?: boolean;
}

export interface FetchScriptureOptions {
  reference: string;
  language?: string;
  format?: "text" | "usfm";
  includeVerseNumbers?: boolean;
  /**
   * Scripture resource type(s) - single resource (ult, ust, t4t, ueb), comma-separated (ult,ust), or 'all' for all available
   */
  resource?: string;
  /**
   * Include word alignment data (only available with USFM format)
   */
  includeAlignment?: boolean;
}

export interface FetchTranslationNotesOptions {
  reference: string;
  language?: string;
  includeIntro?: boolean;
  includeContext?: boolean;
}

export interface FetchTranslationQuestionsOptions {
  reference: string;
  language?: string;
}

export interface FetchTranslationWordOptions {
  reference?: string;
  term?: string;
  language?: string;
  category?: "kt" | "names" | "other";
}

export interface FetchTranslationWordLinksOptions {
  reference: string;
  language?: string;
}

export interface FetchTranslationAcademyOptions {
  reference?: string;
  rcLink?: string;
  moduleId?: string;
  path?: string;
  language?: string;
  format?: "json" | "markdown";
}

export interface ListLanguagesOptions {
  stage?: string;
}

export interface ListSubjectsOptions {
  language?: string;
  stage?: string;
}

export interface ListResourcesForLanguageOptions {
  language: string;
  stage?: string;
  subject?: string;
  limit?: number;
  /**
   * Filter by topic tag (e.g., "tc-ready" for translationCore-ready resources).
   * Defaults to "tc-ready" if not provided.
   */
  topic?: string;
}
