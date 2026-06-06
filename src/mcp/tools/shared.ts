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
  'Examples: "JHN 3:16", "John 3:16", "Juan 3:16" (language:"es"), "GEN 1:1-3", "MAT 5" (full chapter).';

export const LANGUAGE_DESCRIPTION =
  "BCP-47 language code. Accepts both base codes and region variants: " +
  '"en", "es", "es-419", "fr", "pt-BR". ' +
  'Defaults to "en". Run list_languages to see all available codes.';

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
  /** Optional Zod schema for the structured output (plain ZodRawShape for registerTool). */
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
 * (protocol >= 2025-11-05) that support it.
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

/** Build a successful result with a cache status hint (for the metrics layer). */
export function okCached(
  data: unknown,
  cacheStatus: "hit" | "miss" | "stale",
  humanText?: string,
): ToolResult {
  const result = ok(data, humanText);
  return { ...result, cacheStatus };
}
