/**
 * Canonical cache TTL constants for the RAG pipeline.
 *
 * Values are in SECONDS. Do not hardcode these elsewhere.
 * Source: docs/rewrite-plan/CACHING_STRATEGY.md — TTL MATRIX
 *
 * Three-layer model:
 *   L1 = in-process LRU (InMemoryKVStore or LRU-Cache in BundleCache)
 *   L2 = Cloudflare Cache API (edge cache on CF Pages)
 *   L3 = Redis / Upstash (durable KV shared across workers)
 */

// ---------------------------------------------------------------------------
// Bundle cache TTLs
// ---------------------------------------------------------------------------

/** Hot bundle: accessed ≥3 times in the last hour */
export const BUNDLE_HOT_TTL_L1 = 3600; // 1 hour
export const BUNDLE_HOT_TTL_L2 = 3600; // 1 hour
export const BUNDLE_HOT_TTL_L3 = 86400; // 24 hours

/** Cold/partial bundle: first assembly or infrequently accessed */
export const BUNDLE_COLD_TTL_L1 = 300; // 5 minutes
export const BUNDLE_COLD_TTL_L2 = 300; // 5 minutes
export const BUNDLE_COLD_TTL_L3 = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Chunk / embedding metadata
// ---------------------------------------------------------------------------

export const CHUNK_META_TTL_L1 = 300; // 5 minutes
export const CHUNK_META_TTL_L3 = 3600; // 1 hour (no L2)

// ---------------------------------------------------------------------------
// Catalog metadata
// ---------------------------------------------------------------------------

export const CATALOG_TTL_L1 = 3600; // 1 hour
export const CATALOG_TTL_L2 = 3600; // 1 hour
export const CATALOG_TTL_L3 = 86400; // 24 hours

// ---------------------------------------------------------------------------
// Resource index
// ---------------------------------------------------------------------------

export const RESOURCE_INDEX_TTL_L1 = 1800; // 30 minutes
export const RESOURCE_INDEX_TTL_L3 = 86400; // 24 hours (no L2)

// ---------------------------------------------------------------------------
// Link graph
// ---------------------------------------------------------------------------

export const LINK_GRAPH_TTL_L1 = 3600; // 1 hour
export const LINK_GRAPH_TTL_L3 = 86400; // 24 hours (no L2)

// ---------------------------------------------------------------------------
// Scripture text (raw ZIP extract)
// ---------------------------------------------------------------------------

export const SCRIPTURE_TTL_L1 = 300; // 5 minutes
export const SCRIPTURE_TTL_L2 = 600; // 10 minutes
export const SCRIPTURE_TTL_L3 = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Coalescing guard TTL (prevents duplicate in-flight requests)
// ---------------------------------------------------------------------------

/** How long to hold the lock for a single bundle assembly */
export const COALESCE_BUNDLE_TTL = 30; // 30 seconds
/** How long to hold the lock for a single rag_query */
export const COALESCE_RAG_TTL = 15; // 15 seconds

// ---------------------------------------------------------------------------
// In-process LRU bundle cache size (number of bundles, not bytes)
// ---------------------------------------------------------------------------

export const BUNDLE_CACHE_MAX_SIZE = Number(
  process.env["BUNDLE_CACHE_MAX_SIZE"] ?? 500,
);

// ---------------------------------------------------------------------------
// Canonical cache key generators
// Use these everywhere — never construct keys ad-hoc.
// ---------------------------------------------------------------------------

export function bundleCacheKey(language: string, reference: string): string {
  return `rag:bundle:${language}:${encodeURIComponent(reference)}`;
}

export function chunkMetaKey(docId: string): string {
  return `rag:embed:${docId}`;
}

export function resourceIndexKey(project: string): string {
  return `resourceIndex:${project}`;
}

export function linkGraphKey(language: string, reference: string): string {
  return `resourceGraph:${language}:${encodeURIComponent(reference)}`;
}

export function bundleCoalesceKey(language: string, reference: string): string {
  return `coalesce:bundle:${language}:${encodeURIComponent(reference)}`;
}

export function ragQueryCoalesceKey(
  language: string,
  reference: string,
  filtersHash: string,
  queryHash: string,
): string {
  return `coalesce:rag:${language}:${encodeURIComponent(reference)}:${filtersHash}:${queryHash}`;
}
