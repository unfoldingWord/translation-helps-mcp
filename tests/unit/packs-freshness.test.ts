/**
 * A pack follows Door43: an entry hit checks, at most once an hour per language, whether the tc-ready catalog has a
 * newer release of anything the pack was built from, and asks for a build when it does. es-419 and en are also
 * rebuilt every day by the cron, which refreshes the originals and lexicons the hourly check never looks at.
 */

import { describe, it, expect } from "vitest";
import type { CatalogEntry } from "@translation-helps/door43";
import {
  checkFreshness,
  currentStamps,
  isStale,
  runDailyBuilds,
  type FreshnessEnv,
  type PackCatalogEntry,
} from "../../src/packs/freshness";
import { CURRENT_PACK_COMPAT, type BuildOutcome } from "../../src/packs/dispatch";

const COMPAT = "f1.1-u2.3.0-p6000230-q8-a11-t1";
const NOW = new Date("2026-10-21T10:00:00Z");
const MINUTE = 60_000;

function entry(stamps: Record<string, string>): PackCatalogEntry {
  return {
    schema: 1,
    language: "es-419",
    compat: COMPAT,
    build: { id: "0123456789abcdef", generator: "abc", stamps },
    createdAt: "2026-10-20T00:00:00Z",
    pack: { path: `packs/${COMPAT}/es-419/x.langpack.zip`, bytes: 1, sha256: "x" },
    resources: [],
  };
}

const BUILT = {
  "es-419_gl/es-419/glt": "v42#2026-08-11T12_22_03Z",
  "es-419_gl/es-419/tn": "v10#2026-07-01T00_00_00Z",
  "unfoldingWord/hbo/uhb": "v2.1.31#2024-01-01T00_00_00Z",
  "es-419_gl/es-419/uhl": "master",
};

function row(name: string, stamp: string, owner = "es-419_gl"): CatalogEntry {
  return { owner, repo: name, name, language: "es-419", stamp, ingredients: [] };
}

describe("isStale", () => {
  it("is not stale when every stamp is the same", () => {
    expect(
      isStale(entry(BUILT), {
        "es-419_gl/es-419/glt": "v42#2026-08-11T12_22_03Z",
        "es-419_gl/es-419/tn": "v10#2026-07-01T00_00_00Z",
      }),
    ).toBe(false);
  });

  it("is stale when the GLT has a newer release", () => {
    expect(
      isStale(entry(BUILT), {
        "es-419_gl/es-419/glt": "v43#2026-10-20T09_00_00Z",
        "es-419_gl/es-419/tn": "v10#2026-07-01T00_00_00Z",
      }),
    ).toBe(true);
  });

  it("ignores keys the catalog does not list (originals and lexicons), and rows the pack never used", () => {
    expect(
      isStale(entry(BUILT), {
        "es-419_gl/es-419/glt": "v42#2026-08-11T12_22_03Z",
        "es-419_gl/es-419/obs": "v9#2026-10-20T00_00_00Z",
      }),
    ).toBe(false);
  });
});

describe("currentStamps", () => {
  it("keys each row as bt-synergy does (owner/language/repo name after the first _), skipping rows without a stamp", () => {
    expect(
      currentStamps(
        [
          row("es-419_glt", "v42#2026-08-11T12_22_03Z"),
          row("es-419_obs-tq", "v2#2026-05-09T10_43_35Z"),
          row("es-419_tw", "v5#2026-01-01T00_00_00Z", "es-419_obt"),
          { ...row("es-419_tn", "nostamp") },
          { owner: "es-419_gl", repo: "es-419_tq", name: "es-419_tq", ingredients: [] },
        ],
        "es-419",
      ),
    ).toEqual({
      "es-419_gl/es-419/glt": "v42#2026-08-11T12_22_03Z",
      "es-419_gl/es-419/obs-tq": "v2#2026-05-09T10_43_35Z",
      "es-419_obt/es-419/tw": "v5#2026-01-01T00_00_00Z",
    });
  });
});

/** KV that keeps values without expiring them; the check compares the time it wrote itself. */
function fakeKv() {
  const values = new Map<string, string>();
  const puts: Array<{ key: string; ttl?: number }> = [];
  const kv = {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string, o?: { expirationTtl?: number }) {
      values.set(key, value);
      puts.push({ key, ttl: o?.expirationTtl });
    },
  };
  return { kv: kv as unknown as KVNamespace, values, puts };
}

function setup(opts: { rows?: CatalogEntry[]; searchThrows?: boolean } = {}) {
  const { kv, values, puts } = fakeKv();
  const searches: string[] = [];
  const builds: Array<{ compat: string; language: string; reason: string }> = [];
  const points: Array<{ blobs?: string[] }> = [];
  const pending: Promise<unknown>[] = [];
  const env: FreshnessEnv = {
    TRANSLATION_HELPS_CACHE: kv,
    ANALYTICS: {
      writeDataPoint: (p: { blobs?: string[] }) => void points.push(p),
    } as unknown as AnalyticsEngineDataset,
  };
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const deps = {
    search: async (language: string) => {
      searches.push(language);
      if (opts.searchThrows) throw new Error("HTTP 503 from DCS");
      return opts.rows ?? [row("es-419_glt", "v42#2026-08-11T12_22_03Z")];
    },
    requestBuild: async (o: {
      compat: string;
      language: string;
      reason: string;
    }): Promise<BuildOutcome> => {
      builds.push({ compat: o.compat, language: o.language, reason: o.reason });
      return "dispatched";
    },
  };
  const check = (now = NOW, e: PackCatalogEntry | (() => Promise<PackCatalogEntry | null>) = entry(BUILT)) =>
    checkFreshness({ env, ctx, compat: COMPAT, language: "es-419", entry: e, now, ...deps });
  return { check, values, puts, searches, builds, points, pending };
}

describe("checkFreshness", () => {
  it("asks for a stale build when the catalog has a newer GLT, and counts it", async () => {
    const s = setup({ rows: [row("es-419_glt", "v43#2026-10-20T09_00_00Z")] });
    await s.check();
    expect(s.searches).toEqual(["es-419"]);
    expect(s.builds).toEqual([{ compat: COMPAT, language: "es-419", reason: "stale" }]);
    expect(s.points.map((p) => p.blobs)).toEqual([
      ["pack", "entry", "es-419", "stale-dispatched"],
    ]);
  });

  it("asks for nothing when the pack is current", async () => {
    const s = setup();
    await s.check();
    expect(s.searches).toEqual(["es-419"]);
    expect(s.builds).toEqual([]);
    expect(s.points).toEqual([]);
  });

  it("checks a language at most once an hour", async () => {
    const s = setup({ rows: [row("es-419_glt", "v43#2026-10-20T09_00_00Z")] });
    await s.check(NOW);
    await s.check(new Date(NOW.getTime() + 59 * MINUTE));
    expect(s.searches).toHaveLength(1);
    expect(s.builds).toHaveLength(1);
    expect(s.puts[0]).toEqual({ key: `packs:fresh:${COMPAT}:es-419`, ttl: 3600 });

    await s.check(new Date(NOW.getTime() + 61 * MINUTE));
    expect(s.searches).toHaveLength(2);
  });

  it("asks for nothing, and does not throw, when the catalog search fails", async () => {
    const s = setup({ searchThrows: true });
    await expect(s.check()).resolves.toBeUndefined();
    expect(s.builds).toEqual([]);
  });

  it("reads the entry only once the hour allows a check (a 304 carries no body)", async () => {
    const s = setup({ rows: [row("es-419_glt", "v43#2026-10-20T09_00_00Z")] });
    let reads = 0;
    const load = async () => {
      reads++;
      return entry(BUILT);
    };
    await s.check(NOW, load);
    await s.check(new Date(NOW.getTime() + 5 * MINUTE), load);
    expect(reads).toBe(1);
    expect(s.builds).toHaveLength(1);
  });
});

describe("runDailyBuilds (the cron)", () => {
  it("asks for a daily build of es-419 and en under the current compat", async () => {
    const builds: Array<{ compat: string; language: string; reason: string }> = [];
    const env = { TRANSLATION_HELPS_CACHE: {} as KVNamespace };
    await runDailyBuilds(env, async (o) => {
      builds.push({ compat: o.compat, language: o.language, reason: o.reason });
      return "dispatched";
    });
    expect(builds).toEqual([
      { compat: CURRENT_PACK_COMPAT, language: "es-419", reason: "daily" },
      { compat: CURRENT_PACK_COMPAT, language: "en", reason: "daily" },
    ]);
    expect(CURRENT_PACK_COMPAT).toBe(COMPAT);
  });
});
