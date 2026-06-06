/**
 * Core KV store interfaces (retained after vector-RAG removal).
 *
 * These interfaces abstract the KV store so BundleCache, CFKVStore, and
 * InMemoryKVStore can share the same contract in production and tests.
 */

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
// Minimal stub types for Cloudflare KV binding
// (Real types come from @cloudflare/workers-types when running in CF env)
// ---------------------------------------------------------------------------

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}
