/**
 * Typed error taxonomy for the RAG pipeline.
 *
 * Error codes align with the ERROR_HANDLING.md taxonomy.
 * All errors carry a machine-readable `code` field plus optional context.
 */

export type RagErrorCode =
  // Input validation
  | "INVALID_REFERENCE"
  | "INVALID_LANGUAGE"
  | "INVALID_RESOURCE_ID"
  | "MISSING_REQUIRED_FIELD"
  // Vector DB
  | "VECTOR_STORE_UNAVAILABLE"
  | "VECTOR_STORE_TIMEOUT"
  | "VECTOR_STORE_UPSERT_FAILED"
  // KV / Redis
  | "KV_STORE_UNAVAILABLE"
  | "KV_STORE_TIMEOUT"
  // Embedding
  | "EMBEDDING_SERVICE_UNAVAILABLE"
  | "EMBEDDING_DIMENSION_MISMATCH"
  | "EMBEDDING_DAILY_CAP_EXCEEDED"
  // LLM
  | "LLM_SERVICE_UNAVAILABLE"
  | "LLM_DAILY_CAP_EXCEEDED"
  | "LLM_CONTENT_FILTERED"
  // Indexer
  | "INDEXER_ZIP_FETCH_FAILED"
  | "INDEXER_PARSE_FAILED"
  | "INDEXER_UNSUPPORTED_FORMAT"
  // Access control
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  // Generic
  | "INTERNAL_ERROR"
  | "NOT_FOUND";

export class RagError extends Error {
  readonly code: RagErrorCode;
  readonly statusCode: number;
  readonly context?: Record<string, unknown>;

  constructor(
    code: RagErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "RagError";
    this.code = code;
    this.statusCode = options?.statusCode ?? codeToHttpStatus(code);
    this.context = options?.context;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.context ? { context: this.context } : {}),
      },
    };
  }
}

function codeToHttpStatus(code: RagErrorCode): number {
  switch (code) {
    case "INVALID_REFERENCE":
    case "INVALID_LANGUAGE":
    case "INVALID_RESOURCE_ID":
    case "MISSING_REQUIRED_FIELD":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "NOT_FOUND":
      return 404;
    case "EMBEDDING_DAILY_CAP_EXCEEDED":
    case "LLM_DAILY_CAP_EXCEEDED":
    case "LLM_CONTENT_FILTERED":
      return 422;
    case "VECTOR_STORE_UNAVAILABLE":
    case "KV_STORE_UNAVAILABLE":
    case "EMBEDDING_SERVICE_UNAVAILABLE":
    case "LLM_SERVICE_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

export function isRagError(err: unknown): err is RagError {
  return err instanceof RagError;
}

export function toRagError(
  err: unknown,
  fallbackCode: RagErrorCode = "INTERNAL_ERROR",
): RagError {
  if (isRagError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new RagError(fallbackCode, message, { cause: err });
}
