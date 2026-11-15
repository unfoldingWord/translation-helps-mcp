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

import type { ApiErrorResponse } from "@translation-helps/door43";
import {
  INTERNAL_INDEX_HEADER,
  INTERNAL_INDEX_VALUE,
} from "../core/internalIndex.js";
import {
  ApiTimeoutError,
  isTimeoutSignal,
  noteV3ApiResponse,
  v3ApiTimeoutMs,
} from "./v3/apiTiming.js";
import { attemptPacks3, type Packs3Mode } from "../packs3/answer.js";
import type { Packs3Env } from "../packs3/catalogs.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** The timeout signal for a response whose headers already arrived. */
const bodySignals = new WeakMap<Response, AbortSignal>();

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
  /** Format 3 reads (see src/packs3). Without LANGUAGE_PACKS no format 3 read is tried. */
  LANGUAGE_PACKS?: R2Bucket;
  PACKS_V3?: string;
  PACKS_V3_TRUSTED_KEYS?: string;
  PACKS_V3_DEBUG?: string;
  /** Set per request by the stateless handler from `x-th-packs3`, only when PACKS_V3_DEBUG is "on". */
  PACKS3_MODE?: string;
  /** Set per request by the stateless handler only when PACKS_V3_DEBUG is "on": every get records its outcome. */
  PACKS3_TRACE?: Packs3Trace;
}

/** One entry per ApiClient.get: served from format 3, or the fallback reason. */
export type Packs3Outcome =
  | { served: true }
  | { fallback: string; detail?: string };
export type Packs3Trace = Packs3Outcome[];

/** The `_packs3` mark of one tool call: the first fallback (with its inner `detail`, if any), else served. */
export function packs3Mark(trace: Packs3Trace): Packs3Outcome | undefined {
  const fb = trace.find(
    (o): o is { fallback: string; detail?: string } => "fallback" in o,
  );
  if (fb)
    return {
      fallback: fb.fallback,
      ...(fb.detail ? { detail: fb.detail } : {}),
    };
  return trace.length ? { served: true } : undefined;
}

export type ApiClientOptions = { packs3?: Packs3Env & { mode?: Packs3Mode } };

/** `x-th-packs3: off | only`, honoured only with PACKS_V3_DEBUG === "on". */
export function packs3ModeFromRequest(
  request: Request,
  env: { PACKS_V3_DEBUG?: string },
): Packs3Mode | undefined {
  if (env.PACKS_V3_DEBUG !== "on") return undefined;
  const v = request.headers.get("x-th-packs3");
  return v === "off" || v === "only" ? v : undefined;
}

// ---------------------------------------------------------------------------
// ApiClient
// ---------------------------------------------------------------------------

function isLocalApiBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** The error of a non-2xx answer with this status and (parsed) body, as `ApiClient.get` throws it. */
function apiErrorOf(status: number, raw: unknown): ApiClientError {
  let code = "API_ERROR";
  let message = `HTTP ${status}`;
  let retryable = status >= 500;
  const body = raw as ApiErrorResponse | undefined;
  if (body?.error) {
    code = body.error.code ?? code;
    message = body.error.message ?? message;
    retryable = body.error.retryable ?? retryable;
  }
  return new ApiClientError(code, message, status, retryable);
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher | null;
  private readonly packs3?: Packs3Env & { mode?: Packs3Mode };
  private readonly trace?: Packs3Trace;

  constructor(env: ApiEnv, options?: ApiClientOptions) {
    this.trace = env.PACKS_V3_DEBUG === "on" ? env.PACKS3_TRACE : undefined;
    this.packs3 =
      options?.packs3 ??
      (env.LANGUAGE_PACKS
        ? {
            LANGUAGE_PACKS: env.LANGUAGE_PACKS,
            PACKS_V3: env.PACKS_V3,
            PACKS_V3_TRUSTED_KEYS: env.PACKS_V3_TRUSTED_KEYS,
            mode:
              env.PACKS_V3_DEBUG === "on" &&
              (env.PACKS3_MODE === "off" || env.PACKS3_MODE === "only")
                ? env.PACKS3_MODE
                : undefined,
          }
        : undefined);
    const base = env.API_BASE_URL?.replace(/\/$/, "");

    // Vite's platformProxy and unbound wrangler service bindings expose env.API
    // without a connected API worker → fetches return HTTP 503. Prefer an
    // explicit localhost API_BASE_URL so local chat hits the real API on :8788.
    if (base && isLocalApiBaseUrl(base)) {
      this.fetcher = null;
      this.baseUrl = base;
    } else if (env.API) {
      // Service binding — zero-latency same-datacenter call.
      // fetch() on a Fetcher accepts any URL; we still need a hostname so
      // requests are valid HTTP. We use a placeholder that the binding ignores.
      this.fetcher = env.API;
      this.baseUrl = "http://internal";
    } else if (base) {
      this.fetcher = null;
      this.baseUrl = base;
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
  async get<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const p3 = this.packs3;
    const mode = p3?.mode ?? "auto";
    if (p3 && mode !== "off") {
      const a = await attemptPacks3(p3, path, params ?? {});
      if (a.hit) {
        this.trace?.push({ served: true });
        // A proven route error (a term lookup's 404 miss): the same error the API's own answer gives below.
        if (a.status !== undefined) throw apiErrorOf(a.status, a.value);
        return a.value as T;
      }
      this.trace?.push({
        fallback: a.reason,
        ...(a.detail ? { detail: a.detail } : {}),
      });
      if (mode === "only") {
        throw new ApiClientError("PACKS3_FALLBACK", a.reason, 404, false);
      }
    } else {
      this.trace?.push({ fallback: p3 ? "mode-off" : "no-packs" });
    }

    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await this.fetchUrl(url.toString(), true);

    if (!response.ok) {
      let body: ApiErrorResponse | undefined;
      try {
        body = await this.readJson<ApiErrorResponse>(response);
      } catch (error) {
        if (error instanceof ApiTimeoutError) throw error;
        // ignore JSON parse failure
      }
      throw apiErrorOf(response.status, body);
    }

    return this.readJson<T>(response);
  }

  /**
   * Fire a background prefetch request to warm REST API caches for
   * `reference` + `language`. Returns the fetch Promise so callers can
   * `waitUntil` it (MCP side) — never blocks the scripture response path.
   *
   * The REST API worker also uses ctx.waitUntil() for its own warming work.
   * Errors are silently ignored.
   */
  prefetch(reference: string, language: string): Promise<void> {
    const url = new URL(`${this.baseUrl}/api/v1/prefetch`);
    url.searchParams.set("reference", reference);
    url.searchParams.set("language", language);
    return this.fetchUrl(url.toString(), false)
      .then(() => undefined)
      .catch(() => undefined);
  }

  private async fetchUrl(url: string, timed: boolean): Promise<Response> {
    const init: RequestInit = { ...(indexRequestInit(url) ?? {}) };
    const timeoutMs = v3ApiTimeoutMs();
    let signal: AbortSignal | undefined;
    if (timeoutMs && timeoutMs > 0) {
      signal = AbortSignal.timeout(timeoutMs);
      init.signal = signal;
    }
    const started = Date.now();
    try {
      const response = this.fetcher
        ? await this.fetcher.fetch(url, init)
        : await fetch(url, init);
      if (signal) bodySignals.set(response, signal);
      if (timed) {
        noteV3ApiResponse(
          response.headers.get("Server-Timing"),
          started,
          Date.now(),
        );
      }
      return response;
    } catch (error) {
      if (timeoutMs && isTimeoutSignal(error)) {
        if (timed) noteV3ApiResponse(null, started, Date.now());
        throw new ApiTimeoutError();
      }
      throw error;
    }
  }

  /**
   * Read a JSON body. An abort while the body is still arriving is the same
   * 20s deadline as an abort of `fetch` itself.
   */
  private async readJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch (error) {
      const signal = bodySignals.get(response);
      if (signal?.aborted && isTimeoutSignal(error)) {
        throw new ApiTimeoutError();
      }
      throw error;
    }
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
} from "@translation-helps/door43";

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
function indexRequestInit(url: string): RequestInit | undefined {
  try {
    if (new URL(url).searchParams.get("fields") !== "index") return undefined;
  } catch {
    return undefined;
  }
  return {
    headers: { [INTERNAL_INDEX_HEADER]: INTERNAL_INDEX_VALUE },
  };
}

export function createApiClient(env: ApiEnv): ApiClient {
  return new ApiClient(env);
}
