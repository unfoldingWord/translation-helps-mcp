/**
 * SkillService — high-level chat primitives for translation assistance.
 *
 * Implements the four skill primitives from SKILL_LAYER.md:
 *   1. fetchPassageWithNotesAndLinks() — bundle assembly via MCP tools
 *   2. generateTranslationHelp()       — LLM generation from a bundle
 *   3. queryRAG()                      — transparent pass-through to rag_query
 *   4. composeTranslationReport()      — fetchPassage + generateHelp combined
 *
 * Key rule: Skill calls rag_query THROUGH callTool() (MCP tool wrapper),
 * preserving input validation, rate limiting, and logging.
 * Exception: background warmers call getBundle() directly on RagService.
 *
 * See SKILL_LAYER.md for authoritative pseudocode.
 */

import type { Bundle } from "../services/rag/BundleCache.js";
import type { LLMProvider } from "../services/rag/providers/LLMProvider.js";
import { PromptFormatter } from "../services/rag/PromptFormatter.js";
import type { QueryResult } from "../services/rag/RagService.js";
import type { VectorStoreQueryResult } from "../services/rag/interfaces.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillContext {
  /**
   * Adapter that routes MCP callTool requests.
   * In production: delegates to MCP tool registry (validation + rate limiting).
   * In tests: can be replaced with a direct RagService stub.
   */
  callTool: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  llmProvider: LLMProvider;
  requestId?: string;
}

export interface FetchPassageOptions {
  language: string;
  reference: string;
  includeTA?: boolean;
  maxArticles?: number;
  requestId?: string;
}

export interface GenerateOptions {
  maxTokens?: number;
  citations?: boolean;
  requestId?: string;
}

export interface Citation {
  path: string;
  title?: string;
}

export interface GenerateResult {
  response: string;
  citations: Citation[];
}

export interface QueryRAGOptions {
  language?: string;
  reference?: string;
  filters?: Record<string, unknown>;
  k?: number;
  enableExact?: boolean;
  requestId?: string;
}

export interface ComposeResult {
  response: string;
  citations: Citation[];
  bundle: Bundle;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// SkillService
// ---------------------------------------------------------------------------

export class SkillService {
  private readonly fmt: PromptFormatter;

  constructor(private readonly ctx: SkillContext) {
    this.fmt = new PromptFormatter();
  }

  /**
   * Primitive 1: Fetch passage with notes and linked TW/TA articles.
   *
   * Orchestration (per SKILL_LAYER.md):
   *   1. Call get_bundle MCP tool (which handles caching + rag_query internally)
   *   2. The bundle is returned with scripture placeholder (real scripture
   *      is fetched by MCP layer or pre-populated via ZipResourceFetcher2)
   */
  async fetchPassageWithNotesAndLinks(
    opts: FetchPassageOptions,
  ): Promise<Bundle> {
    const requestId =
      opts.requestId ?? this.ctx.requestId ?? generateRequestId();

    const result = await this.ctx.callTool("get_bundle", {
      language: opts.language,
      reference: opts.reference,
      includeTA: opts.includeTA ?? true,
      maxArticles: opts.maxArticles ?? 30,
      requestId,
    });

    return extractBundle(result, opts.language, opts.reference);
  }

  /**
   * Primitive 2: Generate translation help from a bundle via LLM.
   */
  async generateTranslationHelp(
    bundle: Bundle,
    userPrompt: string,
    opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const { systemPrompt, userPrompt: formattedUser } = this.fmt.formatReport(
      bundle,
      userPrompt,
    );

    let response = "";

    try {
      response = await this.ctx.llmProvider.generate(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: formattedUser },
        ],
        {
          maxTokens: opts.maxTokens ?? 1024,
          temperature: 0.3,
        },
      );
    } catch {
      // LLM unavailable — return empty response with warning (per SKILL_LAYER.md fallback)
      response = "[LLM_UNAVAILABLE: Generation service is not available.]";
    }

    const citations = opts.citations !== false ? parseCitations(response) : [];

    return { response, citations };
  }

  /**
   * Primitive 3: Transparent pass-through to rag_query MCP tool.
   */
  async queryRAG(
    query: string,
    opts: QueryRAGOptions = {},
  ): Promise<QueryResult> {
    const requestId =
      opts.requestId ?? this.ctx.requestId ?? generateRequestId();

    const params: Record<string, unknown> = { query, requestId };
    if (opts.language) params["language"] = opts.language;
    if (opts.reference) params["reference"] = opts.reference;
    if (opts.filters) params["filters"] = opts.filters;
    if (opts.k) params["k"] = opts.k;
    if (opts.enableExact !== undefined)
      params["enableExact"] = opts.enableExact;

    const result = await this.ctx.callTool("rag_query", params);
    return extractQueryResult(result, query, opts.language ?? "");
  }

  /**
   * Primitive 4: Compose a full translation report (fetch + generate).
   */
  async composeTranslationReport(
    reference: string,
    language: string,
    userPrompt?: string,
    opts: GenerateOptions & FetchPassageOptions = {} as FetchPassageOptions,
  ): Promise<ComposeResult> {
    const start = Date.now();
    const requestId =
      opts.requestId ?? this.ctx.requestId ?? generateRequestId();

    const bundle = await this.fetchPassageWithNotesAndLinks({
      language,
      reference,
      includeTA: true,
      requestId,
    });

    const prompt =
      userPrompt ??
      `Provide translation help for ${reference} in ${language}, explaining key concepts and translation decisions.`;

    const { response, citations } = await this.generateTranslationHelp(
      bundle,
      prompt,
      { maxTokens: opts.maxTokens, citations: true, requestId },
    );

    return {
      response,
      citations,
      bundle,
      latencyMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSkillService(ctx: SkillContext): SkillService {
  return new SkillService(ctx);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRequestId(): string {
  return `${Date.now().toString(16)}-${Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0")}`;
}

/**
 * Parse [Source: path] citation markers from LLM output.
 */
function parseCitations(text: string): Citation[] {
  const re = /\[Source:\s*([^\]]+)\]/g;
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1]!.trim();
    if (!seen.has(path)) {
      seen.add(path);
      citations.push({ path });
    }
  }
  return citations;
}

/**
 * Extract a Bundle from an unknown MCP tool response.
 * Handles both wrapped ({bundle: ...}) and unwrapped forms.
 */
function extractBundle(
  result: unknown,
  language: string,
  reference: string,
): Bundle {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const b = (r["bundle"] ?? result) as Record<string, unknown>;
    if (b && typeof b === "object" && "notes" in b) {
      return b as unknown as Bundle;
    }
  }
  // Fallback empty bundle
  return {
    scripture: { text: "", format: "plain" },
    notes: [],
    tw: [],
    ta: [],
    metadata: {
      cacheStatus: "miss",
      license: "CC BY-SA 4.0",
      language,
      reference,
      provenance: [],
    },
  };
}

/**
 * Extract a QueryResult from an unknown MCP tool response.
 */
function extractQueryResult(
  result: unknown,
  query: string,
  language: string,
): QueryResult {
  const fallback: QueryResult = {
    requestId: generateRequestId(),
    query,
    language,
    documents: [],
    fallbackMode: "empty",
    cacheStatus: "miss",
    latencyMs: 0,
  };

  if (!result || typeof result !== "object") return fallback;
  const r = result as Record<string, unknown>;

  const docs = (r["documents"] as VectorStoreQueryResult[] | undefined) ?? [];
  return {
    ...fallback,
    documents: docs,
    fallbackMode: (r["fallbackMode"] as QueryResult["fallbackMode"]) ?? "ann",
    cacheStatus: (r["cacheStatus"] as QueryResult["cacheStatus"]) ?? "miss",
    latencyMs: (r["latencyMs"] as number) ?? 0,
    requestId: (r["requestId"] as string) ?? fallback.requestId,
  };
}
