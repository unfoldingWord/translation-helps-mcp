/**
 * SkillService — high-level chat primitives for translation assistance.
 *
 * Implements the skill primitives:
 *   1. fetchPassageWithNotesAndLinks() — bundle assembly via get_bundle tool
 *   2. generateTranslationHelp()       — LLM generation from a bundle
 *   3. searchArticles()                — concept search via search_articles tool
 *   4. composeTranslationReport()      — fetchPassage + generateHelp combined
 */

import type { Bundle } from "../rag/BundleCache.js";
import type { LLMProvider } from "../rag/providers/LLMProvider.js";
import { PromptFormatter } from "../rag/PromptFormatter.js";

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

export interface SearchArticlesOptions {
  language?: string;
  resourceTypes?: Array<"ta" | "tw">;
  topK?: number;
  requestId?: string;
}

export interface ArticleSearchHit {
  path: string;
  title: string;
  resourceType: "ta" | "tw";
  score: number;
}

export interface SearchArticlesResult {
  query: string;
  language: string;
  results: ArticleSearchHit[];
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
      includeScripture: true,
      includeNotes: true,
      includeWords: opts.includeTA ?? true,
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
   * Primitive 3: Lexical article search (replaces rag_query).
   */
  async searchArticles(
    query: string,
    opts: SearchArticlesOptions = {},
  ): Promise<SearchArticlesResult> {
    const requestId =
      opts.requestId ?? this.ctx.requestId ?? generateRequestId();
    const language = opts.language ?? "en";

    const params: Record<string, unknown> = { query, language, requestId };
    if (opts.resourceTypes?.length) params["resourceTypes"] = opts.resourceTypes;
    if (opts.topK) params["topK"] = opts.topK;

    const result = await this.ctx.callTool("search_articles", params);
    return extractSearchResult(result, query, language);
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
    scripture: { versions: [], format: "plain" },
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
 * Extract a SearchArticlesResult from an unknown MCP tool response.
 */
function extractSearchResult(
  result: unknown,
  query: string,
  language: string,
): SearchArticlesResult {
  const fallback: SearchArticlesResult = { query, language, results: [] };
  if (!result || typeof result !== "object") return fallback;
  const r = result as Record<string, unknown>;
  const results = (r["results"] as ArticleSearchHit[] | undefined) ?? [];
  return { query, language: String(r["language"] ?? language), results };
}
