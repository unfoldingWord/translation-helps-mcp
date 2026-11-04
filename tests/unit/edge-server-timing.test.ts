/**
 * The edge cache must not replay the Server-Timing of the request that
 * filled it. A hit names this request's own time and the edge layer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../../src/api/worker.js";
import {
  formatServerTiming,
  slowestLayer,
} from "../../src/api/serverTiming.js";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit.js";
import { mapApiCacheStatus } from "../../src/mcp/tools/shared.js";
import { clearCatalogProcessCache } from "@translation-helps/door43";

function envelope(data: unknown): string {
  return JSON.stringify({ fetchedAt: Date.now(), data });
}

function memoryKv(): KVNamespace {
  return {
    async get(key: string) {
      if (key.startsWith("catalog:list:languages:")) {
        return envelope([{ code: "en", name: "English", direction: "ltr" }]);
      }
      return null;
    },
    async put() {},
  } as unknown as KVNamespace;
}

describe("edge cache Server-Timing", () => {
  const previous = globalThis.caches;

  afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimitStoreForTests();
    clearCatalogProcessCache();
    globalThis.caches = previous;
  });

  it("counts edge as the fastest layer and as a hit", () => {
    expect(formatServerTiming({ layer: "edge", totalMs: 4 })).toBe(
      'layer;desc="edge", total;dur=4',
    );
    expect(slowestLayer(["edge", "kv"])).toBe("kv");
    expect(mapApiCacheStatus("edge")).toBe("hit");
  });

  it("stores no Server-Timing and answers a hit as edge", async () => {
    const saved: Response[] = [];
    const box = new Map<string, Response>();
    const pending: Array<Promise<unknown>> = [];
    globalThis.caches = {
      default: {
        async match(request: RequestInfo | URL) {
          const url =
            request instanceof Request ? request.url : String(request);
          const found = box.get(url);
          return found ? found.clone() : undefined;
        },
        async put(request: RequestInfo | URL, response: Response) {
          const url =
            request instanceof Request ? request.url : String(request);
          saved.push(response.clone());
          box.set(url, response);
        },
      },
    } as unknown as CacheStorage;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("languages were not in KV");
      }),
    );

    const env = {
      TRANSLATION_HELPS_CACHE: memoryKv(),
      RATE_LIMIT_RPM: "0",
    } as Env;
    const exec = {
      waitUntil(task: Promise<unknown>) {
        pending.push(task);
      },
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;
    const url = "https://example.test/api/v1/languages";

    const first = await worker.fetch(new Request(url), env, exec);
    await Promise.all(pending);
    expect(first.status).toBe(200);
    expect(first.headers.get("Server-Timing")).toMatch(/layer;desc="kv"/);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.headers.get("Server-Timing")).toBeNull();

    const second = await worker.fetch(new Request(url), env, exec);
    const header = second.headers.get("Server-Timing") ?? "";
    expect(header).toMatch(/^layer;desc="edge", total;dur=\d+$/);
    const dur = Number(/total;dur=(\d+)/.exec(header)?.[1]);
    expect(dur).toBeGreaterThanOrEqual(0);
    expect(dur).toBeLessThan(1_000);
    expect(header).not.toMatch(/kv|network|r2/);
  });
});
