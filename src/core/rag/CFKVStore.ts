/**
 * Cloudflare KV namespace KVStore adapter.
 *
 * Uses the CF KV binding injected via wrangler.toml:
 *   [[kv_namespaces]]
 *   binding = "TRANSLATION_HELPS_CACHE"
 *
 * This is the L3 cache fallback when Upstash Redis is unavailable or
 * when running on Cloudflare Workers without a Redis connection.
 *
 * CF KV free tier: 100K reads / 1K writes per day.
 * Appropriate for metadata and bundle caching at moderate traffic.
 */

import type { KVStore, KVNamespaceLike } from "./interfaces.js";

export class CFKVStore implements KVStore {
  constructor(private readonly kv: KVNamespaceLike) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.kv.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      await this.kv.put(
        key,
        value,
        ttlSeconds ? { expirationTtl: ttlSeconds } : undefined,
      );
    } catch {
      // Degrade gracefully
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch {
      // Degrade gracefully
    }
  }

  async setNx(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    // CF KV does not have a native SETNX. We implement it with a get-then-set.
    // This is not atomic; two concurrent workers may both succeed. The caller
    // (coalescing guard) treats this as a best-effort dedup, so it's acceptable.
    const existing = await this.get(key);
    if (existing !== null) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }
}
