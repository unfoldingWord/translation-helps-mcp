import { describe, it, expect, beforeEach } from "vitest";
import {
  BundleCache,
  type Bundle,
} from "../../src/services/rag/BundleCache.js";
import { InMemoryKVStore } from "../../src/services/rag/InMemoryKVStore.js";

function makeBundle(language: string, reference: string): Bundle {
  return {
    scripture: { text: "In the beginning...", format: "plain" },
    notes: [{ id: "n1", text: "A note about this passage." }],
    tw: [{ id: "tw1", title: "Love", path: "bible/kt/love" }],
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

describe("BundleCache (L1 in-process LRU)", () => {
  let cache: BundleCache;

  beforeEach(() => {
    cache = new BundleCache({ maxSize: 3 });
  });

  it("returns null for missing entry", () => {
    expect(cache.get("en", "JHN 3:16")).toBeNull();
  });

  it("stores and retrieves a bundle", () => {
    const bundle = makeBundle("en", "JHN 3:16");
    cache.set("en", "JHN 3:16", bundle);
    const result = cache.get("en", "JHN 3:16");
    expect(result).not.toBeNull();
    expect(result!.metadata.reference).toBe("JHN 3:16");
  });

  it("marks retrieved bundle as cacheStatus=memory", () => {
    cache.set("en", "JHN 3:16", makeBundle("en", "JHN 3:16"));
    const result = cache.get("en", "JHN 3:16");
    expect(result!.metadata.cacheStatus).toBe("memory");
  });

  it("evicts oldest entry when at max capacity", () => {
    cache.set("en", "JHN 3:16", makeBundle("en", "JHN 3:16"));
    cache.set("en", "MAT 5:3", makeBundle("en", "MAT 5:3"));
    cache.set("en", "GEN 1:1", makeBundle("en", "GEN 1:1"));
    // Accessing JHN 3:16 moves it to end (most recent)
    cache.get("en", "JHN 3:16");
    // Adding a 4th entry should evict MAT 5:3 (oldest unaccessed)
    cache.set("en", "ROM 1:1", makeBundle("en", "ROM 1:1"));
    expect(cache.size).toBe(3);
    expect(cache.get("en", "MAT 5:3")).toBeNull();
    expect(cache.get("en", "JHN 3:16")).not.toBeNull();
  });

  it("invalidates a specific entry", () => {
    cache.set("en", "JHN 3:16", makeBundle("en", "JHN 3:16"));
    cache.invalidate("en", "JHN 3:16");
    expect(cache.get("en", "JHN 3:16")).toBeNull();
  });

  it("clears all entries", () => {
    cache.set("en", "JHN 3:16", makeBundle("en", "JHN 3:16"));
    cache.set("en", "MAT 5:3", makeBundle("en", "MAT 5:3"));
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("returns stats", () => {
    cache.set("en", "JHN 3:16", makeBundle("en", "JHN 3:16"));
    const stats = cache.stats();
    expect(stats.size).toBe(1);
    expect(stats.maxSize).toBe(3);
    expect(stats.utilizationPct).toBeCloseTo(1 / 3);
  });
});

describe("BundleCache (L2 KV integration)", () => {
  let cache: BundleCache;
  let kv: InMemoryKVStore;

  beforeEach(() => {
    cache = new BundleCache({ maxSize: 10 });
    kv = new InMemoryKVStore();
  });

  it("returns null from KV when key absent", async () => {
    const result = await cache.getFromKv(kv, "en", "JHN 3:16");
    expect(result).toBeNull();
  });

  it("round-trips bundle through KV", async () => {
    const bundle = makeBundle("en", "JHN 3:16");
    await cache.setToKv(kv, "en", "JHN 3:16", bundle);
    const result = await cache.getFromKv(kv, "en", "JHN 3:16");
    expect(result).not.toBeNull();
    expect(result!.metadata.cacheStatus).toBe("edge");
    expect(result!.metadata.reference).toBe("JHN 3:16");
  });

  it("returns null for malformed KV JSON", async () => {
    const { bundleCacheKey } = await import("../../src/config/cache-ttls.js");
    await kv.set(bundleCacheKey("en", "BAD 1:1"), "{invalid}", 3600);
    const result = await cache.getFromKv(kv, "en", "BAD 1:1");
    expect(result).toBeNull();
  });
});
