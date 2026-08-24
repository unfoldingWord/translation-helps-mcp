/**
 * Shared parameter definitions and helpers used by all tool modules.
 *
 * Single canonical `reference` description — the primary cause of LLM confusion
 * was having 3 different descriptions across the codebase. There is exactly one here.
 */

import { z } from "zod";
import type { Env } from "../agent.js";

// ---------------------------------------------------------------------------
// Canonical parameter descriptions
// ---------------------------------------------------------------------------

export const REFERENCE_DESCRIPTION =
  "A full Bible passage: book name (or USFM code) + chapter + verse or verse range. " +
  "The book MUST be accompanied by chapter/verse — a bare book code is invalid. " +
  "The book name may be localized when it matches the `language` parameter. " +
  'Examples: "JHN 3:16", "John 3:16", "Juan 3:16" (language:"es"), "GEN 1:1-3", "MAT 5" (full chapter). ' +
  "Decomposed arguments {book, chapter, verse} and common non-standard codes (MAR, 2KGS) are also accepted.";

export const LANGUAGE_DESCRIPTION =
  "BCP-47 language code for the resource/response the user wants " +
  '(e.g. "hi", "es", "es-419", "fr", "pt-BR", "en"). ' +
  'CRITICAL: pass the user\'s requested language — do NOT omit this or use "en" ' +
  "when they asked for another language (Hindi, Spanish, etc.). " +
  "Gateway languages often have their own TW/TA on Door43; English is only correct when the user wants English. " +
  'Schema default is "en" only when language is omitted. Run list_languages for valid codes.';

export const FORMAT_DESCRIPTION =
  'Output format: "text" for plain prose, "json" for structured data (default), "md" for Markdown.';

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

export const referenceParam = z.string().min(3).describe(REFERENCE_DESCRIPTION);

export const languageParam = z
  .string()
  .min(2)
  .default("en")
  .describe(LANGUAGE_DESCRIPTION);

export const formatParam = z
  .enum(["text", "json", "md"])
  .default("json")
  .describe(FORMAT_DESCRIPTION);

// ---------------------------------------------------------------------------
// Tool module interface
// ---------------------------------------------------------------------------

// Accept both ZodObject and ZodEffects (for schemas that use .refine())
export type AnyZodSchema =
  | z.ZodObject<z.ZodRawShape>
  | z.ZodEffects<z.ZodObject<z.ZodRawShape>>;

export interface ToolModule<TInput extends AnyZodSchema> {
  /** Stable MCP tool name (snake_case). */
  name: string;
  /** Clear, LLM-optimised description. */
  description: string;
  /** Zod schema for the tool's input parameters. */
  inputSchema: TInput;
  /**
   * Optional Zod schema for the structured output (plain ZodRawShape for
   * registerTool). When present, MUST also accept the not-available envelope
   * via `withNotAvailableOutput(...)` — the SDK validates structuredContent
   * against this schema for every non-isError result.
   */
  outputSchema?: Record<string, z.ZodTypeAny>;
  /** MCP tool annotations for capability hints. */
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    title: string;
  };
  /**
   * The tool implementation.
   * Must return a valid MCP CallToolResult-compatible object.
   */
  handler(
    params: z.infer<TInput>,
    env: Env,
    requestId: string,
  ): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Output schema helpers (MCP outputSchema + RESOURCE_NOT_AVAILABLE)
// ---------------------------------------------------------------------------

/**
 * Fields for the `RESOURCE_NOT_AVAILABLE` envelope (`isError: false`).
 * Spread into every tool `outputSchema` (see `withNotAvailableOutput`).
 */
export const notAvailableOutputFields = {
  available: z
    .boolean()
    .optional()
    .describe("False when the requested resource is not available."),
  code: z
    .literal("RESOURCE_NOT_AVAILABLE")
    .optional()
    .describe('Present when available is false: "RESOURCE_NOT_AVAILABLE".'),
  message: z
    .string()
    .optional()
    .describe("Human-readable not-available message."),
  hints: z
    .array(z.string())
    .optional()
    .describe("Suggested next steps for the client / model."),
} as const;

/**
 * Merge a tool's success-shape fields with the not-available envelope fields.
 *
 * Success fields should be `.optional()` so the not-available payload validates.
 * The MCP SDK wraps this shape in `z.object()` and rejects non-conforming
 * structuredContent on any result where `isError` is not true.
 */
export function withNotAvailableOutput(
  successFields: Record<string, z.ZodTypeAny>,
): Record<string, z.ZodTypeAny> {
  return { ...successFields, ...notAvailableOutputFields };
}

// ---------------------------------------------------------------------------
// Standard result helpers
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  cacheStatus?: "hit" | "miss" | "stale" | "none";
}

/**
 * Build a successful result.
 *
 * `structuredContent` is the authoritative data channel for modern MCP clients
 * that support it (spec 2025-06-18+).
 *
 * `content` always includes a compact JSON payload so that stdio clients and
 * older HTTP clients that only read `content` still receive usable data.
 * The optional human-readable summary is prepended when provided.
 */
export function ok(data: unknown, humanText?: string): ToolResult {
  const structured = data as Record<string, unknown>;
  const content: Array<{ type: "text"; text: string }> = [];
  if (humanText) {
    content.push({ type: "text", text: humanText });
  }
  // Compact JSON fallback — keeps stdio / legacy clients functional
  content.push({ type: "text", text: JSON.stringify(data) });
  return { content, structuredContent: structured, isError: false };
}

/**
 * Build a "resource not available" result (upstream issues #30 / #12 contract).
 *
 * IMPORTANT: isError is deliberately false. Returning isError:true for missing
 * data causes downstream MCP clients to treat the response as a server failure
 * (potentially tripping circuit-breakers). A structured "not available" result
 * lets the LLM communicate the gap gracefully without implying an outage.
 *
 * Use this when a resource genuinely does not exist for the requested
 * language/book (e.g. no TQ data for Mark, unpublished Psalms scripture).
 * Keep throwing for truly unexpected errors (zip fetch failures, parse errors).
 */
export function notAvailable(description: string, extra?: string): ToolResult {
  const message =
    `No ${description} available for this reference or language.` +
    (extra ? ` ${extra}` : "");
  const data = {
    available: false,
    code: "RESOURCE_NOT_AVAILABLE",
    message,
    hints: ["Run list_resources to see what is available for this language."],
  };
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data as unknown as Record<string, unknown>,
    isError: false,
  };
}

/** Build a successful result with a cache status hint (for the metrics layer). */
export function okCached(
  data: unknown,
  cacheStatus: "hit" | "miss" | "stale" | "none",
  humanText?: string,
): ToolResult {
  const result = ok(data, humanText);
  return { ...result, cacheStatus };
}

/** Map REST `meta.cache` values to Analytics cacheStatus. */
export function mapApiCacheStatus(
  cache?: string,
): "hit" | "miss" | "stale" | "none" {
  if (!cache) return "none";
  if (cache === "kv" || cache === "memory") return "hit";
  if (cache === "r2") return "stale";
  if (cache === "network") return "miss";
  return "none";
}
