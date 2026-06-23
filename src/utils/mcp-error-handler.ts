/**
 * MCP Error Handler Utility
 *
 * Provides consistent error handling and formatting for MCP tools.
 * Eliminates duplication of error handling logic across all tools.
 */

import { logger } from "./logger.js";
import { RESOURCE_NOT_AVAILABLE } from "./errorEnvelope.js";

/**
 * Extract error message from unknown error type
 * Shared utility to avoid duplication of error instanceof Error checks
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  // Plain ServiceError-shaped objects ({code, message, status}) carry the
  // message as a property — read it rather than stringifying to "[object Object]".
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

/**
 * Extract HTTP status code from error if present.
 * Handles both Error instances and plain ServiceError-shaped objects.
 */
export function extractErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 600) {
      return status;
    }
  }
  return undefined;
}

/**
 * Extract a stable error code from error if present.
 * Handles both Error instances and plain ServiceError-shaped objects.
 */
export function extractErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Keys carrying caller-facing recovery hints that should survive on a
 * "resource not available" result (so the model can suggest alternatives).
 * This is an allowlist: anything NOT here (stack, endpoint/path/params,
 * timestamps, traces) must never leak into the model-facing result (PR #31).
 */
const RETRY_HINT_KEYS = [
  "languageVariants",
  "requestedLanguage",
  "availableVariants",
  "baseLanguage",
  "suggestion",
  "validBookCodes",
  "invalidCode",
  "availableBooks",
  "toc",
] as const;

/**
 * Some endpoints append a verbose `(Trace: {...})` X-ray blob to their error
 * MESSAGE (e.g. fetch-translation-word/-academy routes). That diagnostic must
 * not ride along in the model-facing "not available" result (PR #31 review).
 */
export function stripInlineDiagnostics(message: string): string {
  return message.replace(/\s*\(Trace:\s*\{[\s\S]*\}\)\s*$/, "").trim();
}

/**
 * If the error represents a "resource not available" condition (HTTP 404 family
 * — e.g. an unpublished resource or an unavailable language) rather than a
 * server failure, return a NORMAL (isError:false) MCP result describing the
 * unavailability. Otherwise return null so the caller falls back to
 * handleMCPError (isError:true).
 *
 * This is the crux of issue #30: a not-available response must NOT look like a
 * tool error, because bt-servant-worker converts any isError:true into a health
 * failure that, after 3 strikes, reports the server as "down".
 */
export function buildResourceUnavailableResult(
  error: unknown,
): MCPErrorResponse | null {
  const status = extractErrorStatus(error);
  const code = extractErrorCode(error);
  const isNotAvailable = status === 404 || code === RESOURCE_NOT_AVAILABLE;
  if (!isNotAvailable) return null;

  const message = stripInlineDiagnostics(extractErrorMessage(error));

  const payload: Record<string, unknown> = {
    available: false,
    code: code || RESOURCE_NOT_AVAILABLE,
    status: status || 404,
    message,
  };

  // Promote only allowlisted recovery hints — from the top level OR nested in a
  // `details` object — and never the raw `details` blob (which may carry a stack
  // trace or other diagnostics). See PR #31 review.
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const nested =
      e.details && typeof e.details === "object"
        ? (e.details as Record<string, unknown>)
        : {};
    for (const key of RETRY_HINT_KEYS) {
      const value = e[key] !== undefined ? e[key] : nested[key];
      if (value !== undefined) payload[key] = value;
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError: false,
  };
}

export interface MCPErrorResponse {
  content?: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface ErrorContext {
  /** Name of the tool that failed */
  toolName: string;
  /** Arguments passed to the tool (for logging context) */
  args: Record<string, unknown>;
  /** Start time of the operation (from Date.now()) */
  startTime: number;
  /** The original error that occurred */
  originalError: unknown;
  /** Additional context for the error */
  additionalContext?: Record<string, unknown>;
}

/**
 * Handle errors consistently across all MCP tools
 *
 * Provides:
 * - Consistent error logging with context
 * - MCP-compliant error response format
 * - Automatic response time calculation
 * - Structured error information
 *
 * @param context - Error context information
 * @returns MCP-formatted error response
 *
 * @example
 * ```typescript
 * try {
 *   // ... tool logic ...
 * } catch (error) {
 *   return handleMCPError({
 *     toolName: "fetch_scripture",
 *     args: { reference: args.reference },
 *     startTime,
 *     originalError: error,
 *   });
 * }
 * ```
 */
export function handleMCPError(context: ErrorContext): MCPErrorResponse {
  const {
    toolName,
    args,
    startTime,
    originalError,
    additionalContext = {},
  } = context;

  const errorMessage =
    originalError instanceof Error
      ? originalError.message
      : String(originalError);

  const code = extractErrorCode(originalError);
  const status = extractErrorStatus(originalError);

  const responseTime = Date.now() - startTime;

  // Log error with full context
  logger.error(`Failed to execute ${toolName}`, {
    ...args,
    ...additionalContext,
    error: errorMessage,
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
    responseTime,
    timestamp: new Date().toISOString(),
    // Include stack trace if available
    ...(originalError instanceof Error && originalError.stack
      ? { stack: originalError.stack.split("\n").slice(0, 5) }
      : {}),
  });

  // Return MCP-compliant error response
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: errorMessage,
            ...(code ? { code } : {}),
            ...(status ? { status } : {}),
            tool: toolName,
            timestamp: new Date().toISOString(),
            responseTime,
            ...(args && Object.keys(args).length > 0 ? { args } : {}),
            ...additionalContext,
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

/**
 * Create a standardized error response for validation failures
 *
 * @param toolName - Name of the tool
 * @param validationErrors - Array of validation error messages
 * @returns MCP-formatted error response
 */
export function createValidationErrorResponse(
  toolName: string,
  validationErrors: string[],
): MCPErrorResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: "Validation failed",
            tool: toolName,
            validationErrors,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}
