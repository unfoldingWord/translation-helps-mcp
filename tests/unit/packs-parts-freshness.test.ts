/**
 * A parts list follows what it was built from: a list hit checks, at most once an hour per language, whether a stamp
 * of anything the build read moved (a release, a lexicon or MACULA commit) or whether master builds another code, and
 * asks for a parts build when one did. Every reason has a breaker: an `ok` build that already saw the change.
 */

import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  builtStamps,
  changedSources,
  comparedStamps,
  checkPartsFreshness,
  firstSeenKey,
  readPartsBuilder,
  type PartsListLite,
} from "../../src/packs/partsFreshness";
import {
  CURRENT_PACK_COMPAT,
  CURRENT_PARTS_COMPAT,
  type BuildOutcome,
} from "../../src/packs/dispatch";
import type { FreshnessEnv } from "../../src/packs/freshness";
import type { Observed } from "../../src/packs/partsSources";

const COMPAT = CURRENT_PARTS_COMPAT;
const OLD_PARTS_COMPAT = "f2.0-u2.3.0-p6000229-q9-a12-t1";
const LANG = "es-419";
const NOW = new Date("2026-10-21T10:00:00Z");
const MINUTE = 60_000;
/** tc-study `packs-status --print-code` today. */
const CODE = `${COMPAT}+7bc31e739fbeed69`;
const NEW_CODE = `${COMPAT}+0123456789abcdef`;
const GLT = "test_gl/es-419/glt";
const TN = "test_gl/es-419/tn";
const UHL = "test_gl/es-419/uhl";
const UHB = "unfoldingWord/hbo/uhb";
const ORIGINALS_SHA = "e".repeat(64);
const ORIGINALS_PATH = `catalog/${COMPAT}/originals/${ORIGINALS_SHA}.json`;

// The strings tc-study's fixture list records (buildLanguageParts.test.ts "the stamps in the list").
const STAMPS: Record<string, string> = {
  [GLT]: "v12#2026-09-01T00_00_00Z",
  [TN]: "v12#2026-09-01T00_00_00Z",
  [UHB]: "v2.1.30#2026-09-01T00_00_00Z",
  [UHL]: "0123456789#2026-07-01T00_00_00Z",
  "Biblica/hbo/macula": "abc1234567#2026-08-01T00_00_00.000Z",
  "Biblica/el-x-koine/macula": "abc1234567#2026-08-01T00_00_00.000Z",
};

function list(o: Partial<PartsListLite> = {}): PartsListLite {
  return {
    schema: 2,
    language: LANG,
    compat: COMPAT,
    code: CODE,
    resources: [
      { key: GLT, stamp: STAMPS[GLT]!, role: "text" },
      { key: TN, stamp: STAMPS[TN]!, role: "helps" },
    ],
    originals: { path: ORIGINALS_PATH, sha256: ORIGINALS_SHA },
    stamps: { ...STAMPS },
    ...o,
  };
}

const BUILDER = {
  compat: COMPAT,
  code: CODE,
  commit: "4863174" + "0".repeat(33),
  at: "2026-10-20T00:00:00Z",
};

function fakeKv() {
  const values = new Map<string, string>();
  const puts: string[] = [];
  const ttls = new Map<string, number | undefined>();
  /** Every get call: a key, or the keys of one bulk read. */
  const gets: Array<string | string[]> = [];
  let bulkFails = false;
  const kv = {
    async get(key: string | string[]) {
      gets.push(key);
      if (Array.isArray(key)) {
        if (bulkFails) throw new Error("KV bulk read failed");
        return new Map(key.map((k) => [k, values.get(k) ?? null]));
      }
      return values.get(key) ?? null;
    },
    async put(key: string, value: string, o?: { expirationTtl?: number }) {
      values.set(key, value);
      puts.push(key);
      ttls.set(key, o?.expirationTtl);
    },
  };
  return {
    kv: kv as unknown as KVNamespace,
    values,
    puts,
    ttls,
    gets,
    failBulkReads: () => void (bulkFails = true),
  };
}

/** When the Worker first saw `stamp` for `key`, as an earlier check would have recorded it. */
type FirstSeen = Array<[key: string, stamp: string, at: string]>;

function setup(
  o: {
    observed?: Observed;
    builder?: unknown;
    status?: unknown;
    objects?: Record<string, unknown>;
    partsDispatch?: string;
    observeThrows?: boolean;
    analyticsThrows?: boolean;
    firstSeen?: FirstSeen;
  } = {},
) {
  const { kv, puts, values, ttls, gets: kvGets, failBulkReads } = fakeKv();
  const seed = (async () => {
    for (const [key, stamp, at] of o.firstSeen ?? []) {
      values.set(await firstSeenKey(key, stamp), at);
    }
  })();
  const objects: Record<string, unknown> = {
    ...(o.builder === undefined ? {} : { "status/builder.json": o.builder }),
    ...(o.status === undefined
      ? {}
      : { [`status/${COMPAT}/${LANG}.json`]: o.status }),
    ...o.objects,
  };
  const gets: string[] = [];
  const bucket = {
    async get(key: string) {
      gets.push(key);
      if (!(key in objects)) return null;
      const raw = objects[key];
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      return {
        text: async () => text,
        json: async () => JSON.parse(text),
        body: new Response(text).body,
      };
    },
  } as unknown as R2Bucket;
  const points: string[][] = [];
  const env: FreshnessEnv = {
    TRANSLATION_HELPS_CACHE: kv,
    LANGUAGE_PACKS: bucket,
    PACKS_PARTS_DISPATCH: o.partsDispatch ?? "on",
    ANALYTICS: {
      writeDataPoint: (p: { blobs?: string[] }) => {
        if (o.analyticsThrows) throw new Error("analytics down");
        points.push(p.blobs ?? []);
      },
    } as unknown as AnalyticsEngineDataset,
  };
  const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
  const observations: string[] = [];
  const builds: Array<{ compat: string; language: string; reason: string }> =
    [];
  const budget = vi.fn(async () => true);
  const check = async (
    c: {
      list?: PartsListLite | null;
      now?: Date;
      compat?: string;
      reason?: "stale" | "daily";
      codeBudget?: () => Promise<boolean>;
      noBudget?: boolean;
    } = {},
  ) => {
    await seed;
    return checkPartsFreshness({
      env,
      ctx,
      compat: c.compat ?? COMPAT,
      language: LANG,
      list: async () => (c.list === undefined ? list() : c.list),
      now: c.now ?? NOW,
      reason: c.reason,
      ...(c.noBudget ? {} : { codeBudget: c.codeBudget ?? budget }),
      observe: async ({ language }) => {
        observations.push(language);
        if (o.observeThrows) throw new Error("boom");
        return o.observed ?? { stamps: { ...STAMPS } };
      },
      requestBuild: async (r): Promise<BuildOutcome> => {
        builds.push({
          compat: r.compat,
          language: r.language,
          reason: r.reason,
        });
        return "dispatched";
      },
    });
  };
  return {
    check,
    builds,
    observations,
    points,
    puts,
    gets,
    budget,
    values,
    ttls,
    kvGets,
    failBulkReads,
  };
}

const moved = (changes: Record<string, string>): Observed => ({
  stamps: { ...STAMPS, ...changes },
});

describe("changedSources and builtStamps", () => {
  it("lists keys whose stamp moved and keys only now there; keys only built are ignored (Decision 13)", () => {
    expect(
      changedSources(
        { a: "1", b: "2", gone: "3" },
        { a: "1", b: "2b", fresh: "4" },
      ),
    ).toEqual([
      { key: "b", built: "2", current: "2b" },
      { key: "fresh", current: "4" },
    ]);
    expect(changedSources(STAMPS, { ...STAMPS })).toEqual([]);
  });

  it("takes the list's stamps when it has them, else its resources and the originals list's", () => {
    expect(builtStamps(list(), null)).toEqual(STAMPS);
    const originals = list({
      language: "originals",
      resources: [{ key: UHB, stamp: STAMPS[UHB]!, role: "original" }],
      stamps: undefined,
    });
    expect(builtStamps(list({ stamps: undefined }), originals)).toEqual({
      [GLT]: STAMPS[GLT],
      [TN]: STAMPS[TN],
      [UHB]: STAMPS[UHB],
    });
    expect(builtStamps(list({ stamps: undefined }), null)).toEqual({
      [GLT]: STAMPS[GLT],
      [TN]: STAMPS[TN],
    });
  });
});

describe("comparedStamps", () => {
  it("keeps every observed key but a MACULA key the list does not have", () => {
    const built = { [GLT]: "a", "Biblica/el-x-koine/macula": "m" };
    expect(
      comparedStamps(built, {
        [GLT]: "a",
        [TN]: "new",
        "Biblica/hbo/macula": "m2",
        "Biblica/el-x-koine/macula": "m2",
      }),
    ).toEqual({ [GLT]: "a", [TN]: "new", "Biblica/el-x-koine/macula": "m2" });
  });
});

describe("readPartsBuilder", () => {
  it("reads status/builder.json, and takes anything malformed as no file", async () => {
    for (const [raw, expected] of [
      [BUILDER, BUILDER],
      ["not json", null],
      [{ ...BUILDER, code: 7 }, null],
      [{ compat: COMPAT }, null],
      [null, null],
    ] as const) {
      const bucket = {
        get: async () =>
          raw === null
            ? null
            : {
                text: async () =>
                  typeof raw === "string" ? raw : JSON.stringify(raw),
              },
      } as unknown as R2Bucket;
      expect(await readPartsBuilder(bucket), JSON.stringify(raw)).toEqual(
        expected,
      );
    }
  });
});

describe("checkPartsFreshness", () => {
  it("every stamp equal and the same code: fresh, with no build", async () => {
    const s = setup({ builder: BUILDER });
    expect(await s.check()).toBe("fresh");
    expect(s.builds).toEqual([]);
    expect(s.points).toEqual([["pack", "freshness", LANG, "parts-fresh"]]);
  });

  it("the GLT's tag moved: a stale build of the parts compat", async () => {
    const s = setup({
      builder: BUILDER,
      observed: moved({ [GLT]: "v13#2026-10-20T09_00_00Z" }),
    });
    expect(await s.check()).toBe("dispatched");
    expect(s.builds).toEqual([
      { compat: COMPAT, language: LANG, reason: "stale" },
    ]);
    expect(s.points).toEqual([["pack", "freshness", LANG, "parts-dispatched"]]);
  });

  it("a new TN row is a build; a key only in the list is not", async () => {
    const withoutTn = { ...STAMPS };
    delete withoutTn[TN];
    const s = setup();
    expect(await s.check({ list: list({ stamps: withoutTn }) })).toBe(
      "dispatched",
    );

    const gone = setup({ observed: { stamps: withoutTn } });
    expect(await gone.check()).toBe("fresh");
    expect(gone.builds).toEqual([]);
  });

  it("a lexicon commit moved is a build, and so is a MACULA commit", async () => {
    const lexicon = setup({
      observed: moved({ [UHL]: "fedcba9876#2026-10-19T19_52_42-04_00" }),
    });
    expect(await lexicon.check()).toBe("dispatched");
    const macula = setup({
      observed: moved({
        "Biblica/hbo/macula": "f1e2d3c4b5#2026-10-20T00_00_00.000Z",
        "Biblica/el-x-koine/macula": "f1e2d3c4b5#2026-10-20T00_00_00.000Z",
      }),
    });
    expect(await macula.check()).toBe("dispatched");
  });

  it("a MACULA key is compared only when the list has it: the build stamps one only when MACULA has files for it", async () => {
    const greekOnly = { ...STAMPS };
    delete greekOnly["Biblica/hbo/macula"];
    const maculaMoved = moved({
      "Biblica/hbo/macula": "f1e2d3c4b5#2026-10-20T00_00_00.000Z",
      "Biblica/el-x-koine/macula": "f1e2d3c4b5#2026-10-20T00_00_00.000Z",
    });
    // The Hebrew key the list lacks is not new to it; the Greek one it has moved.
    const s = setup({ observed: maculaMoved });
    expect(await s.check({ list: list({ stamps: greekOnly }) })).toBe(
      "dispatched",
    );
    const none = { ...greekOnly };
    delete none["Biblica/el-x-koine/macula"];
    const fresh = setup({ observed: maculaMoved });
    expect(await fresh.check({ list: list({ stamps: none }) })).toBe("fresh");
    expect(fresh.builds).toEqual([]);
  });

  it("the builder's code differs: a build with reason code from a phone", async () => {
    const s = setup({ builder: { ...BUILDER, code: NEW_CODE } });
    expect(await s.check()).toBe("dispatched");
    expect(s.builds).toEqual([
      { compat: COMPAT, language: LANG, reason: "code" },
    ]);
    expect(s.budget).not.toHaveBeenCalled();
  });

  it("a code change on the daily path needs the code budget", async () => {
    const spent = setup({ builder: { ...BUILDER, code: NEW_CODE } });
    expect(
      await spent.check({ reason: "daily", codeBudget: async () => false }),
    ).toBe("budget");
    expect(spent.builds).toEqual([]);
    expect(spent.points).toEqual([["pack", "freshness", LANG, "parts-budget"]]);

    const left = setup({ builder: { ...BUILDER, code: NEW_CODE } });
    expect(await left.check({ reason: "daily" })).toBe("dispatched");
    expect(left.budget).toHaveBeenCalledTimes(1);
    expect(left.builds).toEqual([
      { compat: COMPAT, language: LANG, reason: "daily" },
    ]);

    // Without a budget to ask, the sweep rebuilds no code.
    const none = setup({ builder: { ...BUILDER, code: NEW_CODE } });
    expect(await none.check({ reason: "daily", noBudget: true })).toBe(
      "budget",
    );
  });

  it("a moved stamp on the daily path asks no budget", async () => {
    const s = setup({
      builder: { ...BUILDER, code: NEW_CODE },
      observed: moved({ [GLT]: "v13#2026-10-20T09_00_00Z" }),
    });
    expect(
      await s.check({ reason: "daily", codeBudget: async () => false }),
    ).toBe("dispatched");
    expect(s.builds).toEqual([
      { compat: COMPAT, language: LANG, reason: "daily" },
    ]);
  });

  it("builder.compat differs: no code build, and compat-drift is logged", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const s = setup({
      builder: {
        ...BUILDER,
        compat: "f2.1-u2.3.0-p6000230-q9-a12-t1",
        code: "f2.1-u2.3.0-p6000230-q9-a12-t1+00",
      },
    });
    expect(await s.check()).toBe("fresh");
    expect(s.builds).toEqual([]);
    expect(
      log.mock.calls.some((c) => String(c[0]).includes("compat-drift")),
    ).toBe(true);
    expect(s.points).toContainEqual([
      "pack",
      "freshness",
      LANG,
      "parts-compat-drift",
    ]);
    log.mockRestore();
  });

  it("no builder file: no code check", async () => {
    const s = setup();
    expect(await s.check({ list: list({ code: "anything" }) })).toBe("fresh");
    expect(s.builds).toEqual([]);
  });

  describe("the breaker: an ok build that already saw the change", () => {
    const glt = moved({ [GLT]: "v13#2026-10-20T09_00_00Z" });
    /**
     * These cases read the date in the stamp, so the Worker is taken to have first seen each change long before it
     * (as for a stamp dated ahead of when it appeared): the later of the two is what counts.
     */
    const EARLY = "2026-09-01T00:00:00Z";
    const seenEarly = (observed: Observed): FirstSeen =>
      "stamps" in observed
        ? Object.entries(observed.stamps)
            .filter(([key, stamp]) => STAMPS[key] !== stamp)
            .map(([key, stamp]) => [key, stamp, EARLY])
        : [];
    const ok = (started: string, extra: Record<string, unknown> = {}) => ({
      state: "ok",
      at: "2026-10-20T12:00:00Z",
      failures: 0,
      run: "123",
      started,
      ...extra,
    });
    const at = (observed: Observed, status: unknown) =>
      setup({ observed, status, firstSeen: seenEarly(observed) });

    it("an ok build started after the newest change: seen, with no build", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const s = at(glt, ok("2026-10-20T10:00:00Z"));
      expect(await s.check()).toBe("seen");
      expect(s.builds).toEqual([]);
      expect(s.points).toEqual([
        ["pack", "freshness", LANG, "parts-stale-seen"],
      ]);
      log.mockRestore();
    });

    it("one started before it: a build", async () => {
      const s = at(glt, ok("2026-10-20T08:00:00Z"));
      expect(await s.check()).toBe("dispatched");
    });

    it("a failed status, however recent: a build (the guard then cools it)", async () => {
      const s = at(glt, { ...ok("2026-10-21T09:00:00Z"), state: "failed" });
      expect(await s.check()).toBe("dispatched");
    });

    it("the newest change is the newest date among them", async () => {
      const both = moved({
        [GLT]: "v13#2026-10-20T09_00_00Z",
        [TN]: "v13#2026-10-21T08_00_00Z",
      });
      const s = at(both, ok("2026-10-20T10:00:00Z"));
      expect(await s.check()).toBe("dispatched");
    });

    it("a lexicon date's offset is read back from the stamp (…T19_52_42-04_00 is 23:52:42 UTC)", async () => {
      const lexicon = moved({ [UHL]: "fedcba9876#2026-10-19T19_52_42-04_00" });
      expect(await at(lexicon, ok("2026-10-19T23:00:00Z")).check()).toBe(
        "dispatched",
      );
      expect(await at(lexicon, ok("2026-10-19T23:55:00Z")).check()).toBe(
        "seen",
      );
    });

    it("MACULA's toISOString date is read back too", async () => {
      const macula = moved({
        "Biblica/hbo/macula": "f1e2d3c4b5#2026-10-20T00_00_00.000Z",
      });
      expect(await at(macula, ok("2026-10-19T23:59:00Z")).check()).toBe(
        "dispatched",
      );
      expect(await at(macula, ok("2026-10-20T00:01:00Z")).check()).toBe("seen");
    });

    it("a change with no date is seen only by an ok build that started after the Worker first saw it", async () => {
      const undated = moved({ [GLT]: "v13" });
      const firstSeen: FirstSeen = [[GLT, "v13", "2026-10-20T12:00:00Z"]];
      expect(
        await setup({
          observed: undated,
          status: ok("2026-10-20T10:00:00Z"),
          firstSeen,
        }).check(),
      ).toBe("dispatched");
      expect(
        await setup({
          observed: undated,
          status: ok("2026-10-20T13:00:00Z"),
          firstSeen,
        }).check(),
      ).toBe("seen");
      // Seen for the first time now: no build so far can have read it.
      expect(
        await setup({
          observed: undated,
          status: ok("2026-10-21T09:59:00Z"),
        }).check(),
      ).toBe("dispatched");
    });

    it("a code change is seen only by an ok run of that code, whenever it started", async () => {
      const builder = { ...BUILDER, code: NEW_CODE };
      // A run that started after the push but built the old code (queued before it, a re-run): not seen.
      const old = setup({
        builder,
        status: ok("2026-10-21T09:00:00Z", { code: CODE }),
      });
      expect(await old.check()).toBe("dispatched");
      expect(old.builds[0]?.reason).toBe("code");
      // A status written before tc-study recorded the code: not seen either, so one build, then the breaker.
      const unrecorded = setup({ builder, status: ok("2026-10-21T09:00:00Z") });
      expect(await unrecorded.check()).toBe("dispatched");
      const same = setup({
        builder,
        status: ok("2026-10-20T00:00:00Z", { code: NEW_CODE }),
      });
      expect(await same.check()).toBe("seen");
      expect(same.builds).toEqual([]);
    });

    it("a seen release and an unseen code: a code rebuild, budgeted on the daily path", async () => {
      const o = {
        builder: { ...BUILDER, code: NEW_CODE },
        observed: glt,
        status: ok("2026-10-20T10:00:00Z", { code: CODE }),
        firstSeen: seenEarly(glt),
      };
      const s = setup(o);
      expect(await s.check()).toBe("dispatched");
      expect(s.builds[0]?.reason).toBe("code");
      const daily = setup(o);
      expect(
        await daily.check({ reason: "daily", codeBudget: async () => false }),
      ).toBe("budget");
    });
  });

  describe("a change is dated no earlier than when the Worker first saw it", () => {
    // Taller: a MACULA commit made on a branch on Monday, merged into the default branch on Thursday. GitHub dates it
    // Monday, but no build could read it before Thursday.
    const MONDAY_STAMP = "f1e2d3c4b5#2026-10-19T09_00_00.000Z";
    const merged = moved({
      "Biblica/hbo/macula": MONDAY_STAMP,
      "Biblica/el-x-koine/macula": MONDAY_STAMP,
    });
    const WEDNESDAY = "2026-10-21T10:00:00Z";
    const THURSDAY_CHECK = new Date("2026-10-22T16:00:00Z");
    const FRIDAY_CHECK = new Date("2026-10-23T09:00:00Z");
    const ok = (started: string) => ({
      state: "ok",
      at: started,
      failures: 0,
      run: "1",
      started,
    });

    it("a build on Wednesday did not see Monday's commit merged on Thursday; one after Thursday's check did", async () => {
      // Thursday: the merge is seen; Wednesday's build started after the commit's date but before the merge.
      const thursday = setup({ observed: merged, status: ok(WEDNESDAY) });
      expect(await thursday.check({ now: THURSDAY_CHECK })).toBe("dispatched");
      const recorded = await firstSeenKey("Biblica/hbo/macula", MONDAY_STAMP);
      expect(thursday.values.get(recorded)).toBe(THURSDAY_CHECK.toISOString());

      // Friday, the list still disagrees: the build Thursday's check asked for, started after it, saw the commit.
      const firstSeen: FirstSeen = [
        ["Biblica/hbo/macula", MONDAY_STAMP, THURSDAY_CHECK.toISOString()],
        [
          "Biblica/el-x-koine/macula",
          MONDAY_STAMP,
          THURSDAY_CHECK.toISOString(),
        ],
      ];
      const after = setup({
        observed: merged,
        status: ok("2026-10-22T16:05:00Z"),
        firstSeen,
      });
      expect(await after.check({ now: FRIDAY_CHECK })).toBe("seen");
      expect(after.builds).toEqual([]);

      // A build that started after the merge but before the Worker saw it may have read it; it is not taken as
      // having done so (one build more, never one less).
      const between = setup({
        observed: merged,
        status: ok("2026-10-22T15:30:00Z"),
        firstSeen,
      });
      expect(await between.check({ now: FRIDAY_CHECK })).toBe("dispatched");
    });

    it("the first time is written once, for 400 days, under a hash of the key and the stamp", async () => {
      const s = setup({ observed: merged, status: ok(WEDNESDAY) });
      await s.check({ now: THURSDAY_CHECK });
      const hash = createHash("sha256")
        .update(`Biblica/hbo/macula|${MONDAY_STAMP}`)
        .digest("hex")
        .slice(0, 32);
      expect(await firstSeenKey("Biblica/hbo/macula", MONDAY_STAMP)).toBe(
        `packs:first-seen:${hash}`,
      );
      const firstSeenPuts = s.puts.filter((k) =>
        k.startsWith("packs:first-seen:"),
      );
      expect(firstSeenPuts).toHaveLength(2);
      expect(s.ttls.get(`packs:first-seen:${hash}`)).toBe(400 * 24 * 3600);

      // A later check finds it and writes nothing over it.
      const later = new Date(THURSDAY_CHECK.getTime() + 61 * MINUTE);
      await s.check({ now: later });
      expect(
        s.puts.filter((k) => k.startsWith("packs:first-seen:")),
      ).toHaveLength(2);
      expect(s.values.get(`packs:first-seen:${hash}`)).toBe(
        THURSDAY_CHECK.toISOString(),
      );
    });

    it("one bulk KV read a check, and none when nothing changed", async () => {
      const s = setup({ observed: merged });
      await s.check();
      const reads = s.kvGets.filter((g) => Array.isArray(g));
      expect(reads).toEqual([
        [
          await firstSeenKey("Biblica/el-x-koine/macula", MONDAY_STAMP),
          await firstSeenKey("Biblica/hbo/macula", MONDAY_STAMP),
        ],
      ]);
      const fresh = setup();
      expect(await fresh.check()).toBe("fresh");
      expect(fresh.kvGets.filter((g) => Array.isArray(g))).toEqual([]);
      expect(fresh.puts).toEqual([`packs:fresh:${COMPAT}:${LANG}`]);
    });

    it("a bulk KV read that fails: first seen now, and nothing written over what may be there", async () => {
      // Recorded Tuesday, so the build started Thursday 15:59 would have seen it, but the record cannot be read.
      const s = setup({
        observed: merged,
        status: ok("2026-10-22T15:59:00Z"),
        firstSeen: [
          ["Biblica/hbo/macula", MONDAY_STAMP, "2026-10-20T00:00:00Z"],
          ["Biblica/el-x-koine/macula", MONDAY_STAMP, "2026-10-20T00:00:00Z"],
        ],
      });
      s.failBulkReads();
      expect(await s.check({ now: THURSDAY_CHECK })).toBe("dispatched");
      expect(s.puts.filter((k) => k.startsWith("packs:first-seen:"))).toEqual(
        [],
      );
    });
  });

  it("an unknown observation: unknown, with no build", async () => {
    const s = setup({ observed: { unknown: "Door43 answered 502" } });
    expect(await s.check()).toBe("unknown");
    expect(s.builds).toEqual([]);
    expect(s.points).toEqual([["pack", "freshness", LANG, "parts-unknown"]]);
  });

  it("an input left out as unreadable is not compared, and the log names it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stamps = { ...STAMPS };
    delete stamps["Biblica/hbo/macula"];
    delete stamps["Biblica/el-x-koine/macula"];
    const s = setup({
      observed: {
        stamps,
        unreadable: ["MACULA: GitHub answered 403 for public/trees"],
      },
    });
    expect(await s.check()).toBe("fresh");
    expect(s.builds).toEqual([]);
    expect(log.mock.calls.map((c) => String(c[0]))).toContainEqual(
      `[packs] parts ${COMPAT}/${LANG}: fresh; not compared, unreadable: MACULA: GitHub answered 403 for public/trees`,
    );
    // The inputs that were read still ask for a build.
    const moved = setup({
      observed: {
        stamps: { ...stamps, [GLT]: "v13#2026-10-20T09_00_00Z" },
        unreadable: ["MACULA: GitHub answered 403 for public/trees"],
      },
    });
    expect(await moved.check()).toBe("dispatched");
    log.mockRestore();
  });

  it("an old parts compat, or f1.1: nothing at all, not even the hour claimed", async () => {
    for (const compat of [OLD_PARTS_COMPAT, CURRENT_PACK_COMPAT]) {
      const s = setup();
      expect(await s.check({ compat })).toBe("not-current");
      expect(s.puts).toEqual([]);
      expect(s.observations).toEqual([]);
      expect(s.gets).toEqual([]);
    }
  });

  it("with parts dispatch off: nothing observed and no hour claimed", async () => {
    const s = setup({
      partsDispatch: "off",
      observed: moved({ [GLT]: "v13#2026-10-20T09_00_00Z" }),
    });
    expect(await s.check()).toBe("parts-off");
    expect(s.puts).toEqual([]);
    expect(s.observations).toEqual([]);
  });

  it("runs at most once an hour per language", async () => {
    const s = setup({ observed: moved({ [GLT]: "v13#2026-10-20T09_00_00Z" }) });
    expect(await s.check()).toBe("dispatched");
    expect(await s.check({ now: new Date(NOW.getTime() + 59 * MINUTE) })).toBe(
      "throttled",
    );
    expect(s.observations).toEqual([LANG]);
    expect(s.puts.filter((k) => k.startsWith("packs:fresh:"))).toEqual([
      `packs:fresh:${COMPAT}:${LANG}`,
    ]);
    expect(await s.check({ now: new Date(NOW.getTime() + 61 * MINUTE) })).toBe(
      "dispatched",
    );
  });

  it("no list: no-list, and nothing observed", async () => {
    const s = setup();
    expect(await s.check({ list: null })).toBe("no-list");
    expect(s.observations).toEqual([]);
  });

  describe("a list published before tc-study recorded its stamps", () => {
    // Door43 has the list's own resources and UHB, nothing else, so only UHB tells whether the originals were read.
    const observed: Observed = {
      stamps: { [GLT]: STAMPS[GLT]!, [TN]: STAMPS[TN]!, [UHB]: STAMPS[UHB]! },
    };
    const originalsWith = (stamp: string) =>
      list({
        language: "originals",
        resources: [{ key: UHB, stamp, role: "original" }],
        stamps: undefined,
        originals: undefined,
      });

    it("reads its originals list at the content-addressed path the list names", async () => {
      const same = setup({
        observed,
        objects: { [ORIGINALS_PATH]: originalsWith(STAMPS[UHB]!) },
      });
      expect(await same.check({ list: list({ stamps: undefined }) })).toBe(
        "fresh",
      );
      expect(same.gets).toContain(ORIGINALS_PATH);

      const older = setup({
        observed,
        objects: {
          [ORIGINALS_PATH]: originalsWith("v2.1.29#2026-01-01T00_00_00Z"),
        },
      });
      expect(await older.check({ list: list({ stamps: undefined }) })).toBe(
        "dispatched",
      );
    });

    it("reads no other path: then UHB is new to it, and only the list's own resources were built", async () => {
      const elsewhere = `catalog/${COMPAT}/originals.json`;
      const oldCompat = `catalog/${OLD_PARTS_COMPAT}/originals/${ORIGINALS_SHA}.json`;
      const current = originalsWith(STAMPS[UHB]!);
      const objects = {
        [elsewhere]: current,
        [oldCompat]: current,
        [ORIGINALS_PATH]: current,
      };
      for (const originals of [
        { path: elsewhere, sha256: ORIGINALS_SHA },
        { path: oldCompat, sha256: ORIGINALS_SHA },
        // The path of another sha than the one the list names.
        { path: ORIGINALS_PATH, sha256: "f".repeat(64) },
        { path: "../" + ORIGINALS_PATH, sha256: ORIGINALS_SHA },
      ]) {
        const s = setup({ observed, objects });
        expect(
          await s.check({ list: list({ stamps: undefined, originals }) }),
          originals.path,
        ).toBe("dispatched");
        expect(s.gets.filter((k) => k.includes("originals"))).toEqual([]);
      }
    });
  });

  it("never throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup({ observeThrows: true });
    expect(await s.check()).toBe("error");
    err.mockRestore();
  });

  it("a crash logs `freshness unknown:` and writes the `parts-error` point, as every other result writes its own", async () => {
    const errors: unknown[][] = [];
    const err = vi
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void errors.push(a));
    const s = setup({ observeThrows: true });
    expect(await s.check()).toBe("error");
    err.mockRestore();
    expect(s.points).toEqual([["pack", "freshness", LANG, "parts-error"]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]![0]).toBe(
      `[packs] parts ${COMPAT}/${LANG}: freshness unknown:`,
    );
  });

  it("a failing Analytics write neither throws nor changes a result, on a crash or not", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const crashed = setup({ observeThrows: true, analyticsThrows: true });
    expect(await crashed.check()).toBe("error");
    const fresh = setup({ builder: BUILDER, analyticsThrows: true });
    expect(await fresh.check()).toBe("fresh");
    const stale = setup({
      builder: BUILDER,
      observed: moved({ [GLT]: "v13#2026-10-20T09_00_00Z" }),
      analyticsThrows: true,
    });
    expect(await stale.check()).toBe("dispatched");
    expect(stale.builds).toHaveLength(1);
    expect(err.mock.calls.map((c) => String(c[0]))).toContain(
      `[packs] parts ${LANG}: analytics point not written:`,
    );
    err.mockRestore();
  });
});
