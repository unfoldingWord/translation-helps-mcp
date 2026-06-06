/**
 * Canonical cache TTL constants.
 *
 * Values are in SECONDS. Do not hardcode these elsewhere.
 *
 * Three-layer model:
 *   L1 = in-process LRU (BundleCache)
 *   L2 = KV store (Cloudflare KV or Upstash Redis, shared across workers)
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
// Catalog metadata (list_translation_academy / list_translation_words)
// ---------------------------------------------------------------------------

export const CATALOG_TTL_L1 = 3600; // 1 hour
export const CATALOG_TTL_L2 = 3600; // 1 hour
export const CATALOG_TTL_L3 = 86400; // 24 hours

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
  return `bundle:${language}:${encodeURIComponent(reference)}`;
}

export function bundleCoalesceKey(language: string, reference: string): string {
  return `coalesce:bundle:${language}:${encodeURIComponent(reference)}`;
}
