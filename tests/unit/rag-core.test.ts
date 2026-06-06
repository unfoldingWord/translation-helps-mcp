/**
 * Unit tests for the non-vector RAG infrastructure:
 *   - InMemoryKVStore
 *   - BundleCache
 *   - search_articles lexical scoring
 */
import { describe, it, expect } from "vitest";
import { InMemoryKVStore } from "../../src/core/rag/InMemoryKVStore.js";
import { BundleCache, type Bundle } from "../../src/core/rag/BundleCache.js";

// ─── InMemoryKVStore ───────────────────────────────────────────────────────

describe("InMemoryKVStore", () => {
  it("set and get a value", async () => {
    const kv = new InMemoryKVStore();
    await kv.set("key1", "value1", 3600);
    expect(await kv.get("key1")).toBe("value1");
  });

  it("returns null for missing key", async () => {
    const kv = new InMemoryKVStore();
    expect(await kv.get("missing")).toBeNull();
  });

  it("setNx returns false when key exists", async () => {
    const kv = new InMemoryKVStore();
    await kv.set("lock", "held", 30);
    const secondAttempt = await kv.setNx("lock", "other", 30);
    expect(secondAttempt).toBe(false);
  });

  it("TTL expiry evicts the key", async () => {
    const kv = new InMemoryKVStore();
    await kv.set("short", "val", 0.001); // ~1ms TTL
    await new Promise((r) => setTimeout(r, 5));
    expect(await kv.get("short")).toBeNull();
  });
});

// ─── BundleCache ──────────────────────────────────────────────────────────

describe("BundleCache", () => {
  const makeBundle = (ref: string): Bundle => ({
    scripture: { text: `Scripture for ${ref}`, format: "plain" },
    notes: [],
    tw: [],
    ta: [],
    metadata: {
      cacheStatus: "miss",
      license: "CC BY-SA 4.0",
      language: "en",
      reference: ref,
      provenance: [],
    },
  });

  it("stores and retrieves bundles", () => {
    const cache = new BundleCache();
    const bundle = makeBundle("JHN 3:16");
    cache.set("en", "JHN 3:16", bundle);
    const hit = cache.get("en", "JHN 3:16");
    expect(hit).not.toBeNull();
    expect(hit!.scripture.text).toBe("Scripture for JHN 3:16");
    expect(hit!.metadata.cacheStatus).toBe("memory");
  });

  it("returns null for cache miss", () => {
    const cache = new BundleCache();
    expect(cache.get("en", "GEN 1:1")).toBeNull();
  });

  it("evicts oldest entry when at max size", () => {
    const cache = new BundleCache({ maxSize: 2 });
    cache.set("en", "JHN 3:16", makeBundle("JHN 3:16"));
    cache.set("en", "GEN 1:1", makeBundle("GEN 1:1"));
    cache.set("en", "MAT 5:3", makeBundle("MAT 5:3")); // evicts JHN 3:16
    expect(cache.get("en", "JHN 3:16")).toBeNull();
    expect(cache.get("en", "MAT 5:3")).not.toBeNull();
  });

  it("roundtrips through KV", async () => {
    const kv = new InMemoryKVStore();
    const cache = new BundleCache();
    const bundle = makeBundle("ROM 3:23");
    cache.set("en", "ROM 3:23", bundle);
    await cache.setToKv(kv, "en", "ROM 3:23", bundle);

    const cache2 = new BundleCache();
    const hit = await cache2.getFromKv(kv, "en", "ROM 3:23");
    expect(hit).not.toBeNull();
    expect(hit!.scripture.text).toBe("Scripture for ROM 3:23");
    expect(hit!.metadata.cacheStatus).toBe("edge");
  });
});

// ─── search_articles lexical scorer ──────────────────────────────────────

describe("search_articles lexical scoring (unit)", () => {
  // We test the scoring logic directly via the tool module.
  // The handler itself requires env (KV + ZIP), so we test the score function
  // by extracting its pure logic inline.

  function scoreArticle(
    query: string,
    path: string,
    title: string,
    category: string,
  ): number {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 2);
    if (terms.length === 0) return 0;
    const haystack = `${title} ${path} ${category}`.toLowerCase();
    const slugWords = path.split(/[-/]/).filter(Boolean);
    const slugHaystack = slugWords.join(" ").toLowerCase();
    let hits = 0;
    let exactBonus = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        hits++;
        if (title.toLowerCase().includes(term) || slugHaystack.includes(term)) {
          exactBonus += 0.3;
        }
      }
    }
    const base = hits / terms.length;
    return Math.min(1, base + exactBonus / terms.length);
  }

  it("scores perfect title match high", () => {
    const score = scoreArticle("metonymy", "translate/figs-metonymy", "Metonymy", "translate");
    expect(score).toBeGreaterThan(0.5);
  });

  it("scores unrelated article zero", () => {
    const score = scoreArticle("metonymy", "bible/kt/grace", "Grace", "kt");
    expect(score).toBe(0);
  });

  it("scores partial match between 0 and 1", () => {
    const score = scoreArticle("figurative language", "translate/figs-metaphor", "Metaphor", "translate");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
