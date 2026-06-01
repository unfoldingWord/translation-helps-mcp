/**
 * Unified error taxonomy for translation-helps-mcp v2.
 *
 * Stable machine-readable codes used as:
 *   1. Structured MCP error response codes (isError:true content)
 *   2. Log dedup keys for the error→GitHub-issues automation
 *   3. HTTP status mapping for any HTTP surfaces
 */

export const ErrorCode = {
  // Input validation
  INVALID_REFERENCE: "INVALID_REFERENCE",
  INVALID_LANGUAGE: "INVALID_LANGUAGE",
  INVALID_PARAMS: "INVALID_PARAMS",
  MISSING_REQUIRED_PARAM: "MISSING_REQUIRED_PARAM",

  // Resource access
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  UPSTREAM_DCS_ERROR: "UPSTREAM_DCS_ERROR",
  ZIP_FETCH_ERROR: "ZIP_FETCH_ERROR",

  // RAG / AI
  VECTOR_STORE_UNAVAILABLE: "VECTOR_STORE_UNAVAILABLE",
  EMBEDDING_DAILY_CAP_EXCEEDED: "EMBEDDING_DAILY_CAP_EXCEEDED",
  EMBEDDING_ERROR: "EMBEDDING_ERROR",

  // Auth / rate
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",

  // General
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** HTTP status mapping for error codes. */
export const ERROR_STATUS: Record<ErrorCodeValue, number> = {
  [ErrorCode.INVALID_REFERENCE]: 400,
  [ErrorCode.INVALID_LANGUAGE]: 400,
  [ErrorCode.INVALID_PARAMS]: 400,
  [ErrorCode.MISSING_REQUIRED_PARAM]: 400,
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.UPSTREAM_DCS_ERROR]: 502,
  [ErrorCode.ZIP_FETCH_ERROR]: 502,
  [ErrorCode.VECTOR_STORE_UNAVAILABLE]: 503,
  [ErrorCode.EMBEDDING_DAILY_CAP_EXCEEDED]: 503,
  [ErrorCode.EMBEDDING_ERROR]: 503,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
};

export interface ErrorHint {
  message: string;
  example?: string;
}

export class TranslationHelpsError extends Error {
  readonly code: ErrorCodeValue;
  readonly statusCode: number;
  readonly hints: ErrorHint[];
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(options: {
    code: ErrorCodeValue;
    message: string;
    hints?: ErrorHint[];
    retryable?: boolean;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "TranslationHelpsError";
    this.code = options.code;
    this.statusCode = ERROR_STATUS[options.code] ?? 500;
    this.hints = options.hints ?? [];
    this.retryable = options.retryable ?? false;
    this.context = options.context;
  }

  /**
   * The structured error payload returned to MCP clients
   * inside `structuredContent` alongside `isError: true`.
   */
  toMcpError(): {
    code: string;
    message: string;
    hints: ErrorHint[];
    retryable: boolean;
  } {
    return {
      code: this.code,
      message: this.message,
      hints: this.hints,
      retryable: this.retryable,
    };
  }
}

export function isTranslationHelpsError(
  e: unknown,
): e is TranslationHelpsError {
  return e instanceof TranslationHelpsError;
}

/** Convenience constructors */
export const Errors = {
  invalidReference(reference: string): TranslationHelpsError {
    return new TranslationHelpsError({
      code: ErrorCode.INVALID_REFERENCE,
      message: `Invalid reference: "${reference}"`,
      hints: [
        {
          message:
            'Include book + chapter + verse. Examples: "JHN 3:16", "John 3:16", "GEN 1:1-3", "MAT 5".',
        },
        {
          message:
            'Use the language code matching the book name language. For Spanish books, add language:"es".',
        },
      ],
    });
  },

  invalidLanguage(language: string): TranslationHelpsError {
    return new TranslationHelpsError({
      code: ErrorCode.INVALID_LANGUAGE,
      message: `Unknown language code: "${language}"`,
      hints: [
        {
          message:
            'Use a BCP-47 language code like "en", "es", "es-419", "fr". Run list_languages to see what is available.',
        },
      ],
    });
  },

  missingParam(paramName: string, toolName: string): TranslationHelpsError {
    return new TranslationHelpsError({
      code: ErrorCode.MISSING_REQUIRED_PARAM,
      message: `Missing required parameter "${paramName}" for tool "${toolName}"`,
      hints: [{ message: `Provide a value for "${paramName}" and retry.` }],
    });
  },

  resourceNotFound(description: string): TranslationHelpsError {
    return new TranslationHelpsError({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: `Resource not found: ${description}`,
      hints: [
        {
          message:
            "Run list_resources_for_language to see what is available for this language.",
        },
      ],
    });
  },

  upstreamError(url: string, status: number): TranslationHelpsError {
    return new TranslationHelpsError({
      code: ErrorCode.UPSTREAM_DCS_ERROR,
      message: `Door43 catalog returned HTTP ${status} for ${url}`,
      retryable: true,
    });
  },

  unauthorized(): TranslationHelpsError {
    return new TranslationHelpsError({
      code: ErrorCode.UNAUTHORIZED,
      message: "Admin token required. Set the adminToken parameter.",
      hints: [{ message: "Only administrators can call this tool." }],
    });
  },

  internal(message: string, cause?: unknown): TranslationHelpsError {
    return new TranslationHelpsError({
      code: ErrorCode.INTERNAL_ERROR,
      message,
      retryable: false,
      cause,
    });
  },
};
