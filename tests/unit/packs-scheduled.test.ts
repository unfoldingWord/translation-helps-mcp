/**
 * The packs crons, one job per cron string: the f1.1 sweep at 06:17 UTC exactly as the daily cron ran it, the parts
 * languages in hourly slices (each once a day), code-only rebuilds within their daily budget, and the cleanup at 03:07
 * UTC when it is on, retried at 04:07 and 05:07 only when the day's was postponed or aborted.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CLEANUP_CRON,
  CLEANUP_RETRY_CRON,
  CODE_REBUILDS_PER_DAY,
  F11_SWEEP_CRON,
  PACKS_CRONS,
  PARTS_CHECKS_PER_RUN,
  PARTS_SLICE_CRON,
  checksPerRun,
  cleanupMode,
  fnv1a32,
  partsHourOf,
  runScheduled,
  type ScheduledDeps,
  type ScheduledEnv,
} from "../../src/packs/scheduled";
import { runDailySweep } from "../../src/packs/freshness";
import {
  CURRENT_PACK_COMPAT,
  CURRENT_PARTS_COMPAT,
  type BuildOutcome,
} from "../../src/packs/dispatch";
import type { PartsCheck, PartsListLite } from "../../src/packs/partsFreshness";
import { ALERT_TAG, LEDGER } from "../../src/packs/cleanup";
import { fakeKv, fakeR2 } from "./fakeR2";

const F11 = CURRENT_PACK_COMPAT;
const PARTS = CURRENT_PARTS_COMPAT;
const OLD_PARTS = "f2.0-u2.3.0-p6000229-q9-a12-t1";
const DAY = "2026-10-21";
const at = (hour: number, minute = 17, day = DAY) =>
  new Date(
    `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  );
const SHA = "a".repeat(64);
const CODE = `${PARTS}+7bc31e739fbeed69`;
const NEW_CODE = `${PARTS}+0123456789abcdef`;
const F11_CRON = F11_SWEEP_CRON;
const SLICE = PARTS_SLICE_CRON;

/** Two-letter codes whose slice is `hour`, in a stable order. */
function languagesOfHour(hour: number, n: number): string[] {
  const out: string[] = [];
  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (const x of letters) {
    for (const y of letters) {
      if (out.length < n && partsHourOf(x + y) === hour) out.push(x + y);
    }
  }
  return out;
}

function partsList(language: string, code = CODE): string {
  const list: PartsListLite = {
    schema: 2,
    language,
    compat: PARTS,
    code,
    resources: [],
    originals: {
      path: `catalog/${PARTS}/originals/${SHA}.json`,
      sha256: SHA,
    },
    stamps: { "x/y/z": "v1#2026-01-01T00_00_00Z" },
  };
  return JSON.stringify(list);
}

function setup(
  o: {
    f11?: string[];
    parts?: string[];
    extra?: Record<string, string>;
    env?: Partial<ScheduledEnv>;
  } = {},
) {
  const r2 = fakeR2({
    ...Object.fromEntries(
      (o.f11 ?? []).map((l) => [`catalog/${F11}/${l}.json`, "{}"]),
    ),
    ...Object.fromEntries(
      (o.parts ?? []).map((l) => [`catalog/${PARTS}/${l}.json`, partsList(l)]),
    ),
    ...o.extra,
  });
  const { kv, values } = fakeKv();
  const env: ScheduledEnv = {
    TRANSLATION_HELPS_CACHE: kv,
    LANGUAGE_PACKS: r2.bucket,
    PACKS_PARTS_DISPATCH: "on",
    ...o.env,
  };
  const f11: Array<{ language: string; reason?: string; compat: string }> = [];
  const parts: Array<{
    language: string;
    reason?: string;
    list: PartsListLite | null;
    hasBudget: boolean;
  }> = [];
  const cleanups: Array<{ mode: string; day: string }> = [];
  const order: string[] = [];
  const deps: ScheduledDeps = {
    checkFreshness: async (c) => {
      order.push(`f11 ${c.language}`);
      f11.push({ language: c.language, reason: c.reason, compat: c.compat });
    },
    checkPartsFreshness: async (c): Promise<PartsCheck> => {
      order.push(`parts ${c.language}`);
      parts.push({
        language: c.language,
        reason: c.reason,
        list: await c.list(),
        hasBudget: typeof c.codeBudget === "function",
      });
      return "fresh";
    },
    cleanup: async (_env, c) => {
      order.push(`cleanup ${c.mode}`);
      cleanups.push({ mode: c.mode, day: c.day });
    },
  };
  /** One invocation of `cron`, scheduled at `when`. */
  const run = (cron: string, when: Date, more: ScheduledDeps = {}) =>
    runScheduled(env, {} as ExecutionContext, {
      ...deps,
      cron,
      scheduledTime: when.getTime(),
      now: when,
      ...more,
    });
  return { r2, env, kv, values, f11, parts, cleanups, order, run };
}

describe("fnv1a32 and the hour slices", () => {
  it("is the standard 32-bit FNV-1a, as tc-study's partSlots.test.ts pins it", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("puts es-419 and en in their hours (Task 12 Step 7 waits for these)", () => {
    expect(partsHourOf("es-419")).toBe(22);
    expect(partsHourOf("en")).toBe(18);
  });
});

describe("runScheduled: the f1.1 sweep", () => {
  const F11_LANGS = ["en", "es-419", "fr", "pt-br", "sw"];

  it("the f1.1 cron runs the f1.1 sweep exactly as the daily cron did: same checks, same listing", async () => {
    const extra = { [`catalog/${F11}/originals.json`]: "{}" };
    const s = setup({
      f11: F11_LANGS,
      extra,
      env: { PACKS_PARTS_DISPATCH: undefined },
    });
    await s.run(F11_CRON, at(6));

    // The old daily cron, run by itself over the same bucket.
    const old = setup({
      f11: F11_LANGS,
      extra,
      env: { PACKS_PARTS_DISPATCH: undefined },
    });
    const oldChecks: typeof old.f11 = [];
    await runDailySweep(old.env, {} as ExecutionContext, {
      now: at(6),
      checkFreshness: async (c) => {
        oldChecks.push({
          language: c.language,
          reason: c.reason,
          compat: c.compat,
        });
      },
    });

    expect(s.f11).toEqual(oldChecks);
    expect(s.f11).toEqual(
      F11_LANGS.map((language) => ({ language, reason: "daily", compat: F11 })),
    );
    // Listed as before: no delimiter for f1.1, and nothing else touched when parts dispatch is off.
    expect(s.r2.ops).toEqual(old.r2.ops);
    expect(s.r2.ops.filter((op) => op.op === "list").map((op) => op.o)).toEqual(
      [{ prefix: `catalog/${F11}/`, cursor: undefined }],
    );
  });

  it("passes the clock it was given to the f1.1 checks (none in production, as before)", async () => {
    const s = setup({ f11: ["fr"] });
    const nows: Array<Date | undefined> = [];
    await runScheduled(s.env, {} as ExecutionContext, {
      cron: F11_CRON,
      scheduledTime: at(6).getTime(),
      checkFreshness: async (c) => void nows.push(c.now),
      checkPartsFreshness: async () => "fresh",
    });
    expect(nows).toEqual([undefined]);
  });

  it("no other cron runs the f1.1 sweep, in any hour, 06 included", async () => {
    const s = setup({
      f11: F11_LANGS,
      env: { PACKS_CLEANUP: "dry-run", PACKS_PARTS_DISPATCH: undefined },
    });
    for (const cron of [CLEANUP_CRON, CLEANUP_RETRY_CRON, SLICE]) {
      for (let hour = 0; hour < 24; hour++) await s.run(cron, at(hour, 7));
    }
    expect(s.f11).toEqual([]);
    expect(s.r2.ops.some((op) => op.key === `catalog/${F11}/`)).toBe(false);
  });

  it("the f1.1 cron sweeps whatever the hour it starts in (the cron string picks the job)", async () => {
    const s = setup({ f11: ["fr"] });
    await s.run(F11_CRON, at(7, 2), { scheduledTime: at(6).getTime() });
    expect(s.f11.map((c) => c.language)).toEqual(["fr"]);
  });

  it("never runs the f1.1 sweep with PACKS_SWEEP = parts (staging)", async () => {
    const s = setup({ f11: F11_LANGS, env: { PACKS_SWEEP: "parts" } });
    await s.run(F11_CRON, at(6));
    expect(s.f11).toEqual([]);
    expect(s.r2.ops).toEqual([]);
  });
});

describe("runScheduled: one job per cron string", () => {
  it("the f1.1 cron at 06:17 checks no parts language, and the parts cron at 06:37 sweeps no f1.1 (no shared run)", async () => {
    const six = languagesOfHour(6, 2);
    const s = setup({ f11: ["fr"], parts: six });
    await s.run(F11_CRON, at(6));
    expect(s.f11.map((c) => c.language)).toEqual(["fr"]);
    expect(s.parts).toEqual([]);
    await s.run(SLICE, at(6, 37));
    expect(s.f11.map((c) => c.language)).toEqual(["fr"]);
    expect(s.parts.map((c) => c.language).sort()).toEqual([...six].sort());
  });

  it("an unknown cron string, or none, does nothing and says so loudly, under a prefix to alert on", async () => {
    const s = setup({
      f11: ["fr"],
      parts: languagesOfHour(6, 1),
      env: { PACKS_CLEANUP: "delete" },
    });
    const errors: string[] = [];
    const logs: string[] = [];
    const error = console.error;
    const log = console.log;
    console.error = (line: string) => void errors.push(String(line));
    console.log = (line: string) => void logs.push(String(line));
    try {
      for (const cron of ["17 * * * *", "47 * * * *", "* * * * *", ""]) {
        await s.run(cron, at(6));
        await s.run(cron, at(3));
      }
      await s.run(undefined as unknown as string, at(6));
    } finally {
      console.error = error;
      console.log = log;
    }
    expect([s.f11, s.parts, s.cleanups]).toEqual([[], [], []]);
    expect(s.r2.ops).toEqual([]);
    expect(logs).toEqual([]);
    expect(errors).toHaveLength(9);
    expect(errors.every((e) => e.startsWith("[packs] cron-unknown: "))).toBe(
      true,
    );
    expect(errors[0]).toBe(
      `[packs] cron-unknown: "17 * * * *" is none of the packs jobs (${PACKS_CRONS.join(", ")}); nothing done`,
    );
    expect(errors.at(-1)).toContain(
      "cron-unknown: null is none of the packs jobs",
    );
  });
});

describe("runScheduled: the parts sweep", () => {
  it("at 06:37 UTC checks only the parts languages of hour 6", async () => {
    const six = languagesOfHour(6, 2);
    const other = languagesOfHour(7, 2);
    const s = setup({ f11: ["fr"], parts: [...six, ...other] });
    await s.run(SLICE, at(6, 37));
    expect(s.parts.map((c) => c.language).sort()).toEqual([...six].sort());
    expect(s.parts.every((c) => c.reason === "daily" && c.hasBudget)).toBe(
      true,
    );
    // The check reads the language's own list.
    expect(s.parts[0]?.list?.language).toBe(s.parts[0]?.language);
  });

  it("checks every parts language exactly once over a day's 24 runs", async () => {
    const languages = [
      "en",
      "es-419",
      "fr",
      "pt-br",
      "sw",
      "de",
      "hi",
      "id",
      "ru",
      "ar",
      "zh",
      "am",
      "ne",
      "ta",
    ];
    const s = setup({ parts: languages });
    for (let hour = 0; hour < 24; hour++) await s.run(SLICE, at(hour));
    expect(s.parts.map((c) => c.language).sort()).toEqual(
      [...languages].sort(),
    );
  });

  it("does not take originals.json, the originals folder or another compat for languages, and does not walk the folder", async () => {
    const hour = partsHourOf("es-419");
    const s = setup({
      parts: ["es-419"],
      extra: {
        [`catalog/${PARTS}/originals.json`]: "{}",
        [`catalog/${PARTS}/originals/${SHA}.json`]: "{}",
        [`catalog/${OLD_PARTS}/es-419.json`]: partsList("es-419"),
      },
      env: { PACKS_SWEEP: "parts" },
    });
    for (let h = 0; h < 24; h++) await s.run(SLICE, at(h));
    expect(s.parts.map((c) => c.language)).toEqual(["es-419"]);
    const lists = s.r2.ops.filter((op) => op.op === "list").map((op) => op.o);
    expect(
      lists.every((o) => JSON.stringify(o).includes(`catalog/${PARTS}/`)),
    ).toBe(true);
    expect(
      lists.every((o) => (o as { delimiter?: string }).delimiter === "/"),
    ).toBe(true);
    expect(hour).toBe(22);
  });

  it("reads nothing for parts while parts dispatch is off", async () => {
    const s = setup({
      parts: ["es-419"],
      env: { PACKS_PARTS_DISPATCH: undefined, PACKS_SWEEP: "parts" },
    });
    for (let h = 0; h < 24; h++) await s.run(SLICE, at(h));
    expect(s.parts).toEqual([]);
    expect(s.r2.ops).toEqual([]);
  });

  it("checks at most PARTS_CHECKS_PER_RUN languages a run, another choice each day, so each is still checked", async () => {
    const crowded = languagesOfHour(9, PARTS_CHECKS_PER_RUN + 2);
    const s = setup({ parts: crowded });
    const seen = new Set<string>();
    const picks: string[] = [];
    for (let d = 1; d <= 20; d++) {
      const day = `2026-11-${String(d).padStart(2, "0")}`;
      s.parts.length = 0;
      await s.run(SLICE, at(9, 17, day));
      expect(s.parts).toHaveLength(PARTS_CHECKS_PER_RUN);
      for (const c of s.parts) seen.add(c.language);
      picks.push(
        s.parts
          .map((c) => c.language)
          .sort()
          .join(),
      );
    }
    expect([...seen].sort()).toEqual([...crowded].sort());
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it("checks PARTS_CHECKS_PER_RUN languages a run when it is set (0 checks none); anything else is the default 5", async () => {
    const crowded = languagesOfHour(9, 8);
    for (const [raw, n] of [
      ["2", 2],
      ["8", 8],
      ["0", 0],
      [undefined, PARTS_CHECKS_PER_RUN],
      ["", PARTS_CHECKS_PER_RUN],
      ["abc", PARTS_CHECKS_PER_RUN],
      ["-1", PARTS_CHECKS_PER_RUN],
      ["1.5", PARTS_CHECKS_PER_RUN],
      // Digits only, as PACKS_PARTS_DAILY_CAP: what Number() would read as a whole number is still a typo here.
      ["1e2", PARTS_CHECKS_PER_RUN],
      ["0x8", PARTS_CHECKS_PER_RUN],
      ["5.0", PARTS_CHECKS_PER_RUN],
      [" 3", PARTS_CHECKS_PER_RUN],
      ["+3", PARTS_CHECKS_PER_RUN],
    ] as const) {
      const s = setup({
        parts: crowded,
        env: { PARTS_CHECKS_PER_RUN: raw },
      });
      await s.run(SLICE, at(9, 37));
      expect([raw, s.parts.length]).toEqual([raw, n]);
    }
    expect(checksPerRun("3")).toBe(3);
    expect(checksPerRun("12")).toBe(12);
    expect(checksPerRun("1e2")).toBe(PARTS_CHECKS_PER_RUN);
    expect(PARTS_CHECKS_PER_RUN).toBe(5);
  });

  it.each([
    [7, 5],
    [12, 5],
    [7, 3],
    [10, 5],
    [11, 4],
  ])(
    "rotates a slice of %i by the day: with %i a run, every language is checked within ceil(k/perRun) days, on any days",
    async (k, perRun) => {
      const crowded = languagesOfHour(11, k);
      const s = setup({
        parts: crowded,
        env: { PARTS_CHECKS_PER_RUN: String(perRun) },
      });
      const byDay: string[][] = [];
      // 40 days in a row, across a month's end.
      for (let d = 0; d < 40; d++) {
        const when = new Date(
          at(11, 37, "2026-10-10").getTime() + d * 86_400_000,
        );
        s.parts.length = 0;
        await s.run(SLICE, when);
        byDay.push(s.parts.map((c) => c.language));
      }
      const window = Math.ceil(k / perRun);
      for (let d = 0; d + window <= byDay.length; d++) {
        const seen = new Set(byDay.slice(d, d + window).flat());
        expect([d, seen.size]).toEqual([d, k]);
      }
      // The day's offset is dayIndex * perRun % k into the sorted slice.
      const sorted = [...crowded].sort();
      const dayIndex = Math.floor(
        at(11, 37, "2026-10-10").getTime() / 86_400_000,
      );
      const offset = (dayIndex * perRun) % k;
      expect(byDay[0]).toEqual(
        [...sorted.slice(offset), ...sorted.slice(0, offset)].slice(0, perRun),
      );
    },
  );

  it("takes the day from the schedule's time, not the clock: a 23:37 run that starts after midnight keeps its day", async () => {
    const crowded = languagesOfHour(23, PARTS_CHECKS_PER_RUN + 3);
    const late = setup({ parts: crowded });
    const onTime = setup({ parts: crowded });
    const scheduled = at(23, 37);
    await late.run(SLICE, scheduled, {
      now: new Date(scheduled.getTime() + 40 * 60_000),
    });
    await onTime.run(SLICE, scheduled);
    expect(late.parts.map((c) => c.language)).toEqual(
      onTime.parts.map((c) => c.language),
    );
    expect(late.parts.length).toBe(PARTS_CHECKS_PER_RUN);
  });

  it("one failing check does not stop the next", async () => {
    const six = languagesOfHour(6, 3);
    const s = setup({ parts: six });
    const checked: string[] = [];
    await s.run(SLICE, at(6), {
      checkPartsFreshness: async (c) => {
        checked.push(c.language);
        if (checked.length === 1) throw new Error("parts boom");
        return "fresh";
      },
    });
    expect(checked).toHaveLength(3);
  });

  it("a listing that fails stops the parts slice without throwing out of the handler", async () => {
    const s = setup({ parts: ["es-419"] });
    s.r2.fail.push((op, key) => op === "list" && key === `catalog/${PARTS}/`);
    await expect(s.run(SLICE, at(3))).resolves.toBeUndefined();
    expect(s.parts).toEqual([]);
  });

  it("a failing f1.1 sweep does not throw out of the handler either", async () => {
    const s = setup({ f11: ["fr"] });
    await expect(
      s.run(F11_CRON, at(6), {
        checkFreshness: async () => {
          throw new Error("f1.1 boom");
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("runScheduled: the code budget (the real parts check)", () => {
  /** Every language listed with the old code, Door43 unchanged, master building NEW_CODE. */
  function codeBump(
    languages: string[],
    outcome: (l: string) => BuildOutcome = () => "dispatched",
  ) {
    const s = setup({
      parts: languages,
      extra: {
        "status/builder.json": JSON.stringify({
          compat: PARTS,
          code: NEW_CODE,
          commit: "0".repeat(40),
          at: "2026-10-20T00:00:00Z",
        }),
      },
    });
    const builds: Array<{ language: string; reason: string }> = [];
    const more: ScheduledDeps = {
      checkPartsFreshness: undefined,
      observe: async () => ({ stamps: { "x/y/z": "v1#2026-01-01T00_00_00Z" } }),
      requestBuild: async (r) => {
        builds.push({ language: r.language, reason: r.reason });
        return outcome(r.language);
      },
    };
    return { ...s, builds, more };
  }

  /** At most PARTS_CHECKS_PER_RUN in each of the first hours, so the per-run cap leaves none out. */
  function spread(n: number): string[] {
    const out: string[] = [];
    for (let hour = 0; out.length < n; hour++) {
      out.push(...languagesOfHour(hour, Math.min(2, n - out.length)));
    }
    return out;
  }

  it("dispatches ten code-only rebuilds a day; the eleventh is `budget`", async () => {
    const languages = spread(CODE_REBUILDS_PER_DAY + 1);
    const s = codeBump(languages);
    const results: string[] = [];
    const logs: string[] = [];
    const log = console.log;
    console.log = (line: string) => void logs.push(String(line));
    try {
      for (let hour = 0; hour < 24; hour++)
        await s.run(SLICE, at(hour), s.more);
    } finally {
      console.log = log;
    }
    for (const line of logs) {
      const m = / parts \S+\/(\S+): (\w[\w-]*)/.exec(line);
      if (m) results.push(`${m[1]} ${m[2]}`);
    }
    expect(s.builds).toHaveLength(CODE_REBUILDS_PER_DAY);
    expect(s.builds.every((b) => b.reason === "daily")).toBe(true);
    expect(results.filter((r) => r.endsWith(" budget"))).toHaveLength(1);
    expect(s.values.get(`packs:code-rebuilds:${DAY}`)).toBe(
      String(CODE_REBUILDS_PER_DAY),
    );
  });

  it("spends the budget only on a dispatched rebuild: a stopped, cooling or running language spends none (review M3)", async () => {
    const languages = spread(CODE_REBUILDS_PER_DAY + 4);
    const held = new Set(languages.slice(0, 4));
    const s = codeBump(languages, (l) =>
      held.has(l) ? "stopped" : "dispatched",
    );
    for (let hour = 0; hour < 24; hour++) await s.run(SLICE, at(hour), s.more);
    // Four held languages asked and spent nothing: the other ten were all dispatched.
    expect(s.builds.filter((b) => !held.has(b.language))).toHaveLength(
      CODE_REBUILDS_PER_DAY,
    );
    expect(s.values.get(`packs:code-rebuilds:${DAY}`)).toBe(
      String(CODE_REBUILDS_PER_DAY),
    );
  });

  it("starts a new budget the next day", async () => {
    const languages = spread(CODE_REBUILDS_PER_DAY + 1);
    const s = codeBump(languages);
    s.values.set(
      `packs:code-rebuilds:2026-10-20`,
      String(CODE_REBUILDS_PER_DAY),
    );
    for (let hour = 0; hour < 24; hour++) await s.run(SLICE, at(hour), s.more);
    expect(s.builds).toHaveLength(CODE_REBUILDS_PER_DAY);
  });

  /** Counts the budget counter's reads and writes; `failRead` makes its reads throw. */
  function countBudget(s: ReturnType<typeof codeBump>, failRead = false) {
    const key = `packs:code-rebuilds:${DAY}`;
    const kv = s.env.TRANSLATION_HELPS_CACHE;
    const calls = { gets: 0, puts: [] as string[] };
    s.env.TRANSLATION_HELPS_CACHE = {
      get: async (k: string | string[], ...rest: unknown[]) => {
        if (k === key) {
          calls.gets++;
          if (failRead) throw new Error("KV down");
        }
        return (kv.get as (...a: unknown[]) => unknown)(k, ...rest);
      },
      put: async (k: string, v: string, o?: KVNamespacePutOptions) => {
        if (k === key) calls.puts.push(v);
        return kv.put(k, v, o);
      },
    } as unknown as KVNamespace;
    return calls;
  }

  it("never goes over the budget across the dispatches of one run: read once, spent in memory, written once", async () => {
    const languages = languagesOfHour(5, PARTS_CHECKS_PER_RUN);
    const s = codeBump(languages);
    s.values.set(
      `packs:code-rebuilds:${DAY}`,
      String(CODE_REBUILDS_PER_DAY - 2),
    );
    const calls = countBudget(s);
    await s.run(SLICE, at(5, 37), s.more);
    expect(s.builds).toHaveLength(2);
    expect(calls).toEqual({
      gets: 1,
      puts: [String(CODE_REBUILDS_PER_DAY)],
    });
  });

  it("reads and writes no counter in a run that asks for no code rebuild", async () => {
    const [language] = languagesOfHour(4, 1) as [string];
    const s = codeBump([language]);
    const calls = countBudget(s);
    await s.run(SLICE, at(4, 37), {
      ...s.more,
      observe: async () => ({ stamps: { "x/y/z": "v2#2026-10-20T00_00_00Z" } }),
      // The list's code is the builder's: nothing code-only.
    });
    expect(calls.gets).toBe(0);
    expect(calls.puts).toEqual([]);
  });

  it("writes nothing when every code-only check was held (none dispatched)", async () => {
    const languages = languagesOfHour(5, 3);
    const s = codeBump(languages, () => "cooling");
    const calls = countBudget(s);
    await s.run(SLICE, at(5, 37), s.more);
    expect(calls).toEqual({ gets: 1, puts: [] });
  });

  it("asks for no code rebuild when the counter cannot be read (code rebuilds can wait a day)", async () => {
    const languages = languagesOfHour(5, 3);
    const s = codeBump(languages);
    const calls = countBudget(s, true);
    const errors: string[] = [];
    const error = console.error;
    console.error = (line: string) => void errors.push(String(line));
    try {
      await s.run(SLICE, at(5, 37), s.more);
    } finally {
      console.error = error;
    }
    expect(s.builds).toEqual([]);
    expect(calls).toEqual({ gets: 1, puts: [] });
    expect(errors.join("\n")).toContain("code budget");
  });

  it("counts the code budget on the schedule's day, not the clock's", async () => {
    const [language] = languagesOfHour(23, 1) as [string];
    const s = codeBump([language]);
    const scheduled = at(23, 37);
    await s.run(SLICE, scheduled, {
      ...s.more,
      now: new Date(scheduled.getTime() + 40 * 60_000),
    });
    expect(s.builds).toEqual([{ language, reason: "daily" }]);
    expect(s.values.get(`packs:code-rebuilds:${DAY}`)).toBe("1");
    expect(s.values.has(`packs:code-rebuilds:2026-10-22`)).toBe(false);
  });

  it("does not spend the code budget on a moved stamp", async () => {
    const [language] = languagesOfHour(4, 1) as [string];
    const s = codeBump([language]);
    await s.run(SLICE, at(4), {
      ...s.more,
      observe: async () => ({ stamps: { "x/y/z": "v2#2026-10-20T00_00_00Z" } }),
    });
    expect(s.builds).toEqual([{ language, reason: "daily" }]);
    expect(s.values.has(`packs:code-rebuilds:${DAY}`)).toBe(false);
  });
});

describe("runScheduled: the cleanup crons", () => {
  /** A ledger whose only content is the day's outcome. */
  const recorded = (day: string, state: string) =>
    JSON.stringify({ schema: 1, since: {}, outcomes: { [day]: state } });

  it("the 03:07 cron runs the cleanup in the mode PACKS_CLEANUP names, for the schedule's day, and checks no parts", async () => {
    const three = languagesOfHour(3, 1);
    for (const mode of ["dry-run", "delete"] as const) {
      const s = setup({ parts: three, env: { PACKS_CLEANUP: mode } });
      await s.run(CLEANUP_CRON, at(3, 7));
      expect(s.cleanups).toEqual([{ mode, day: DAY }]);
      expect(s.parts).toEqual([]);
    }
  });

  it("is off when PACKS_CLEANUP is unset, off, or anything but the two modes, retries included", async () => {
    for (const raw of [undefined, "off", "Delete", "dry_run", "yes", ""]) {
      const s = setup({
        env: { PACKS_CLEANUP: raw },
        extra: { [LEDGER]: recorded(DAY, "aborted") },
      });
      await s.run(CLEANUP_CRON, at(3, 7));
      await s.run(CLEANUP_RETRY_CRON, at(4, 7));
      expect(s.cleanups).toEqual([]);
      expect(cleanupMode(raw)).toBeNull();
    }
  });

  it.each([
    ["postponed", 1],
    ["aborted", 1],
    ["done", 0],
  ] as const)(
    "the 04:07 and 05:07 retries run when the day's cleanup was %s: %i run each",
    async (state, runs) => {
      const s = setup({
        env: { PACKS_CLEANUP: "dry-run" },
        extra: { [LEDGER]: recorded(DAY, state) },
      });
      await s.run(CLEANUP_RETRY_CRON, at(4, 7));
      await s.run(CLEANUP_RETRY_CRON, at(5, 7));
      expect(s.cleanups).toEqual(
        Array.from({ length: 2 * runs }, () => ({ mode: "dry-run", day: DAY })),
      );
    },
  );

  /** The `console.error` lines `fn` logs that carry the cleanup's alert tag. */
  async function alerts(fn: () => Promise<void>): Promise<string[]> {
    const errors: string[] = [];
    const error = console.error;
    const log = console.log;
    console.error = (...args: unknown[]) => void errors.push(args.join(" "));
    console.log = () => {};
    try {
      await fn();
    } finally {
      console.error = error;
      console.log = log;
    }
    return errors.filter((e) => e.startsWith(ALERT_TAG));
  }

  it("a retry runs no cleanup when the day has no outcome (no ledger, another day's, or one that does not parse), and alerts once", async () => {
    for (const mode of ["dry-run", "delete"] as const) {
      for (const ledger of [
        undefined,
        recorded("2026-10-20", "aborted"),
        "{",
      ]) {
        const s = setup({
          env: { PACKS_CLEANUP: mode },
          ...(ledger ? { extra: { [LEDGER]: ledger } } : {}),
        });
        const lines = await alerts(() => s.run(CLEANUP_RETRY_CRON, at(4, 7)));
        expect(s.cleanups).toEqual([]);
        expect(lines).toEqual([
          `${ALERT_TAG} no outcome recorded for ${DAY}: the 03:07 UTC cleanup (${mode}) was killed, did not fire, or could not read or write ${LEDGER}; not retried`,
        ]);
        // Only the ledger was read: nothing written, nothing deleted.
        expect(s.r2.ops).toEqual([{ op: "get", key: LEDGER }]);
      }
    }
  });

  it("no alert from a retry when the cleanup is off, or when the day has an outcome", async () => {
    for (const raw of [undefined, "off", "Delete"]) {
      const s = setup({ env: { PACKS_CLEANUP: raw } });
      expect(await alerts(() => s.run(CLEANUP_RETRY_CRON, at(4, 7)))).toEqual(
        [],
      );
      expect(s.r2.ops).toEqual([]);
    }
    for (const state of ["done", "postponed", "aborted"]) {
      const s = setup({
        env: { PACKS_CLEANUP: "dry-run" },
        extra: { [LEDGER]: recorded(DAY, state) },
      });
      expect(await alerts(() => s.run(CLEANUP_RETRY_CRON, at(5, 7)))).toEqual(
        [],
      );
      expect(s.cleanups.length).toBe(state === "done" ? 0 : 1);
    }
  });

  it("a failing cleanup does not throw out of the handler", async () => {
    const s = setup({ env: { PACKS_CLEANUP: "delete" } });
    await expect(
      s.run(CLEANUP_CRON, at(3, 7), {
        cleanup: async () => {
          throw new Error("cleanup boom");
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("wrangler.toml: the crons and their vars", () => {
  const toml = () =>
    readFileSync(
      fileURLToPath(new URL("../../wrangler.toml", import.meta.url)),
      "utf8",
    );

  /** Each section's lines that are not comments, by section header (`""` for the top level). */
  function sections(): Record<string, string[]> {
    const out: Record<string, string[]> = { "": [] };
    let section = "";
    for (const line of toml().split(/\r?\n/)) {
      if (line.trimStart().startsWith("#") || !line.trim()) continue;
      const header = /^\[+([^\]]+)\]+\s*$/.exec(line);
      if (header) out[(section = header[1] ?? "")] ??= [];
      else out[section]!.push(line);
    }
    return out;
  }

  /** The cron strings of a `[...triggers]` section. */
  const crons = (lines: string[] | undefined): string[] | null => {
    const m = /^crons = (\[.*\])$/.exec(lines?.join("") ?? "");
    return m ? (JSON.parse(m[1]!) as string[]) : null;
  };

  it("production has all four packs crons; staging has the cleanup, its retries and the parts slice", () => {
    const s = sections();
    expect(crons(s["env.production.triggers"])).toEqual([
      F11_SWEEP_CRON,
      CLEANUP_CRON,
      CLEANUP_RETRY_CRON,
      PARTS_SLICE_CRON,
    ]);
    expect(crons(s["env.preview.triggers"])).toEqual([
      CLEANUP_CRON,
      CLEANUP_RETRY_CRON,
      PARTS_SLICE_CRON,
    ]);
    // The top level deploys under the production Worker's name: no cron of its own.
    expect(
      Object.keys(s)
        .filter((k) => k.endsWith("triggers"))
        .sort(),
    ).toEqual(["env.preview.triggers", "env.production.triggers"]);
  });

  it("lists only crons the Worker has a job for (7 total across production + preview on this Paid account)", () => {
    const s = sections();
    const all = [
      ...crons(s["env.production.triggers"])!,
      ...crons(s["env.preview.triggers"])!,
    ];
    expect(all.every((c) => PACKS_CRONS.includes(c))).toBe(true);
    expect(all).toHaveLength(7);
  });

  it("sweeps parts only on staging; both staging and production keep cleanup in dry-run", () => {
    const s = sections();
    const preview = s["env.preview"]!.join("\n");
    const production = s["env.production"]!.join("\n");
    expect(preview).toContain('PACKS_SWEEP = "parts"');
    expect(preview).toContain('PACKS_CLEANUP = "dry-run"');
    expect(production).toContain('PACKS_CLEANUP = "dry-run"');
    expect(production).not.toContain("PACKS_SWEEP");
    const anywhere = Object.values(s)
      .flat()
      .filter((l) => /PACKS_CLEANUP|PACKS_SWEEP|PARTS_CHECKS_PER_RUN/.test(l));
    expect(anywhere.sort()).toEqual(
      [
        s["env.preview"]!.find((l) => l.startsWith("vars"))!,
        s["env.production"]!.find((l) => l.startsWith("vars"))!,
      ].sort(),
    );
    expect(anywhere.join()).not.toContain("PARTS_CHECKS_PER_RUN");
  });
});

describe("worker.ts: the scheduled handler", () => {
  it("awaits the job picked by the cron string, with no waitUntil (worker.ts pulls in the web build, so read as text)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/worker.ts", import.meta.url)),
      "utf8",
    );
    const handler = /async scheduled\([\s\S]*?\r?\n {2}\},\r?\n/.exec(
      source,
    )?.[0];
    expect(handler).toBeDefined();
    expect(handler!.replace(/\s+/g, " ")).toContain(
      "await runScheduled(env, ctx, { cron: event.cron, scheduledTime: event.scheduledTime, });",
    );
    expect(handler).not.toContain("waitUntil(");
  });
});
