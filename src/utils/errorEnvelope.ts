import { logger } from "./logger.js";

export type ErrorEnvelope = {
  code: string;
  message: string;
  hint?: string;
  howToFix?: string;
  examples?: string[];
  docs?: string;
  traceId?: string;
  type?: string; // for tests expecting classification
};

export function errorEnvelope(
  code: string,
  message: string,
  extras: Partial<ErrorEnvelope> = {},
): ErrorEnvelope {
  const env: ErrorEnvelope = {
    code,
    message,
    ...extras,
  };
  logger.warn(`Error: ${code} - ${message}`);
  return env;
}

/**
 * Stable, machine-readable code signalling that a requested resource exists
 * conceptually (valid book/language) but is simply not published/available.
 *
 * Consumers (e.g. bt-servant-worker) MUST treat this as an expected
 * "not available" outcome — NOT a server outage. See issue #30.
 */
export const RESOURCE_NOT_AVAILABLE = "RESOURCE_NOT_AVAILABLE" as const;

/**
 * A plain Error carrying a stable `code` + HTTP `status` (+ optional `type`).
 *
 * We attach these as duck-typed properties rather than using an Error subclass
 * because errors cross dynamic `await import(...)` module boundaries throughout
 * the services, where `instanceof` checks are unreliable. The rest of the
 * codebase already reads `.status`/`.code` off plain Errors (see
 * extractErrorStatus / BaseService.isServiceError).
 */
export interface AppError extends Error {
  code?: string;
  status?: number;
  type?: string;
  // Preserved retry-hint fields used by the resource services
  languageVariants?: string[];
  requestedLanguage?: string;
  [key: string]: unknown;
}

/**
 * Build a plain Error carrying a stable code + HTTP status + type.
 * Any `extras` (e.g. languageVariants, requestedLanguage) are attached verbatim.
 */
export function makeCodedError(
  message: string,
  opts: {
    code: string;
    status: number;
    type?: string;
    extras?: Record<string, unknown>;
  },
): AppError {
  const err = new Error(message) as AppError;
  err.code = opts.code;
  err.status = opts.status;
  err.type = opts.type ?? "NOT_AVAILABLE";
  if (opts.extras) Object.assign(err, opts.extras);
  return err;
}

/**
 * Build a RESOURCE_NOT_AVAILABLE (HTTP 404) error for an unpublished/unavailable
 * resource. Distinct from an INVALID reference/book code (which stays 400).
 */
export function resourceNotAvailable(
  message: string,
  extras?: Record<string, unknown>,
): AppError {
  return makeCodedError(message, {
    code: RESOURCE_NOT_AVAILABLE,
    status: 404,
    type: "NOT_AVAILABLE",
    extras,
  });
}

export const Errors = {
  missingParameter(param: string, traceId?: string): ErrorEnvelope {
    return errorEnvelope(
      "MISSING_PARAMETER",
      `Missing required parameter: ${param}`,
      {
        hint: `Provide a value for '${param}'.`,
        howToFix: `Add ?${param}=... to the query string.`,
        examples: [
          param === "reference"
            ? "/api/fetch-scripture?reference=John%203:16"
            : `?${param}=value`,
        ],
        docs: "/docs/ENDPOINT_BEHAVIOR_SPECIFICATION.md",
        traceId,
        type: "VALIDATION_ERROR",
      },
    );
  },

  internal(traceId?: string): ErrorEnvelope {
    return errorEnvelope("INTERNAL_ERROR", "An unexpected error occurred", {
      hint: "Try again. If the issue persists, contact support.",
      traceId,
      type: "INTERNAL_ERROR",
    });
  },

  resourceNotAvailable(message: string, traceId?: string): ErrorEnvelope {
    return errorEnvelope(RESOURCE_NOT_AVAILABLE, message, {
      hint: "This resource is not published for the requested language/organization. It is not a server outage.",
      type: "NOT_AVAILABLE",
      traceId,
    });
  },
};
