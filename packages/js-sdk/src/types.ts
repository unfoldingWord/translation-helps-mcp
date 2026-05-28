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

// ---------------------------------------------------------------------------
// RAG tools (rag_query, get_bundle, index_resource)
// ---------------------------------------------------------------------------

export interface RagQueryFilters {
  /** Resource type(s) to filter by, e.g. "tn" or ["tn", "tw"] */
  resourceType?: string | string[];
  /** Door43 subject(s) to filter by */
  subject?: string[];
  /** Door43 project slug filter */
  project?: string;
  /** Door43 owner org filter */
  owner?: string;
}

/**
 * Options for the `rag_query` MCP tool.
 *
 * @example
 * const results = await client.ragQuery({
 *   query: "What does grace mean?",
 *   language: "en",
 *   reference: "JHN 3:16",
 *   k: 10,
 * });
 */
export interface RagQueryOptions {
  /** Natural-language search query (required) */
  query: string;
  /** IETF BCP 47 language code (default: "en") */
  language?: string;
  /** USFM reference to contextualise the query, e.g. "JHN 3:16" */
  reference?: string;
  /** Metadata filters */
  filters?: RagQueryFilters;
  /** Number of results to return (1–100, default: 10) */
  k?: number;
  /** If true, include exact-text matches for the reference */
  enableExact?: boolean;
  /** Client-supplied request ID for tracing */
  requestId?: string;
}

/**
 * Options for the `get_bundle` MCP tool.
 *
 * @example
 * const bundle = await client.getBundle({
 *   language: "en",
 *   reference: "JHN 3:16",
 * });
 */
export interface GetBundleOptions {
  /** IETF BCP 47 language code (required) */
  language: string;
  /** USFM reference (required), e.g. "JHN 3:16" */
  reference: string;
  /** Door43 owner org */
  owner?: string;
  /** Door43 project slug */
  project?: string;
  /** Skip caches and force fresh assembly */
  force?: boolean;
  /** Client-supplied request ID for tracing */
  requestId?: string;
}

/**
 * Options for the `index_resource` admin MCP tool.
 *
 * Requires `adminToken` matching the server's `ADMIN_TOKEN` env var.
 *
 * @example
 * const job = await client.indexResource({
 *   resourceId: "unfoldingWord/en_tn",
 *   adminToken: process.env.ADMIN_TOKEN,
 * });
 */
export interface IndexResourceOptions {
  /** Resource ID in the form "owner/project" (required) */
  resourceId: string;
  /** Optional URL of a ZIP archive to index */
  zipUrl?: string;
  /** Force re-indexing even if already indexed at this version */
  force?: boolean;
  /** Queue priority (default: "normal") */
  priority?: "low" | "normal" | "high";
  /** Client-supplied request ID for tracing */
  requestId?: string;
  /** Admin authentication token */
  adminToken?: string;
}
