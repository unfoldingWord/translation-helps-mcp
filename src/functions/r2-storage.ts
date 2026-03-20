export interface R2LikeBucket {
  get(key: string): Promise<{
    body: ReadableStream | null;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    writeHttpMetadata?: (headers: Headers) => void;
  } | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<void>;
}

function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes(".tar.gz") || lower.endsWith(".tgz"))
    return "application/gzip";
  return "application/zip";
}

/**
 * Simple LRU Memory Cache Entry
 */
interface MemoryCacheEntry {
  data: string | Uint8Array;
  timestamp: number;
  size: number;
  accessCount: number;
}

/**
 * Memory Cache Configuration
 */
interface MemoryCacheConfig {
  maxSizeBytes: number;
  maxAgeMs: number;
  enabled: boolean;
}

/**
 * Simple In-Memory LRU Cache
 * Provides sub-millisecond access for hot data
 */
class MemoryCache {
  private cache = new Map<string, MemoryCacheEntry>();
  private currentSize = 0;
  private config: MemoryCacheConfig;

  constructor(config?: Partial<MemoryCacheConfig>) {
    this.config = {
      maxSizeBytes: config?.maxSizeBytes ?? 10 * 1024 * 1024, // 10MB default
      maxAgeMs: config?.maxAgeMs ?? 60 * 1000, // 1 minute default
      enabled: config?.enabled ?? true,
    };
  }

  /**
   * Update configuration (useful for global instance)
   */
  configure(config: Partial<MemoryCacheConfig>) {
    this.config = { ...this.config, ...config };
  }

  get(key: string): MemoryCacheEntry | null {
    if (!this.config.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.config.maxAgeMs) {
      this.delete(key);
      return null;
    }

    // Update access count for LRU
    entry.accessCount++;
    entry.timestamp = Date.now();
    return entry;
  }

  set(key: string, data: string | Uint8Array): void {
    if (!this.config.enabled) return;

    const size = typeof data === 'string' ? data.length : data.byteLength;

    // Don't cache if single item exceeds max size
    if (size > this.config.maxSizeBytes) {
      console.log(`[MEMORY CACHE] Item too large to cache: ${key} (${Math.round(size / 1024)}KB)`);
      return;
    }

    // Evict old entries if needed
    while (this.currentSize + size > this.config.maxSizeBytes && this.cache.size > 0) {
      this.evictLRU();
    }

    // Remove old entry if updating
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)!;
      this.currentSize -= oldEntry.size;
    }

    // Add new entry
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      size,
      accessCount: 1,
    });
    this.currentSize += size;

    console.log(`[MEMORY CACHE] Cached ${key} (${Math.round(size / 1024)}KB, total: ${Math.round(this.currentSize / 1024)}KB/${Math.round(this.config.maxSizeBytes / 1024)}KB)`);
  }

  delete(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      this.cache.delete(key);
    }
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    let lowestAccessCount = Infinity;

    // Find least recently used / least accessed entry
    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessCount < lowestAccessCount || 
          (entry.accessCount === lowestAccessCount && entry.timestamp < oldestTime)) {
        oldestKey = key;
        oldestTime = entry.timestamp;
        lowestAccessCount = entry.accessCount;
      }
    }

    if (oldestKey) {
      const evicted = this.cache.get(oldestKey)!;
      console.log(`[MEMORY CACHE] Evicting LRU: ${oldestKey} (${Math.round(evicted.size / 1024)}KB, ${evicted.accessCount} accesses)`);
      this.delete(oldestKey);
    }
  }

  getStats() {
    return {
      entries: this.cache.size,
      totalSize: this.currentSize,
      maxSize: this.config.maxSizeBytes,
      utilizationPercent: Math.round((this.currentSize / this.config.maxSizeBytes) * 100),
    };
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }
}

/**
 * Global memory cache shared across all R2Storage instances
 * This ensures cache persists across requests for maximum performance
 */
const globalMemoryCache = new MemoryCache({
  maxSizeBytes: 50 * 1024 * 1024, // 50MB for global cache (more generous)
  maxAgeMs: 5 * 60 * 1000, // 5 minutes for global cache (longer retention)
  enabled: true,
});

export class R2Storage {
  private memoryCache: MemoryCache;

  constructor(
    private bucket: R2LikeBucket | undefined,
    private cacheStorage: CacheStorage | undefined,
    memoryCacheConfig?: Partial<MemoryCacheConfig>,
  ) {
    // Use global memory cache for cross-request persistence
    // Individual config is ignored in favor of global settings
    this.memoryCache = globalMemoryCache;
  }

  private get defaultCache(): Cache | null {
    try {
      // @ts-expect-error - caches may exist in edge/runtime
      return (
        this.cacheStorage?.default ??
        (globalThis as any).caches?.default ??
        null
      );
    } catch {
      return null;
    }
  }

  async getZipWithInfo(key: string): Promise<{
    data: Uint8Array | null;
    source: "memory" | "cache" | "r2" | "miss";
    durationMs: number;
    size: number;
  }> {
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    
    // Check memory cache first (sub-millisecond)
    const memCached = this.memoryCache.get(key);
    if (memCached && memCached.data instanceof Uint8Array) {
      const end =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      return {
        data: memCached.data,
        source: "memory",
        durationMs: Math.max(0, Math.round((end as number) - (start as number))),
        size: memCached.size,
      };
    }

    const req = new Request(`https://r2.local/${key}`);
    const c = this.defaultCache;
    if (c) {
      const hit = await c.match(req);
      if (hit) {
        const buf = await hit.arrayBuffer();
        const data = new Uint8Array(buf);
        const end =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        
        // Store in memory cache for next time
        this.memoryCache.set(key, data);
        
        return {
          data,
          source: "cache",
          durationMs: Math.max(
            1,
            Math.round((end as number) - (start as number)),
          ),
          size: buf.byteLength,
        };
      }
    }
    if (!this.bucket)
      return { data: null, source: "miss", durationMs: 1, size: 0 };
    const obj = await this.bucket.get(key);
    if (!obj) return { data: null, source: "miss", durationMs: 1, size: 0 };
    const buf = await obj.arrayBuffer();
    const data = new Uint8Array(buf);
    
    // Store in memory cache
    this.memoryCache.set(key, data);
    
    if (c) {
      await c.put(
        req,
        new Response(buf, {
          headers: {
            "Content-Type": contentTypeForKey(key),
            "Cache-Control": "public, max-age=604800",
          },
        }),
      );
    }
    const end =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      data,
      source: "r2",
      durationMs: Math.max(1, Math.round((end as number) - (start as number))),
      size: buf.byteLength,
    };
  }

  async getZip(key: string): Promise<Uint8Array | null> {
    const req = new Request(`https://r2.local/${key}`);
    const c = this.defaultCache;
    if (c) {
      const hit = await c.match(req);
      if (hit) {
        const buf = await hit.arrayBuffer();
        return new Uint8Array(buf);
      }
    }
    if (!this.bucket) return null;
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const buf = await obj.arrayBuffer();
    if (c) {
      await c.put(
        req,
        new Response(buf, {
          headers: {
            "Content-Type": contentTypeForKey(key),
            "Cache-Control": "public, max-age=604800",
          },
        }),
      );
    }
    return new Uint8Array(buf);
  }

  async putZip(key: string, buf: ArrayBuffer, meta?: Record<string, string>) {
    if (!this.bucket) return;
    await this.bucket.put(key, buf, {
      httpMetadata: {
        contentType: contentTypeForKey(key),
        cacheControl: "public, max-age=604800",
      },
      customMetadata: meta,
    });
    const c = this.defaultCache;
    if (c) {
      await c.put(
        new Request(`https://r2.local/${key}`),
        new Response(buf, {
          headers: {
            "Content-Type": contentTypeForKey(key),
            "Cache-Control": "public, max-age=604800",
          },
        }),
      );
    }
  }

  async getFile(
    key: string,
    contentType = "text/plain",
  ): Promise<string | null> {
    const req = new Request(`https://r2.local/${key}`);
    const c = this.defaultCache;
    if (c) {
      const hit = await c.match(req);
      if (hit) return await hit.text();
    }
    if (!this.bucket) return null;
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const text = await obj.text();
    if (c) {
      await c.put(
        req,
        new Response(text, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=604800",
          },
        }),
      );
    }
    return text;
  }

  async getFileWithInfo(
    key: string,
    contentType = "text/plain",
  ): Promise<{
    data: string | null;
    source: "memory" | "cache" | "r2" | "miss";
    durationMs: number;
    size: number;
  }> {
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    
    // Check memory cache first (sub-millisecond)
    const memCached = this.memoryCache.get(key);
    if (memCached && typeof memCached.data === 'string') {
      const end =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      return {
        data: memCached.data,
        source: "memory",
        durationMs: Math.max(0, Math.round((end as number) - (start as number))),
        size: memCached.size,
      };
    }

    const req = new Request(`https://r2.local/${key}`);
    const c = this.defaultCache;
    if (c) {
      const hit = await c.match(req);
      if (hit) {
        const text = await hit.text();
        const end =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        
        // Store in memory cache for next time
        this.memoryCache.set(key, text);
        
        return {
          data: text,
          source: "cache",
          durationMs: Math.max(
            1,
            Math.round((end as number) - (start as number)),
          ),
          size: text.length,
        };
      }
    }
    if (!this.bucket)
      return { data: null, source: "miss", durationMs: 1, size: 0 };
    const obj = await this.bucket.get(key);
    if (!obj) return { data: null, source: "miss", durationMs: 1, size: 0 };
    const text = await obj.text();
    
    // Store in memory cache
    this.memoryCache.set(key, text);
    
    if (c) {
      await c.put(
        req,
        new Response(text, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=604800",
          },
        }),
      );
    }
    const end =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      data: text,
      source: "r2",
      durationMs: Math.max(1, Math.round((end as number) - (start as number))),
      size: text.length,
    };
  }

  async putFile(
    key: string,
    text: string,
    contentType = "text/plain",
    meta?: Record<string, string>,
  ) {
    if (!this.bucket) return;
    await this.bucket.put(key, text, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=604800",
      },
      customMetadata: meta,
    });
    const c = this.defaultCache;
    if (c) {
      await c.put(
        new Request(`https://r2.local/${key}`),
        new Response(text, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=604800",
          },
        }),
      );
    }
  }

  async deleteZip(key: string) {
    // Delete from memory cache
    this.memoryCache.delete(key);
    
    // Delete from Cache API
    const c = this.defaultCache;
    if (c) {
      try {
        await c.delete(new Request(`https://r2.local/${key}`));
      } catch {
        // ignore cache delete errors
      }
    }
    // Delete from R2
    if (this.bucket) {
      try {
        await this.bucket.delete(key);
      } catch {
        // ignore R2 delete errors
      }
    }
  }

  /**
   * Get memory cache statistics
   */
  getMemoryCacheStats() {
    return this.memoryCache.getStats();
  }

  /**
   * Clear memory cache
   */
  clearMemoryCache() {
    this.memoryCache.clear();
  }
}
