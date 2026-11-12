import { describe, it, expect, beforeEach, vi } from "vitest";

type FakeReader = {
  id: number;
  sizes: Record<string, number>;
  calls: string[];
  [k: string]: unknown;
};

const catalogsByLang = new Map<
  string,
  { lang: string; key: string; catalogs: unknown[] } | null
>();
const opened: FakeReader[] = [];

vi.mock("../../src/packs3/catalogs", () => ({
  getCatalogs: vi.fn(
    async (_env: unknown, lang: string) => catalogsByLang.get(lang) ?? null,
  ),
}));
vi.mock("../../src/packs3/segments", () => ({
  segmentGetter: vi.fn(() => async () => undefined),
}));
vi.mock("../../vendor/language-pack-client/index.js", () => ({
  openFromSegments: vi.fn(() => {
    const r: FakeReader = {
      id: opened.length,
      sizes: {},
      calls: [],
      lang: String(opened.length),
      problems: [],
      size(u: string) {
        r.calls.push(`size:${u}`);
        return r.sizes[u] ?? 0;
      },
      unitOf(cls: string, key: string) {
        r.calls.push(`unitOf:${cls}:${key}`);
        return `${cls}:${key}`;
      },
      async book(b: string) {
        r.calls.push(`book:${b}`);
        return {};
      },
      async orig(b: string) {
        r.calls.push(`orig:${b}`);
        return {};
      },
      async articles(g: string) {
        r.calls.push(`articles:${g}`);
        return [];
      },
      async passage(ref: string) {
        r.calls.push(`passage:${ref}`);
        return {};
      },
    };
    opened.push(r);
    return r;
  }),
}));

import {
  withReader,
  liveReadersForTests,
  resetReadersForTests,
} from "../../src/packs3/readers";

const MB = 1024 * 1024;
const env = {};
const cat = (lang: string, key = `k-${lang}`) => ({ lang, key, catalogs: [] });
const fake = (r: unknown) => ({ id: Number((r as { lang: string }).lang) });
const id = async (lang: string) =>
  (await withReader(env, lang, async (r) => fake(r).id)) as number;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetReadersForTests();
  opened.length = 0;
  catalogsByLang.clear();
  catalogsByLang.set("a", cat("a"));
  catalogsByLang.set("b", cat("b"));
  catalogsByLang.set("c", cat("c"));
});

describe("withReader", () => {
  it("returns null when there are no catalogs", async () => {
    expect(await withReader(env, "zz", async () => 1)).toBeNull();
  });

  it("same catalogs -> same reader", async () => {
    expect(await id("a")).toBe(await id("a"));
    expect(opened.length).toBe(1);
  });

  it("new catalog key -> new reader", async () => {
    const first = await id("a");
    catalogsByLang.set("a", cat("a", "k2"));
    expect(await id("a")).not.toBe(first);
  });

  it("keeps at most two readers across three languages (LRU)", async () => {
    await id("a");
    await id("b");
    await id("c");
    expect(opened.length).toBe(3);
    expect(liveReadersForTests()).toBe(2);
    await id("c");
    await id("b");
    expect(opened.length).toBe(3); // b and c are live
    await id("a"); // a was dropped
    expect(opened.length).toBe(4);
  });

  it("recycles past 3 MB; a running call keeps its reader", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = withReader(env, "a", async (r) => {
      await gate;
      await r.book("PSA");
      return fake(r).id;
    });
    await tick();
    const old = opened[0];
    old.sizes["book:PSA"] = 2 * MB;
    old.sizes["book:GEN"] = 2 * MB;
    await withReader(env, "a", async (r) => {
      await r.book("GEN");
      await r.book("PSA");
      await r.book("PSA"); // counted once
    });
    const next = await id("a");
    expect(next).not.toBe(0);
    release();
    expect(await slow).toBe(0);
    expect(old.calls.filter((c) => c === "size:book:PSA").length).toBe(1);
  });

  it("does not recycle below the budget", async () => {
    await withReader(env, "a", async (r) => {
      opened[0].sizes["book:PSA"] = 1 * MB;
      await r.book("PSA");
    });
    expect(await id("a")).toBe(0);
  });

  it("drops a recycled reader when its last call ends", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = withReader(env, "a", async () => {
      await gate;
    });
    await tick();
    opened[0].sizes["orig:PSA"] = 4 * MB;
    await withReader(env, "a", async (r) => {
      await r.orig("PSA");
    });
    await id("a"); // fresh reader
    expect(liveReadersForTests()).toBe(2); // fresh + recycled, still in flight
    release();
    await slow;
    expect(liveReadersForTests()).toBe(1);
  });

  it("a reader evicted by LRU while in flight is released at the end", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = withReader(env, "a", async () => {
      await gate;
    });
    await tick();
    await id("b");
    await id("c"); // evicts a, still running
    expect(liveReadersForTests()).toBe(3);
    release();
    await slow;
    expect(liveReadersForTests()).toBe(2);
  });

  it("the byte counter only calls allowed methods", async () => {
    await withReader(env, "a", async (r) => {
      await r.book("PSA");
      await r.orig("PSA");
      await r.articles("tw");
      await r.passage("PSA 1:1");
    });
    for (const c of opened[0].calls) {
      expect(c).toMatch(/^(size|unitOf|book|orig|articles|passage):/);
    }
  });
});
