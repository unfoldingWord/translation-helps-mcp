/**
 * RagService — the core orchestrator for the RAG pipeline.
 *
 * Implements query() (T-09) and getBundle() + indexResource() (T-10).
 *
 * Architecture:
 *   query() → embed query → 3×topK ANN → Tier-1 Reranker → topK
 *             → lexical fallback if ANN returns 0 results
 *
 * See DETAILED_SPEC.md and CACHING_STRATEGY.md for canonical behaviour.
 */

import type {
  VectorStore,
  KVStore,
  ServiceContext,
  VectorStoreFilters,
  VectorStoreQueryResult,
} from "./interfaces.js";
import type { EmbeddingService } from "./providers/EmbeddingService.js";
import { Reranker, type RerankConfig } from "./Reranker.js";
import { RagError } from "./errors.js";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface QueryOptions {
  /** Natural-language query string */
  query: string;
  /** BCP-47 language filter (required) */
  language: string;
  /** USFM reference for contextual filtering (e.g. "GEN 1:1") */
  reference?: string;
  /** Filter by resource type: "ult" | "tn" | "tw" | "ta" | "tq" | "twl" */
  resourceType?: string | string[];
  /** Filter by owner slug */
  owner?: string;
  /** Filter by project slug */
  project?: string;
  /** Number of results to return (default 5) */
  topK?: number;
  /** Client-supplied request ID for tracing */
  requestId?: string;
  /** Per-resourceType score boost multipliers */
  boost?: Record<string, number>;
  rerankerConfig?: RerankConfig;
}

export interface QueryResult {
  requestId: string;
  query: string;
  language: string;
  documents: VectorStoreQueryResult[];
  /** "ann" | "lexical" | "empty" */
  fallbackMode: "ann" | "lexical" | "empty";
  /** Cache status for observability */
  cacheStatus: "hit" | "miss";
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// RagService
// ---------------------------------------------------------------------------

export class RagService {
  private readonly vectorStore: VectorStore;
  private readonly kvStore: KVStore;
  private readonly embeddingService: EmbeddingService;
  private readonly reranker: Reranker;

  constructor(deps: {
    vectorStore: VectorStore;
    kvStore: KVStore;
    embeddingService: EmbeddingService;
    rerankerConfig?: RerankConfig;
  }) {
    this.vectorStore = deps.vectorStore;
    this.kvStore = deps.kvStore;
    this.embeddingService = deps.embeddingService;
    this.reranker = new Reranker(deps.rerankerConfig);
  }

  /**
   * Semantic search with Tier-1 reranking and lexical fallback.
   *
   * 1. Embed the query.
   * 2. Run ANN with 3×topK to get a wide candidate set.
   * 3. Apply Tier-1 multi-signal reranker, return topK.
   * 4. If ANN returns 0 results, fall back to lexical findByText().
   */
  async query(opts: QueryOptions): Promise<QueryResult> {
    const start = Date.now();
    const requestId = opts.requestId ?? generateRequestId();
    const topK = opts.topK ?? 5;

    const filters: VectorStoreFilters = {
      language: opts.language,
      ...(opts.resourceType ? { resourceType: opts.resourceType } : {}),
      ...(opts.owner ? { owner: opts.owner } : {}),
      ...(opts.project ? { project: opts.project } : {}),
    };

    let documents: VectorStoreQueryResult[] = [];
    let fallbackMode: QueryResult["fallbackMode"] = "ann";

    // Check KV query cache
    const cacheKey = queryResultCacheKey(opts.language, opts.query, filters);
    const cached = await safeGet(this.kvStore, cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as VectorStoreQueryResult[];
        return {
          requestId,
          query: opts.query,
          language: opts.language,
          documents: parsed,
          fallbackMode: "ann",
          cacheStatus: "hit",
          latencyMs: Date.now() - start,
        };
      } catch {
        // ignore malformed cache entry
      }
    }

    // Embed query
    let embedding: number[];
    try {
      const vecs = await this.embeddingService.embed([opts.query]);
      embedding = vecs[0]!;
    } catch (err) {
      throw new RagError(
        "EMBEDDING_SERVICE_UNAVAILABLE",
        "Failed to embed query",
        { cause: err, context: { requestId } },
      );
    }

    // ANN search with 3×topK
    let annResults: VectorStoreQueryResult[] = [];
    try {
      annResults = await this.vectorStore.query(embedding, topK * 3, filters);
    } catch (err) {
      // Non-fatal: fall through to lexical search
      console.warn(`[RagService] ANN failed (requestId=${requestId}):`, err);
    }

    if (annResults.length > 0) {
      documents = this.reranker
        .rerank(annResults, opts.query, {
          maxResults: topK,
          boost: opts.boost,
        })
        .map(
          ({ rerankScore: _s, signals: _sig, ...rest }) =>
            rest as VectorStoreQueryResult,
        );
      fallbackMode = "ann";
    } else {
      // Lexical fallback
      try {
        const lex = await this.vectorStore.findByText(
          opts.query,
          filters,
          topK,
        );
        if (lex.length > 0) {
          documents = lex;
          fallbackMode = "lexical";
        } else {
          fallbackMode = "empty";
        }
      } catch (err) {
        console.warn(
          `[RagService] Lexical fallback failed (requestId=${requestId}):`,
          err,
        );
        fallbackMode = "empty";
      }
    }

    // Cache successful ANN results briefly
    if (fallbackMode === "ann" && documents.length > 0) {
      safeSet(this.kvStore, cacheKey, JSON.stringify(documents), 60).catch(
        () => {
          // ignore
        },
      );
    }

    return {
      requestId,
      query: opts.query,
      language: opts.language,
      documents,
      fallbackMode,
      cacheStatus: "miss",
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Health probe for the RagService.
   */
  async health(): Promise<{
    status: "ok" | "degraded";
    details?: Record<string, unknown>;
  }> {
    const vsHealth = await this.vectorStore
      .health()
      .catch(() => ({ status: "degraded" as const }));
    return {
      status: vsHealth.status,
      details: { vectorStore: vsHealth.status },
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRagService(
  ctx: ServiceContext & { embeddingService: EmbeddingService },
): RagService {
  return new RagService({
    vectorStore: ctx.vectorStore,
    kvStore: ctx.kvStore,
    embeddingService: ctx.embeddingService,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateRequestId(): string {
  const ts = Date.now().toString(16);
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `${ts}-${rand}`;
}

function queryResultCacheKey(
  language: string,
  query: string,
  filters: VectorStoreFilters,
): string {
  // Simple hash: language + first 80 chars of query + sorted filter keys
  const filterStr = Object.entries(filters)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("&");
  const querySnippet = query.slice(0, 80).replace(/\s+/g, " ");
  return `rag:query:${language}:${encodeURIComponent(querySnippet)}:${encodeURIComponent(filterStr)}`;
}

async function safeGet(kv: KVStore, key: string): Promise<string | null> {
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}

async function safeSet(
  kv: KVStore,
  key: string,
  value: string,
  ttl: number,
): Promise<void> {
  try {
    await kv.set(key, value, ttl);
  } catch {
    // ignore
  }
}
