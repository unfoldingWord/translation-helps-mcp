/**
 * A pack follows Door43: an entry hit checks, at most once an hour per language, whether the tc-ready catalog has a
 * newer release of anything the pack was built from, and asks for a build when it does. es-419 and en are also
 * rebuilt every day by the cron, which refreshes the originals and lexicons the hourly check never looks at.
 */

import { describe, it, expect, vi } from "vitest";
import type { CatalogEntry } from "@translation-helps/door43";
import {
  checkFreshness,
  currentStamps,
  isStale,
  newestDifferingRelease,
  runDailyBuilds,
  type FreshnessEnv,
  type PackCatalogEntry,
} from "../../src/packs/freshness";
import {
  CURRENT_PACK_COMPAT,
  type BuildOutcome,
} from "../../src/packs/dispatch";

// Only the default search reads the catalog; the other tests inject their own.
const door43 = vi.hoisted(() => ({
  searches: [] as Array<{ lang?: string; limit?: number }>,
}));
vi.mock("@translation-helps/door43", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  catalogSearch: async (o: { lang?: string; limit?: number }) => {
    door43.searches.push({ lang: o.lang, limit: o.limit });
    return [];
  },
}));

const COMPAT = "f1.1-u2.3.0-p6000230-q8-a11-t1";
const OLD_COMPAT = "f1.1-u2.3.0-p6000229-q8-a11-t1";
const NOW = new Date("2026-10-21T10:00:00Z");
const MINUTE = 60_000;

function entry(stamps: Record<string, string>): PackCatalogEntry {
  return {
    schema: 1,
    language: "es-419",
    compat: COMPAT,
    build: { id: "0123456789abcdef", generator: "abc", stamps },
    createdAt: "2026-10-20T00:00:00Z",
    pack: {
      path: `packs/${COMPAT}/es-419/x.langpack.zip`,
      bytes: 1,
      sha256: "x",
    },
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
  return {
    owner,
    repo: name,
    name,
    language: "es-419",
    stamp,
    ingredients: [],
  };
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
          {
            owner: "es-419_gl",
            repo: "es-419_tq",
            name: "es-419_tq",
            ingredients: [],
          },
          // Lexicon stamps in a build are sha10#commitDate, never a catalog tag#published.
          row("es-419_uhl", "v1#2026-01-01T00_00_00Z"),
          row("es-419_ugl", "v1#2026-01-01T00_00_00Z"),
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

function setup(
  opts: {
    rows?: CatalogEntry[];
    searchThrows?: boolean;
    status?: unknown;
  } = {},
) {
  const { kv, values, puts } = fakeKv();
  const searches: string[] = [];
  const builds: Array<{ compat: string; language: string; reason: string }> =
    [];
  const points: Array<{ blobs?: string[] }> = [];
  const pending: Promise<unknown>[] = [];
  const statusKey = `status/${COMPAT}/es-419.json`;
  const env: FreshnessEnv = {
    TRANSLATION_HELPS_CACHE: kv,
    LANGUAGE_PACKS: {
      async get(key: string) {
        if (key !== statusKey || opts.status === undefined) return null;
        return { text: async () => JSON.stringify(opts.status) };
      },
    } as unknown as R2Bucket,
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
  const check = (
    now = NOW,
    e: PackCatalogEntry | (() => Promise<PackCatalogEntry | null>) = entry(
      BUILT,
    ),
    compat = COMPAT,
    reason?: "stale" | "daily",
  ) =>
    checkFreshness({
      env,
      ctx,
      compat,
      language: "es-419",
      entry: e,
      now,
      reason,
      ...deps,
    });
  const checkWithDefaultSearch = () =>
    checkFreshness({
      env,
      ctx,
      compat: COMPAT,
      language: "es-419",
      entry: entry(BUILT),
      now: NOW,
      requestBuild: deps.requestBuild,
    });
  return {
    check,
    checkWithDefaultSearch,
    values,
    puts,
    searches,
    builds,
    points,
    pending,
  };
}

describe("checkFreshness", () => {
  it("asks for a stale build when the catalog has a newer GLT, and counts it", async () => {
    const s = setup({ rows: [row("es-419_glt", "v43#2026-10-20T09_00_00Z")] });
    await s.check();
    expect(s.searches).toEqual(["es-419"]);
    expect(s.builds).toEqual([
      { compat: COMPAT, language: "es-419", reason: "stale" },
    ]);
    expect(s.points.map((p) => p.blobs)).toEqual([
      ["pack", "freshness", "es-419", "stale-dispatched"],
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
    expect(s.puts[0]).toEqual({
      key: `packs:fresh:${COMPAT}:es-419`,
      ttl: 3600,
    });

    await s.check(new Date(NOW.getTime() + 61 * MINUTE));
    expect(s.searches).toHaveLength(2);
  });

  it("asks for nothing, and does not throw, when the catalog search fails", async () => {
    const s = setup({ searchThrows: true });
    await expect(s.check()).resolves.toBeUndefined();
    expect(s.builds).toEqual([]);
  });

  it("does nothing for an old compat: no throttle, no search, no build (the workflow cannot build it)", async () => {
    const s = setup({ rows: [row("es-419_glt", "v43#2026-10-20T09_00_00Z")] });
    await s.check(NOW, entry(BUILT), OLD_COMPAT);
    expect(s.puts).toEqual([]);
    expect(s.searches).toEqual([]);
    expect(s.builds).toEqual([]);
  });

  it("asks the catalog for as many rows as bt-synergy's discovery does", async () => {
    door43.searches.length = 0;
    const s = setup();
    await s.checkWithDefaultSearch();
    expect(door43.searches).toEqual([{ lang: "es-419", limit: 500 }]);
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

  it("passes the cron's reason on, so its builds bypass the daily cap", async () => {
    const s = setup({ rows: [row("es-419_glt", "v43#2026-10-20T09_00_00Z")] });
    await s.check(NOW, entry(BUILT), COMPAT, "daily");
    expect(s.builds).toEqual([
      { compat: COMPAT, language: "es-419", reason: "daily" },
    ]);
  });
});

describe("checkFreshness when the last build already saw the release (loop breaker)", () => {
  const NEWER_GLT = [row("es-419_glt", "v43#2026-10-20T09_00_00Z")];

  it("asks for nothing when an ok build started after the newest differing release, and says so", async () => {
    const s = setup({
      rows: NEWER_GLT,
      status: {
        state: "ok",
        at: "2026-10-20T11:00:00.000Z",
        failures: 0,
        run: "https://run/9",
        started: "2026-10-20T10:00:00.000Z",
      },
    });
    await s.check();
    expect(s.builds).toEqual([]);
    expect(s.points.map((p) => p.blobs)).toEqual([
      ["pack", "freshness", "es-419", "stale-seen"],
    ]);
  });

  it("still asks when the release was published while the ok build ran (after started, before at)", async () => {
    const s = setup({
      rows: NEWER_GLT,
      status: {
        state: "ok",
        at: "2026-10-20T11:00:00.000Z",
        failures: 0,
        run: "https://run/9",
        started: "2026-10-20T08:00:00.000Z",
      },
    });
    await s.check();
    expect(s.builds).toHaveLength(1);
    expect(s.points.map((p) => p.blobs)).not.toContainEqual([
      "pack",
      "freshness",
      "es-419",
      "stale-seen",
    ]);
  });

  it("with no started, still asks when the release is within the job timeout before at", async () => {
    const s = setup({
      rows: NEWER_GLT,
      status: {
        state: "ok",
        // 300 min before is 06:00, earlier than the 09:00 release: the run may have begun before it.
        at: "2026-10-20T11:00:00.000Z",
        failures: 0,
        run: "https://run/9",
      },
    });
    await s.check();
    expect(s.builds).toHaveLength(1);
  });

  it("with no started, asks for nothing when the release is older than at minus the job timeout", async () => {
    const s = setup({
      rows: NEWER_GLT,
      status: {
        state: "ok",
        // 300 min before is 09:30, later than the 09:00 release: any run ending then began after it.
        at: "2026-10-20T14:30:00.000Z",
        failures: 0,
        run: "https://run/9",
      },
    });
    await s.check();
    expect(s.builds).toEqual([]);
    expect(s.points.map((p) => p.blobs)).toEqual([
      ["pack", "freshness", "es-419", "stale-seen"],
    ]);
  });

  it("with a started that does not parse, falls back to the job timeout", async () => {
    const s = setup({
      rows: NEWER_GLT,
      status: {
        state: "ok",
        at: "2026-10-20T11:00:00.000Z",
        failures: 0,
        run: "https://run/9",
        started: "soon",
      },
    });
    await s.check();
    expect(s.builds).toHaveLength(1);
  });

  it("still asks when the ok build is older than the release", async () => {
    const s = setup({
      rows: NEWER_GLT,
      status: {
        state: "ok",
        at: "2026-10-20T08:00:00.000Z",
        failures: 0,
        run: "https://run/9",
      },
    });
    await s.check();
    expect(s.builds).toHaveLength(1);
  });

  it("still asks when the last build failed, however recent", async () => {
    const s = setup({
      rows: NEWER_GLT,
      status: {
        state: "failed",
        at: "2026-10-21T09:00:00.000Z",
        failures: 1,
        run: "https://run/9",
      },
    });
    await s.check();
    expect(s.builds).toHaveLength(1);
  });

  it("still asks when no differing stamp carries a date to compare", async () => {
    const s = setup({
      rows: [row("es-419_glt", "v43")],
      status: {
        state: "ok",
        at: "2026-10-21T09:00:00.000Z",
        failures: 0,
        run: "https://run/9",
      },
    });
    await s.check();
    expect(s.builds).toHaveLength(1);
  });
});

describe("newestDifferingRelease", () => {
  it("reads the newest published date of the differing keys, from the catalog's stamps, with : restored", () => {
    expect(
      newestDifferingRelease(entry(BUILT), {
        "es-419_gl/es-419/glt": "v43#2026-10-20T09_00_00Z",
        "es-419_gl/es-419/tn": "v11#2026-09-01T00_00_00Z",
        // Same stamp: not a difference, however new.
        "unfoldingWord/hbo/uhb": "v2.1.31#2024-01-01T00_00_00Z",
      }),
    ).toBe(Date.parse("2026-10-20T09:00:00Z"));
  });

  it("skips stamps with no date after # and answers null when none has one", () => {
    expect(
      newestDifferingRelease(entry(BUILT), {
        "es-419_gl/es-419/glt": "v43",
        "es-419_gl/es-419/tn": "v11#not-a-date",
      }),
    ).toBeNull();
  });
});

/** A bucket with catalog entries under the given keys, listed `pageSize` at a time like R2's cursor pages. */
function catalogBucket(keys: string[], pageSize = 2) {
  const lists: Array<{ prefix?: string; cursor?: string }> = [];
  const bucket = {
    async list(o: { prefix?: string; cursor?: string }) {
      lists.push(o);
      const matching = keys.filter((k) => k.startsWith(o.prefix ?? ""));
      const start = Number(o.cursor ?? "0");
      const objects = matching
        .slice(start, start + pageSize)
        .map((key) => ({ key }));
      const next = start + pageSize;
      return next < matching.length
        ? { objects, truncated: true, cursor: String(next) }
        : { objects, truncated: false };
    },
    async get(key: string) {
      return keys.includes(key) ? { json: async () => entry(BUILT) } : null;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, lists };
}

describe("runDailyBuilds (the cron)", () => {
  it("asks for a daily build of es-419 and en under the current compat", async () => {
    const builds: Array<{ compat: string; language: string; reason: string }> =
      [];
    const env = { TRANSLATION_HELPS_CACHE: {} as KVNamespace };
    await runDailyBuilds(env, {} as ExecutionContext, {
      requestBuild: async (o) => {
        builds.push({
          compat: o.compat,
          language: o.language,
          reason: o.reason,
        });
        return "dispatched";
      },
    });
    expect(builds).toEqual([
      { compat: CURRENT_PACK_COMPAT, language: "es-419", reason: "daily" },
      { compat: CURRENT_PACK_COMPAT, language: "en", reason: "daily" },
    ]);
    expect(CURRENT_PACK_COMPAT).toBe(COMPAT);
  });

  it("then checks every other language in the bucket under the current compat, page after page, as the cron", async () => {
    const { bucket, lists } = catalogBucket([
      `catalog/${COMPAT}/en.json`,
      `catalog/${COMPAT}/es-419.json`,
      `catalog/${COMPAT}/fr.json`,
      `catalog/${COMPAT}/originals.json`,
      `catalog/${COMPAT}/pt-br.json`,
      `catalog/${COMPAT}/sw.json`,
      `catalog/${OLD_COMPAT}/de.json`,
    ]);
    const checks: Array<{ language: string; reason?: string; entry: unknown }> =
      [];
    const env = {
      TRANSLATION_HELPS_CACHE: {} as KVNamespace,
      LANGUAGE_PACKS: bucket,
    };
    await runDailyBuilds(env, {} as ExecutionContext, {
      requestBuild: async () => "dispatched",
      checkFreshness: async (o) => {
        const e = typeof o.entry === "function" ? await o.entry() : o.entry;
        checks.push({
          language: o.language,
          reason: o.reason,
          entry: e?.language,
        });
        expect(o.compat).toBe(CURRENT_PACK_COMPAT);
      },
    });
    expect(checks).toEqual([
      { language: "fr", reason: "daily", entry: "es-419" },
      { language: "pt-br", reason: "daily", entry: "es-419" },
      { language: "sw", reason: "daily", entry: "es-419" },
    ]);
    expect(lists.every((l) => l.prefix === `catalog/${COMPAT}/`)).toBe(true);
    expect(lists.length).toBeGreaterThan(1);
  });

  it("goes through the real check, so the hourly throttle and the build guard apply", async () => {
    const { bucket } = catalogBucket([`catalog/${COMPAT}/fr.json`]);
    const { kv, values } = fakeKv();
    values.set(`packs:fresh:${COMPAT}:fr`, NOW.toISOString());
    const builds: string[] = [];
    await runDailyBuilds(
      { TRANSLATION_HELPS_CACHE: kv, LANGUAGE_PACKS: bucket },
      {} as ExecutionContext,
      {
        now: new Date(NOW.getTime() + 10 * MINUTE),
        requestBuild: async (o) => {
          builds.push(o.language);
          return "dispatched";
        },
      },
    );
    // fr was checked ten minutes ago: the sweep leaves it alone.
    expect(builds).toEqual(["es-419", "en"]);
  });
});
