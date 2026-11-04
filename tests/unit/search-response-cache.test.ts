/**
 * /api/v1/search keeps the notes-style KV response cache.
 * A repeated query, including one that only differs by case, spacing, or
 * type order, must not search the catalogs again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteContext } from "../../src/api/worker.js";
import { handleSearch } from "../../src/api/routes/search.js";
import { searchResponseCacheKey } from "../../src/api/routes/responseCache.js";
import * as articleCatalog from "../../src/api/routes/articleCatalog.js";
import { clearArticleCatalogCacheForTests } from "../../src/api/routes/articleCatalog.js";
import { clearCatalogProcessCache } from "@translation-helps/door43";

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function ctx(kv: KVNamespace, query: string, types = "ta,tw"): RouteContext {
  const url = new URL("https://example.test/api/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("language", "en");
  url.searchParams.set("types", types);
  url.searchParams.set("limit", "5");
  return {
    url,
    env: { TRANSLATION_HELPS_CACHE: kv } as RouteContext["env"],
    execCtx: {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
  };
}

describe("search response cache", () => {
  beforeEach(() => {
    clearCatalogProcessCache();
    clearArticleCatalogCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes the query and the type list into one key", () => {
    const a = searchResponseCacheKey(" Humility ", "en", "tw,ta", 5);
    const b = searchResponseCacheKey("humility", "en", "ta,tw", 5);
    expect(a).toBe(b);
    expect(a).toContain(encodeURIComponent("humility"));
    expect(searchResponseCacheKey("a:b", "en", "ta", 5)).toContain("a%3Ab");
  });

  it("does not search again for the same query", async () => {
    let fetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetches += 1;
        return Response.json({ data: [] });
      }),
    );
    const kv = memoryKv();
    const first = await handleSearch(ctx(kv, " Humility  "));
    const afterFirst = fetches;
    expect(afterFirst).toBeGreaterThan(0);
    expect(first.headers.get("Server-Timing")).toMatch(/layer;desc="network"/);
    expect(first.headers.get("Server-Timing")).not.toMatch(/humility/i);

    const second = await handleSearch(ctx(kv, "humility", "tw,ta"));
    expect(fetches).toBe(afterFirst);
    expect(second.headers.get("Server-Timing")).toMatch(/layer;desc="kv"/);
    expect(second.headers.get("Server-Timing")).not.toMatch(/humility/i);
    expect(await second.json()).toEqual(await first.json());
  });

  it("coalesces two searches that are in flight together", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const catalog = {
      language: "en",
      zipUrl: "https://example.test/articles.zip",
      articles: [],
    };
    let loads = 0;
    vi.spyOn(articleCatalog, "loadTaCatalog").mockImplementation(async () => {
      loads += 1;
      await gate;
      return catalog;
    });
    vi.spyOn(articleCatalog, "loadTwCatalog").mockImplementation(async () => {
      loads += 1;
      return catalog;
    });
    const kv = memoryKv();
    const first = handleSearch(ctx(kv, "patience"));
    await vi.waitFor(() => {
      expect(loads).toBe(1);
    });
    const second = handleSearch(ctx(kv, "Patience"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loads).toBe(1);
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(loads).toBe(2);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
  });
});
