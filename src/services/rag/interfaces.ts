/**
 * Core service interfaces for the RAG pipeline.
 *
 * These interfaces abstract away the concrete implementations so the same
 * code can run with:
 *   - InMemoryVectorStore / InMemoryKVStore  (unit tests, fast)
 *   - QdrantVectorStore / RedisKVStore       (local dev with Docker)
 *   - CFVectorizeStore / CFKVStore           (Cloudflare Pages production)
 *
 * See DETAILED_SPEC.md for canonical behaviour requirements.
 */

// ---------------------------------------------------------------------------
// VectorStore
// ---------------------------------------------------------------------------

export interface VectorStoreDocument {
  /** Canonical doc_id: "resource:{owner}:{project}@{refTag}:{path}:chunk:{n}" */
  id: string;
  text: string;
  embedding?: number[];
  metadata: VectorStoreMetadata;
}

export interface VectorStoreMetadata {
  language: string; // BCP 47
  resourceType: string; // "ult" | "tn" | "tw" | "ta" | "tq" | "twl"
  owner: string;
  project: string;
  refTag: string;
  path: string;
  chunkIndex: number;
  /** SPDX license identifier, e.g. "CC BY-SA 4.0" */
  license?: string;
  [key: string]: unknown;
}

export type VectorStoreDocumentInput = Omit<VectorStoreDocument, "embedding">;

export interface VectorStoreFilters {
  language?: string;
  resourceType?: string | string[];
  owner?: string;
  project?: string;
  refTag?: string;
}

export interface VectorStoreQueryResult {
  id: string;
  score: number;
  document: VectorStoreDocument;
}

export interface VectorStore {
  /**
   * Insert or replace documents. Idempotent by doc id.
   */
  upsert(documents: VectorStoreDocumentInput[]): Promise<void>;

  /**
   * Semantic ANN query. Returns topK results sorted by descending score.
   */
  query(
    embedding: number[],
    topK: number,
    filters?: VectorStoreFilters,
  ): Promise<VectorStoreQueryResult[]>;

  /**
   * Delete all documents matching the given filter.
   */
  delete(filter: VectorStoreFilters): Promise<void>;

  /**
   * Lexical (keyword) search — fallback when ANN returns nothing.
   * Returns up to `max` results sorted by term-frequency relevance.
   */
  findByText(
    text: string,
    filters?: VectorStoreFilters,
    max?: number,
  ): Promise<VectorStoreQueryResult[]>;

  /**
   * Liveness check.
   */
  health(): Promise<{ status: "ok" | "degraded" }>;
}

// ---------------------------------------------------------------------------
// KVStore
// ---------------------------------------------------------------------------

export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Returns true if the key was set (false = already existed → coalescing guard) */
  setNx(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// ServiceContext
// ---------------------------------------------------------------------------

/**
 * Dependency container injected into every MCP tool handler and RagService.
 * Constructed once per request in Cloudflare Pages or once at startup in Node.
 */
export interface ServiceContext {
  vectorStore: VectorStore;
  kvStore: KVStore;
  /** Cloudflare R2 bucket binding (or null in local dev with USE_FS_CACHE=true) */
  r2Bucket: R2LikeBucket | null;
  /** Cloudflare KV binding for edge cache (or null outside CF runtime) */
  cfKv: KVNamespaceLike | null;
  /** Cloudflare Workers AI binding (or null outside CF runtime) */
  ai: WorkersAILike | null;
  env: ServiceEnv;
}

export interface ServiceEnv {
  NODE_ENV: "development" | "production" | "test";
  EMBEDDINGS_PROVIDER: "fake" | "workersai" | "openai" | "local";
  LLM_PROVIDER: "fake" | "workersai" | "openai" | "anthropic";
  VECTOR_DIMENSION: number;
  ADMIN_TOKEN: string;
  EMBEDDING_DAILY_TOKEN_CAP: number;
  LLM_DAILY_REQUEST_CAP: number;
}

// ---------------------------------------------------------------------------
// Minimal stub types for Cloudflare bindings
// (Real types come from @cloudflare/workers-types when running in CF env)
// ---------------------------------------------------------------------------

export interface R2LikeBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkersAILike {
  run(
    model: string,
    inputs: Record<string, unknown>,
  ): Promise<{ data?: number[][]; response?: string; [key: string]: unknown }>;
}
