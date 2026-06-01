/**
 * BundleCache — in-process LRU cache for assembled translation bundles.
 *
 * Three-layer model:
 *   L1: in-process LRU (this class)   — fastest, ephemeral per worker
 *   L2: KV store (Redis/CFStore)       — shared across workers, TTL-based
 *
 * Uses a simple LRU eviction backed by a Map (insertion order).
 * For production, the BUNDLE_CACHE_MAX_SIZE constant in cache-ttls.ts
 * controls the max number of entries.
 *
 * See DETAILED_SPEC.md MEMORY CACHE TTL for TTL decisions.
 */

import type { KVStore } from "./interfaces.js";
import {
  bundleCacheKey,
  BUNDLE_HOT_TTL_L3,
  BUNDLE_COLD_TTL_L3,
  BUNDLE_CACHE_MAX_SIZE,
} from "../cache-ttls.js";

export interface Bundle {
  scripture: {
    text: string;
    format: "usfm" | "plain";
  };
  notes: Array<{
    id: string;
    text: string;
    externalReference?: { path: string };
  }>;
  tw: Array<{ id: string; title: string; path: string }>;
  ta: Array<{ id: string; title: string; path: string }>;
  metadata: {
    cacheStatus: "memory" | "edge" | "r2" | "miss";
    license: string;
    language: string;
    reference: string;
    provenance: Array<{
      r2Key: string;
      path: string;
      project: string;
      excerptStart: number;
      excerptEnd: number;
    }>;
  };
}

type CacheEntry = {
  bundle: Bundle;
  /** Unix ms timestamp */
  insertedAt: number;
  /** Access count since insertion */
  hits: number;
};

/**
 * Hot threshold: accessed ≥ 3 times within the hot window → hot TTL.
 * This matches CACHING_STRATEGY.md "accessed ≥3 times in the last hour".
 */
const HOT_HIT_THRESHOLD = 3;

export class BundleCache {
  private readonly lru = new Map<string, CacheEntry>();
  private readonly maxSize: number;

  constructor(opts?: { maxSize?: number }) {
    this.maxSize = opts?.maxSize ?? BUNDLE_CACHE_MAX_SIZE;
  }

  /**
   * Get from L1 cache.
   */
  get(language: string, reference: string): Bundle | null {
    const key = bundleCacheKey(language, reference);
    const entry = this.lru.get(key);
    if (!entry) return null;

    // Move to end (LRU touch)
    this.lru.delete(key);
    entry.hits++;
    this.lru.set(key, entry);

    // Update cacheStatus to reflect memory hit
    return {
      ...entry.bundle,
      metadata: { ...entry.bundle.metadata, cacheStatus: "memory" },
    };
  }

  /**
   * Put into L1 cache. Evicts oldest entry when full.
   */
  set(language: string, reference: string, bundle: Bundle): void {
    const key = bundleCacheKey(language, reference);

    // Evict oldest when at capacity
    if (this.lru.size >= this.maxSize) {
      const firstKey = this.lru.keys().next().value;
      if (firstKey) this.lru.delete(firstKey);
    }

    this.lru.set(key, {
      bundle,
      insertedAt: Date.now(),
      hits: 1,
    });
  }

  /**
   * Invalidate a specific cache entry.
   */
  invalidate(language: string, reference: string): void {
    this.lru.delete(bundleCacheKey(language, reference));
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.lru.clear();
  }

  get size(): number {
    return this.lru.size;
  }

  /**
   * Read from KV (L2). Returns null if not found or parse error.
   */
  async getFromKv(
    kv: KVStore,
    language: string,
    reference: string,
  ): Promise<Bundle | null> {
    const key = bundleCacheKey(language, reference);
    const raw = await kv.get(key).catch(() => null);
    if (!raw) return null;
    try {
      const bundle = JSON.parse(raw) as Bundle;
      return {
        ...bundle,
        metadata: { ...bundle.metadata, cacheStatus: "edge" },
      };
    } catch {
      return null;
    }
  }

  /**
   * Write to KV (L2). Uses hot or cold TTL based on L1 access count.
   */
  async setToKv(
    kv: KVStore,
    language: string,
    reference: string,
    bundle: Bundle,
  ): Promise<void> {
    const key = bundleCacheKey(language, reference);
    const l1Entry = this.lru.get(key);
    const isHot = l1Entry ? l1Entry.hits >= HOT_HIT_THRESHOLD : false;
    const ttl = isHot ? BUNDLE_HOT_TTL_L3 : BUNDLE_COLD_TTL_L3;

    await kv.set(key, JSON.stringify(bundle), ttl).catch(() => {
      // ignore KV write failures
    });
  }

  /**
   * Stats for observability.
   */
  stats(): { size: number; maxSize: number; utilizationPct: number } {
    return {
      size: this.lru.size,
      maxSize: this.maxSize,
      utilizationPct: this.lru.size / this.maxSize,
    };
  }
}
