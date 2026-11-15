import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type FakeReader = {
  id: number;
  sizes: Record<string, number>;
  calls: string[];
  [k: string]: unknown;
};

const BOOKS: Record<string, string> = { psa: "PSA", "1 john": "1JN" };
const RELATED: Record<string, string[]> = {
  "tw/a": ["ta/translate/x"],
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
        // strict: exact keys only, no case folding, no groups for articles
        return cls === "art" && key !== "tw" ? undefined : `${cls}:${key}`;
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
        const m = /^(\d?\s?[a-z]+)/i.exec(ref.trim());
        const book = m ? BOOKS[m[1].toLowerCase()] : undefined;
        const units: Record<string, number> = book
          ? { [`book:${book}`]: 1 }
          : {};
        units.map = 1; // the library loads the whole map unit for coverage
        return { revision: { units } };
      },
      installed(u: string) {
        r.calls.push(`installed:${u}`);
        return true;
      },
      async article(id: string) {
        r.calls.push(`article:${id}`);
        const related = RELATED[id];
        return {
          data: related
            ? { id, related: related.map((x) => ({ id: x })) }
            : { id },
          revision: { units: {} },
        };
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
  EXCLUSIVE_BYTE_CAP,
  EXCLUSIVE_DEADLINE_MS,
  setReaderClockForTests,
} from "../../src/packs3/readers";
import { resetWarnOnceForTests } from "../../src/packs3/keys";

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

  it("new catalog key -> new reader, old one released", async () => {
    const first = await id("a");
    catalogsByLang.set("a", cat("a", "k2"));
    expect(await id("a")).not.toBe(first);
    expect(liveReadersForTests()).toBe(1);
  });

  it("two calls racing to create the same key get one reader", async () => {
    const ids = await Promise.all([id("a"), id("a"), id("a")]);
    expect(new Set(ids).size).toBe(1);
    expect(opened.length).toBe(1);
  });

  it("concurrent calls count a unit once and together trigger a recycle", async () => {
    await id("a");
    opened[0].sizes["book:PSA"] = 1 * MB;
    opened[0].sizes["book:GEN"] = 1 * MB;
    await Promise.all([
      withReader(env, "a", (r) => r.book("PSA")),
      withReader(env, "a", (r) => r.book("PSA")),
      withReader(env, "a", (r) => r.book("GEN")),
    ]);
    expect(opened[0].calls.filter((c) => c === "size:book:PSA").length).toBe(1);
    expect(await id("a")).toBe(1); // 2 MB counted > 1.5 MB
  });

  it("counts passages whatever the case or form of the reference", async () => {
    for (const ref of ["PSA 1:1", "psa 1:1", "1 John 3:16"]) {
      const unit = ref.toLowerCase().startsWith("1") ? "book:1JN" : "book:PSA";
      resetReadersForTests();
      opened.length = 0;
      let first!: FakeReader;
      await withReader(env, "a", async (r) => {
        first = opened[0];
        first.sizes[unit] = 2 * MB;
        await r.passage(ref);
      });
      expect(first.calls).toContain(`size:${unit}`);
      expect(await id("a")).toBe(1);
    }
  });

  it("counts article reads (unitOf, else the id up to the last slash)", async () => {
    await withReader(env, "a", async (r) => {
      opened[0].sizes["art:tw"] = 2 * MB;
      await r.article("tw");
    });
    expect(await id("a")).toBe(1);
    resetReadersForTests();
    opened.length = 0;
    await withReader(env, "a", async (r) => {
      opened[0].sizes["art:ta/translate"] = 1 * MB;
      opened[0].sizes["art:ta/checking"] = 1 * MB;
      await r.article("ta/translate/figs-metaphor");
      await r.article("ta/checking/acceptable");
    });
    expect(opened[0].calls).toContain("size:art:ta/translate");
    expect(await id("a")).toBe(1);
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

  it("recycles past 1 MB; a running call keeps its reader", async () => {
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
      opened[0].sizes["book:PSA"] = 0.5 * MB;
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

  it("never holds more than two readers: a third overlapping call gets null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gates: Array<() => void> = [];
    const hold = (lang: string) =>
      withReader(
        env,
        lang,
        () => new Promise<number>((r) => gates.push(() => r(1))),
      );
    const a = hold("a");
    const b = hold("b");
    await tick();
    expect(await withReader(env, "c", async () => 1)).toBeNull();
    expect(liveReadersForTests()).toBe(2);
    expect(warn).toHaveBeenCalledWith("packs3 fallback", {
      lang: "c",
      reason: "readers-busy",
    });
    await withReader(env, "c", async () => 1);
    expect(warn).toHaveBeenCalledTimes(1); // once per (lang, reason)
    gates.forEach((g) => g());
    await Promise.all([a, b]);
    expect(await withReader(env, "c", async () => 7)).toBe(7);
    expect(liveReadersForTests()).toBe(2);
    warn.mockRestore();
  });

  it("a recycle while two readers are held also gets null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = withReader(env, "a", async (r) => {
      await r.book("PSA");
      await gate;
    });
    const b = withReader(env, "b", () => gate);
    await tick();
    opened[0].sizes["book:GEN"] = 2 * MB;
    await withReader(env, "a", async (r) => {
      await r.book("GEN");
    }); // counted over budget, shares reader 0
    expect(await withReader(env, "a", async () => 1)).toBeNull();
    release();
    await Promise.all([a, b]);
    expect(await withReader(env, "a", async () => 2)).toBe(2);
    warn.mockRestore();
  });

  it("counts the map unit a passage loads", async () => {
    await withReader(env, "a", async (r) => {
      opened[0].sizes.map = 2 * MB;
      await r.passage("PSA 1:1");
    });
    expect(opened[0].calls).toContain("size:map");
    expect(await id("a")).toBe(1);
  });

  it("counts the groups an article's related ids point into", async () => {
    await withReader(env, "a", async (r) => {
      opened[0].sizes["art:ta/translate"] = 2 * MB;
      await r.article("tw/a");
    });
    expect(opened[0].calls).toContain("size:art:ta/translate");
    expect(await id("a")).toBe(1);
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

  describe("exclusive reader (a book over the budget)", () => {
    const big = { need: () => 1.5 * MB };
    const hold = (lang: string, opts?: { need: () => number }) => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const p = withReader(
        env,
        lang,
        async (r) => (await gate, fake(r).id),
        opts,
      );
      return { p, release };
    };
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      resetWarnOnceForTests();
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it("opens alone: a fresh reader, idle readers dropped, recycled after its call", async () => {
      await id("a");
      await id("b");
      expect(liveReadersForTests()).toBe(2);
      let during = -1;
      const got = await withReader(
        env,
        "a",
        async (r) => ((during = liveReadersForTests()), fake(r).id),
        big,
      );
      expect(got).toBe(2); // not the live reader 0
      expect(during).toBe(1);
      expect(liveReadersForTests()).toBe(0); // retired right after
      expect(await id("a")).toBe(3); // the next normal call opens anew
    });

    it("is blocked while another reader has a call running", async () => {
      const a = hold("b");
      await tick();
      expect(await withReader(env, "a", async () => 1, big)).toBeNull();
      expect(warn).toHaveBeenCalledWith("packs3 fallback", {
        lang: "a",
        reason: "readers-busy",
      });
      a.release();
      await a.p;
      expect(await withReader(env, "a", async () => 1, big)).toBe(1);
    });

    it("is blocked while a recycled reader still runs", async () => {
      const a = hold("a");
      await tick();
      opened[0].sizes["book:GEN"] = 2 * MB;
      await withReader(env, "a", (r) => r.book("GEN"));
      expect(await id("a")).toBe(1); // reader 0 retired but running, reader 1 live and idle
      expect(await withReader(env, "b", async () => 1, big)).toBeNull();
      a.release();
      await a.p;
      expect(await withReader(env, "b", async () => 1, big)).toBe(1);
    });

    it("blocks every other call while it is open, logged once per (lang, reason)", async () => {
      const x = hold("a", big);
      await tick();
      expect(liveReadersForTests()).toBe(1);
      expect(await withReader(env, "b", async () => 1)).toBeNull();
      expect(await withReader(env, "b", async () => 1)).toBeNull();
      expect(await withReader(env, "a", async () => 1)).toBeNull();
      expect(await withReader(env, "a", async () => 1, big)).toBeNull();
      expect(
        warn.mock.calls.filter((c) => (c[1] as { lang: string }).lang === "b"),
      ).toHaveLength(1);
      x.release();
      expect(await x.p).toBe(0);
      expect(await withReader(env, "b", async () => 5)).toBe(5);
    });

    it("refuses a book over the exclusive cap (book-too-large)", async () => {
      expect(EXCLUSIVE_BYTE_CAP).toBe(1.8 * MB);
      const used = vi.fn(async () => 1);
      expect(
        await withReader(env, "a", used, { need: () => 1.8 * MB + 1 }),
      ).toBeNull();
      expect(used).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith("packs3 fallback", {
        lang: "a",
        reason: "book-too-large",
      });
      expect(
        await withReader(env, "a", async () => 2, { need: () => 1.8 * MB }),
      ).toBe(2);
    });

    it("a throw inside an exclusive use clears the slot and the next call is served", async () => {
      await expect(
        withReader(
          env,
          "a",
          async () => {
            throw new Error("boom");
          },
          big,
        ),
      ).rejects.toThrow("boom");
      expect(liveReadersForTests()).toBe(0);
      expect(await withReader(env, "b", async () => 7)).toBe(7);
    });

    it("an exclusive call past the deadline is abandoned; a late finish does not clear a newer slot", async () => {
      let t = 1000;
      setReaderClockForTests(() => t);
      const old = hold("a", big);
      await tick();
      t += EXCLUSIVE_DEADLINE_MS; // exactly at the deadline: still held
      expect(await withReader(env, "b", async () => 1)).toBeNull();
      t += 1;
      expect(await withReader(env, "b", async () => 1)).toBe(1); // abandoned, served
      const abandonedLogs = () =>
        warn.mock.calls.filter(
          (c) => c[0] === "packs3 exclusive reader abandoned",
        );
      expect(abandonedLogs()).toHaveLength(1);
      const fresh = hold("a", big); // a newer exclusive slot
      await tick();
      old.release();
      await old.p; // the old call finishes late
      expect(await withReader(env, "b", async () => 1)).toBeNull(); // newer slot intact
      t += EXCLUSIVE_DEADLINE_MS + 1;
      expect(await withReader(env, "b", async () => 2)).toBe(2);
      expect(abandonedLogs()).toHaveLength(1); // once per isolate
      fresh.release();
      await fresh.p;
    });

    it("a need within the budget uses the normal shared reader", async () => {
      const first = await id("a");
      expect(
        await withReader(env, "a", async (r) => fake(r).id, {
          need: () => 1 * MB,
        }),
      ).toBe(first);
      expect(liveReadersForTests()).toBe(1);
    });

    it("the need is measured on the reader's sizes", async () => {
      await id("a");
      opened[0].sizes["book:psa"] = 1.2 * MB;
      let seen = 0;
      await withReader(env, "a", async () => 1, {
        need: (r) => (seen = r.size(r.unitOf("book", "psa") ?? "")),
      });
      expect(seen).toBe(1.2 * MB);
      expect(opened.length).toBe(2); // the exclusive one is fresh
    });
  });
});
