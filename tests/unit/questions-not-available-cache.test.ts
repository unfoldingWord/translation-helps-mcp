/**
 * A cached "no questions" answer tells the model not to fill the gap from
 * memory. That cache is only for a catalog or a zip that really said the
 * language or book has none. A failed Door43 request must not be stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCatalogProcessCache } from "@translation-helps/door43";
import { handleQuestions } from "../../src/api/routes/questions.js";
import type { Env } from "../../src/api/worker.js";

const originalFetch = globalThis.fetch;

function questionsUrl(language: string): URL {
  return new URL(
    `https://example.test/api/v1/questions?reference=ROM+1%3A1&language=${language}`,
  );
}

function cacheSpy(): { kv: KVNamespace; puts: string[] } {
  const puts: string[] = [];
  const kv = {
    async get() {
      return null;
    },
    async put(key: string) {
      puts.push(key);
    },
  };
  return { kv: kv as unknown as KVNamespace, puts };
}

function call(language: string, kv: KVNamespace): Promise<Response> {
  return handleQuestions({
    url: questionsUrl(language),
    env: { TRANSLATION_HELPS_CACHE: kv } as Env,
    execCtx: {
      waitUntil() {},
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  });
}

beforeEach(() => {
  clearCatalogProcessCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("questions not-available cache", () => {
  it("does not cache when the catalog request fails", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
    const { kv, puts } = cacheSpy();
    await expect(call("fr", kv)).rejects.toThrow(/Network error/);
    expect(puts).toEqual([]);
  });

  it("does not cache when the zip request times out", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("example.test/fr-tq.zip")) {
        throw new Error("The operation was aborted due to timeout");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: [
            {
              name: "fr_tq",
              owner: "unfoldingWord",
              subject: "TSV Translation Questions",
              language: "fr",
              branch_or_tag_name: "v1",
              zipball_url: "https://example.test/fr-tq.zip",
              ingredients: [],
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;
    const { kv, puts } = cacheSpy();
    await expect(call("fr", kv)).rejects.toThrow(/timeout/);
    expect(puts.filter((key) => key.startsWith("resp:"))).toEqual([]);
  });

  it("caches when the catalog really has no questions", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: [] }),
    }) as unknown as typeof fetch;
    const { kv, puts } = cacheSpy();
    const response = await call("zz", kv);
    const body = (await response.json()) as { available?: boolean };
    expect(body.available).toBe(false);
    expect(puts.some((key) => key.includes("questions"))).toBe(true);
  });
});
