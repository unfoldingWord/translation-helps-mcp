/**
 * src/mcp/apiClient.ts
 *
 * Typed HTTP client for the REST Data API worker.
 *
 * In production the client uses the Cloudflare service binding `env.API`
 * (zero-latency, same-datacenter fetch). For local Wrangler dev both workers
 * can be started on different ports; set `API_BASE_URL` to the API worker's
 * local address (e.g. "http://localhost:8788").
 *
 * All tool handlers MUST use this client instead of hand-rolling fetch calls.
 * The client:
 *   - Resolves the base URL from `env.API` (service binding) or `API_BASE_URL`.
 *   - Returns typed payload `T` on success.
 *   - Throws an `ApiClientError` (extends Error) on HTTP errors, translating the
 *     REST `{ error: { code, message } }` contract into a structured exception.
 */

import type { ApiErrorResponse } from "../core/contracts/index.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

// ---------------------------------------------------------------------------
// Env surface required by the client
// ---------------------------------------------------------------------------

export interface ApiEnv {
  /** Cloudflare service binding to the REST API worker (production). */
  API?: Fetcher;
  /** Base URL for the REST API worker (local dev / fallback). */
  API_BASE_URL?: string;
}

// ---------------------------------------------------------------------------
// ApiClient
// ---------------------------------------------------------------------------

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher | null;

  constructor(env: ApiEnv) {
    if (env.API) {
      // Service binding — zero-latency same-datacenter call.
      // fetch() on a Fetcher accepts any URL; we still need a hostname so
      // requests are valid HTTP. We use a placeholder that the binding ignores.
      this.fetcher = env.API;
      this.baseUrl = "http://internal";
    } else if (env.API_BASE_URL) {
      this.fetcher = null;
      this.baseUrl = env.API_BASE_URL.replace(/\/$/, "");
    } else {
      throw new Error(
        "ApiClient: neither env.API (service binding) nor env.API_BASE_URL is set. " +
        "Add [[services]] to wrangler.toml or set API_BASE_URL for local dev.",
      );
    }
  }

  /**
   * Perform a GET request against the REST API and return the parsed response.
   * Throws `ApiClientError` on any non-2xx response.
   */
  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await this.fetchUrl(url.toString());

    if (!response.ok) {
      let code = "API_ERROR";
      let message = `HTTP ${response.status}`;
      let retryable = response.status >= 500;

      try {
        const body = (await response.json()) as ApiErrorResponse;
        if (body?.error) {
          code = body.error.code ?? code;
          message = body.error.message ?? message;
          retryable = body.error.retryable ?? retryable;
        }
      } catch {
        // ignore JSON parse failure
      }

      throw new ApiClientError(code, message, response.status, retryable);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fire a background prefetch request to warm REST API caches for
   * `reference` + `language`. Returns immediately — never awaited.
   *
   * The REST API worker uses ctx.waitUntil() to ensure the warming
   * completes even after this call returns. Any errors are silently ignored.
   */
  prefetch(reference: string, language: string): void {
    const url = new URL(`${this.baseUrl}/api/v1/prefetch`);
    url.searchParams.set("reference", reference);
    url.searchParams.set("language", language);
    // Intentional fire-and-forget — we don't await or surface errors
    this.fetchUrl(url.toString()).catch(() => {});
  }

  private fetchUrl(url: string): Promise<Response> {
    if (this.fetcher) {
      return this.fetcher.fetch(url);
    }
    return fetch(url);
  }
}

// ---------------------------------------------------------------------------
// Typed API call helpers (thin wrappers with typed return shapes)
// ---------------------------------------------------------------------------

import type {
  ScriptureVersion,
  TranslationNoteRow,
  TranslationWordLinkRow,
  TranslationQuestionRow,
  AcademyArticle,
  WordArticle,
  ArticleSearchResult,
  ResourceAvailability,
} from "../core/contracts/index.js";

export interface ScriptureResponse {
  reference: string;
  language: string;
  book: string;
  chapter: string;
  verse: string | null;
  format: string;
  versions: ScriptureVersion[];
}

export interface NotesResponse {
  reference: string;
  language: string;
  notes: TranslationNoteRow[];
}

export interface WordLinksResponse {
  reference: string;
  language: string;
  wordLinks: TranslationWordLinkRow[];
}

export interface QuestionsResponse {
  reference: string;
  language: string;
  questions: TranslationQuestionRow[];
}

export interface AcademyListResponse {
  language: string;
  articles: AcademyArticle[];
}

export interface AcademyArticleResponse {
  path: string;
  language: string;
  title: string;
  content: string;
}

export interface WordsListResponse {
  language: string;
  words: WordArticle[];
}

export interface WordArticleResponse {
  path: string;
  language: string;
  title: string;
  content: string;
}

export interface SearchResponse {
  query: string;
  language: string;
  results: ArticleSearchResult[];
}

export interface ResourcesResponse {
  language: string;
  available: ResourceAvailability[];
}

export interface QuoteToken {
  text: string;
  strong: string | null;
  lemma: string | null;
  morph: string | null;
  occurrence: number | null;
  semanticId: number;
}

export interface QuoteGatewayMatch {
  version: string;
  words: string[];
}

export interface QuoteResponse {
  reference: string;
  language: string;
  quote: string;
  occurrence: number;
  original: QuoteToken[];
  gateway: QuoteGatewayMatch[];
}

export interface LanguageEntry {
  lc: string;
  ln: string;
  ang: string;
  ld: string;
}

export interface LanguagesResponse {
  languages: LanguageEntry[];
}

/**
 * Build a convenience API client with typed endpoints.
 * Pass the `env` from your tool handler.
 */
export function createApiClient(env: ApiEnv): ApiClient {
  return new ApiClient(env);
}
