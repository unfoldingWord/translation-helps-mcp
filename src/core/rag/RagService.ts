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
import { BundleCache, type Bundle } from "./BundleCache.js";
import { buildLinkGraph, readLinkGraph, writeLinkGraph } from "./LinkGraph.js";
import {
  bundleCoalesceKey,
  COALESCE_BUNDLE_TTL,
  resourceIndexKey,
} from "../cache-ttls.js";

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
// getBundle types
// ---------------------------------------------------------------------------

export interface GetBundleOptions {
  language: string;
  /** USFM reference e.g. "JHN 3:16" */
  reference: string;
  owner?: string;
  project?: string;
  requestId?: string;
  /** Skip all caches and force fresh assembly */
  force?: boolean;
}

export interface GetBundleResult {
  requestId: string;
  bundle: Bundle;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// indexResource types (thin pass-through; real work in ResourceIndexer)
// ---------------------------------------------------------------------------

export interface IndexResourceOptions {
  resourceId: string;
  zipUrl?: string;
  force?: boolean;
  priority?: "low" | "normal" | "high";
  requestId?: string;
}

export interface IndexResourceResult {
  taskId: string;
  status: "queued" | "started" | "failed";
}

// ---------------------------------------------------------------------------
// RagService
// ---------------------------------------------------------------------------

export class RagService {
  private readonly vectorStore: VectorStore;
  private readonly kvStore: KVStore;
  private readonly embeddingService: EmbeddingService;
  private readonly reranker: Reranker;
  private readonly bundleCache: BundleCache;

  constructor(deps: {
    vectorStore: VectorStore;
    kvStore: KVStore;
    embeddingService: EmbeddingService;
    rerankerConfig?: RerankConfig;
    bundleCache?: BundleCache;
  }) {
    this.vectorStore = deps.vectorStore;
    this.kvStore = deps.kvStore;
    this.embeddingService = deps.embeddingService;
    this.reranker = new Reranker(deps.rerankerConfig);
    this.bundleCache = deps.bundleCache ?? new BundleCache();
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
   * Assemble a translation bundle for a language+reference pair.
   *
   * Bundle assembly order (per DETAILED_SPEC.md):
   *   1. L1 BundleCache → L2 KV cache (skip both if force=true)
   *   2. Coalescing dedup guard (setNx)
   *   3. Lexical query for notes, then for each note → TW/TA
   *   4. Assemble canonical Bundle shape
   *   5. Write to L1 + L2 caches
   */
  async getBundle(opts: GetBundleOptions): Promise<GetBundleResult> {
    const start = Date.now();
    const requestId = opts.requestId ?? generateRequestId();

    // L1 cache check
    if (!opts.force) {
      const l1 = this.bundleCache.get(opts.language, opts.reference);
      if (l1) {
        return { requestId, bundle: l1, latencyMs: Date.now() - start };
      }

      // L2 KV cache check
      const l2 = await this.bundleCache.getFromKv(
        this.kvStore,
        opts.language,
        opts.reference,
      );
      if (l2) {
        this.bundleCache.set(opts.language, opts.reference, l2);
        return { requestId, bundle: l2, latencyMs: Date.now() - start };
      }
    }

    // Coalescing dedup guard
    const coalesceKey = bundleCoalesceKey(opts.language, opts.reference);
    const acquired = await this.kvStore
      .setNx(coalesceKey, requestId, COALESCE_BUNDLE_TTL)
      .catch(() => true);
    if (!acquired) {
      // Another worker is assembling; return empty miss
      return {
        requestId,
        bundle: emptyBundle(opts.language, opts.reference, "miss"),
        latencyMs: Date.now() - start,
      };
    }

    try {
      const bundle = await this.assembleBundle(opts, requestId);
      this.bundleCache.set(opts.language, opts.reference, bundle);
      await this.bundleCache.setToKv(
        this.kvStore,
        opts.language,
        opts.reference,
        bundle,
      );
      return { requestId, bundle, latencyMs: Date.now() - start };
    } finally {
      await this.kvStore.del(coalesceKey).catch(() => undefined);
    }
  }

  /**
   * Enqueue a resource indexing job.
   *
   * Thin entry point; actual indexing runs in ResourceIndexer (Node only).
   * Writes a job record to KV for the indexer to pick up.
   */
  async indexResource(
    opts: IndexResourceOptions,
  ): Promise<IndexResourceResult> {
    const taskId = `idx-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
    const requestId = opts.requestId ?? generateRequestId();

    if (!opts.resourceId || !opts.resourceId.includes("/")) {
      throw new RagError(
        "INVALID_RESOURCE_ID",
        "resourceId must be in the form 'owner/project'",
        { context: { requestId } },
      );
    }

    const [owner, project] = opts.resourceId.split("/");
    const jobRecord = JSON.stringify({
      taskId,
      resourceId: opts.resourceId,
      owner,
      project,
      zipUrl: opts.zipUrl ?? null,
      force: opts.force ?? false,
      priority: opts.priority ?? "normal",
      createdAt: new Date().toISOString(),
      status: "queued",
    });

    await this.kvStore
      .set(`indexJob:${taskId}`, jobRecord, 30 * 60)
      .catch(() => {
        // non-fatal
      });

    return { taskId, status: "queued" };
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
      details: {
        vectorStore: vsHealth.status,
        bundleCache: this.bundleCache.stats(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async assembleBundle(
    opts: GetBundleOptions,
    _requestId: string,
  ): Promise<Bundle> {
    const { language, reference } = opts;
    const notesFilter: VectorStoreFilters = {
      language,
      resourceType: "tn",
      ...(opts.owner ? { owner: opts.owner } : {}),
      ...(opts.project ? { project: opts.project } : {}),
    };

    // Fetch notes via lexical search (reference is a USFM ref, not a query)
    let rawNotes: VectorStoreQueryResult[] = [];
    try {
      rawNotes = await this.vectorStore.findByText(reference, notesFilter, 20);
    } catch {
      // continue with empty notes
    }

    const notes = rawNotes.map((r) => ({
      id: r.id,
      text: r.document.text,
      externalReference: r.document.metadata["externalReference"] as
        | { path: string }
        | undefined,
    }));

    // Build/fetch link graph
    let linkGraph = await readLinkGraph(this.kvStore, language, reference);
    if (!linkGraph) {
      linkGraph = buildLinkGraph(
        language,
        reference,
        notes.map((n) => ({ id: n.id, text: n.text })),
      );
      await writeLinkGraph(this.kvStore, linkGraph);
    }

    // Fetch TW + TA articles for linked paths
    const twArticles: Bundle["tw"] = [];
    const taArticles: Bundle["ta"] = [];

    for (const entry of linkGraph.entries.slice(0, 10)) {
      const results = await this.vectorStore
        .findByText(
          entry.path,
          { language, resourceType: entry.resourceType },
          2,
        )
        .catch(() => []);

      for (const r of results) {
        const title = String(r.document.metadata["title"] ?? entry.path);
        if (entry.resourceType === "tw") {
          twArticles.push({ id: r.id, title, path: entry.path });
        } else {
          taArticles.push({ id: r.id, title, path: entry.path });
        }
      }
    }

    // Determine license from resource index
    const project = opts.project ?? `${language}_ult`;
    const idxRaw = await this.kvStore
      .get(resourceIndexKey(project))
      .catch(() => null);
    const license = idxRaw
      ? ((JSON.parse(idxRaw) as { license?: string }).license ?? "CC BY-SA 4.0")
      : "CC BY-SA 4.0";

    return {
      scripture: { text: "", format: "plain" },
      notes: notes.map((n) => ({
        id: n.id,
        text: n.text,
        ...(n.externalReference
          ? { externalReference: n.externalReference }
          : {}),
      })),
      tw: deduplicateById(twArticles),
      ta: deduplicateById(taArticles),
      metadata: {
        cacheStatus: "miss",
        license,
        language,
        reference,
        provenance: rawNotes.slice(0, 5).map((r) => ({
          r2Key: String(r.document.metadata["r2Key"] ?? ""),
          path: String(r.document.metadata["path"] ?? ""),
          project: String(r.document.metadata["project"] ?? project),
          excerptStart: Number(r.document.metadata["startToken"] ?? 0),
          excerptEnd: Number(r.document.metadata["endToken"] ?? 0),
        })),
      },
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

function emptyBundle(
  language: string,
  reference: string,
  cacheStatus: Bundle["metadata"]["cacheStatus"],
): Bundle {
  return {
    scripture: { text: "", format: "plain" },
    notes: [],
    tw: [],
    ta: [],
    metadata: {
      cacheStatus,
      license: "CC BY-SA 4.0",
      language,
      reference,
      provenance: [],
    },
  };
}

function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
