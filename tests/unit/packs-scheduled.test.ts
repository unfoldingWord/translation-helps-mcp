/**
 * The hourly cron: the f1.1 sweep at 06 UTC exactly as the daily cron ran it, the parts languages in hourly slices
 * (each once a day), code-only rebuilds within their daily budget, and the cleanup at 03 UTC when it is on.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CODE_REBUILDS_PER_DAY,
  PARTS_CHECKS_PER_RUN,
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
import { fakeKv, fakeR2 } from "./fakeR2";

const F11 = CURRENT_PACK_COMPAT;
const PARTS = CURRENT_PARTS_COMPAT;
const OLD_PARTS = "f2.0-u2.3.0-p6000229-q9-a12-t1";
const DAY = "2026-10-21";
const at = (hour: number, minute = 17, day = DAY) =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:${minute}:00Z`);
const SHA = "a".repeat(64);
const CODE = `${PARTS}+7bc31e739fbeed69`;
const NEW_CODE = `${PARTS}+0123456789abcdef`;

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
  const cleanups: Array<{ mode: string }> = [];
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
      cleanups.push({ mode: c.mode });
    },
  };
  const run = (when: Date, more: ScheduledDeps = {}) =>
    runScheduled(env, {} as ExecutionContext, {
      ...deps,
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

  it("at 06 UTC runs the f1.1 sweep exactly as the daily cron did: same checks, same listing", async () => {
    const extra = { [`catalog/${F11}/originals.json`]: "{}" };
    const s = setup({
      f11: F11_LANGS,
      extra,
      env: { PACKS_PARTS_DISPATCH: undefined },
    });
    await s.run(at(6));

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
      scheduledTime: at(6).getTime(),
      checkFreshness: async (c) => void nows.push(c.now),
      checkPartsFreshness: async () => "fresh",
    });
    expect(nows).toEqual([undefined]);
  });

  it("runs no f1.1 sweep in any other hour", async () => {
    const s = setup({ f11: F11_LANGS });
    for (const hour of [0, 3, 5, 7, 12, 23]) await s.run(at(hour));
    expect(s.f11).toEqual([]);
    expect(s.r2.ops.some((op) => op.key === `catalog/${F11}/`)).toBe(false);
  });

  it("takes the hour from the schedule, so a 06:17 run that starts late still sweeps", async () => {
    const s = setup({ f11: ["fr"] });
    await s.run(at(7, 2), { scheduledTime: at(6).getTime() });
    expect(s.f11.map((c) => c.language)).toEqual(["fr"]);
  });

  it("never runs the f1.1 sweep with PACKS_SWEEP = parts (staging), in any hour", async () => {
    const s = setup({ f11: F11_LANGS, env: { PACKS_SWEEP: "parts" } });
    for (let hour = 0; hour < 24; hour++) await s.run(at(hour));
    expect(s.f11).toEqual([]);
  });
});

describe("runScheduled: the parts sweep", () => {
  it("at 06 UTC checks only the parts languages of hour 6, after the f1.1 sweep", async () => {
    const six = languagesOfHour(6, 2);
    const other = languagesOfHour(7, 2);
    const s = setup({ f11: ["fr"], parts: [...six, ...other] });
    await s.run(at(6));
    expect(s.f11.map((c) => c.language)).toEqual(["fr"]);
    expect(s.parts.map((c) => c.language).sort()).toEqual([...six].sort());
    expect(s.parts.every((c) => c.reason === "daily" && c.hasBudget)).toBe(
      true,
    );
    expect(s.order[0]).toBe("f11 fr");
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
    for (let hour = 0; hour < 24; hour++) await s.run(at(hour));
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
    for (let h = 0; h < 24; h++) await s.run(at(h));
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

  it("reads nothing for parts while parts dispatch is off (production today)", async () => {
    const s = setup({
      parts: ["es-419"],
      env: { PACKS_PARTS_DISPATCH: undefined, PACKS_SWEEP: "parts" },
    });
    for (let h = 0; h < 24; h++) await s.run(at(h));
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
      await s.run(at(9, 17, day));
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

  it("one failing check does not stop the next, nor a failing f1.1 sweep the parts slice", async () => {
    const six = languagesOfHour(6, 3);
    const s = setup({ f11: ["fr"], parts: six });
    const checked: string[] = [];
    await s.run(at(6), {
      checkFreshness: async () => {
        throw new Error("f1.1 boom");
      },
      checkPartsFreshness: async (c) => {
        checked.push(c.language);
        if (checked.length === 1) throw new Error("parts boom");
        return "fresh";
      },
    });
    expect(checked).toHaveLength(3);
  });

  it("a listing that fails stops only the parts sweep, not the cleanup before it", async () => {
    const s = setup({ parts: ["es-419"], env: { PACKS_CLEANUP: "dry-run" } });
    s.r2.fail.push((op, key) => op === "list" && key === `catalog/${PARTS}/`);
    await expect(s.run(at(3))).resolves.toBeUndefined();
    expect(s.cleanups).toEqual([{ mode: "dry-run" }]);
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
      for (let hour = 0; hour < 24; hour++) await s.run(at(hour), s.more);
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
    for (let hour = 0; hour < 24; hour++) await s.run(at(hour), s.more);
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
    for (let hour = 0; hour < 24; hour++) await s.run(at(hour), s.more);
    expect(s.builds).toHaveLength(CODE_REBUILDS_PER_DAY);
  });

  it("does not spend the code budget on a moved stamp", async () => {
    const [language] = languagesOfHour(4, 1) as [string];
    const s = codeBump([language]);
    await s.run(at(4), {
      ...s.more,
      observe: async () => ({ stamps: { "x/y/z": "v2#2026-10-20T00_00_00Z" } }),
    });
    expect(s.builds).toEqual([{ language, reason: "daily" }]);
    expect(s.values.has(`packs:code-rebuilds:${DAY}`)).toBe(false);
  });
});

describe("runScheduled: the cleanup hour", () => {
  it("runs the cleanup at 03 UTC in the mode PACKS_CLEANUP names, before the parts slice", async () => {
    const three = languagesOfHour(3, 1);
    for (const mode of ["dry-run", "delete"] as const) {
      const s = setup({ parts: three, env: { PACKS_CLEANUP: mode } });
      for (let h = 0; h < 24; h++) await s.run(at(h));
      expect(s.cleanups).toEqual([{ mode }]);
      expect(s.order.indexOf(`cleanup ${mode}`)).toBeLessThan(
        s.order.indexOf(`parts ${three[0]}`),
      );
    }
  });

  it("is off when PACKS_CLEANUP is unset, off, or anything but the two modes", async () => {
    for (const raw of [undefined, "off", "Delete", "dry_run", "yes", ""]) {
      const s = setup({ env: { PACKS_CLEANUP: raw } });
      for (let h = 0; h < 24; h++) await s.run(at(h));
      expect(s.cleanups).toEqual([]);
      expect(cleanupMode(raw)).toBeNull();
    }
  });

  it("a failing cleanup does not stop the parts slice", async () => {
    const three = languagesOfHour(3, 1);
    const s = setup({ parts: three, env: { PACKS_CLEANUP: "delete" } });
    await s.run(at(3), {
      cleanup: async () => {
        throw new Error("cleanup boom");
      },
    });
    expect(s.parts.map((c) => c.language)).toEqual(three);
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
    for (const line of toml().split("\n")) {
      if (line.trimStart().startsWith("#") || !line.trim()) continue;
      const header = /^\[+([^\]]+)\]+\s*$/.exec(line);
      if (header) out[(section = header[1] ?? "")] ??= [];
      else out[section]!.push(line);
    }
    return out;
  }

  it("runs production hourly at :17 (06:17 is the f1.1 sweep's old time) and staging hourly at :47", () => {
    const s = sections();
    expect(s["env.production.triggers"]).toEqual(['crons = ["17 * * * *"]']);
    expect(s["env.preview.triggers"]).toEqual(['crons = ["47 * * * *"]']);
    // The top level deploys under the production Worker's name: no cron of its own.
    expect(
      Object.keys(s)
        .filter((k) => k.endsWith("triggers"))
        .sort(),
    ).toEqual(["env.preview.triggers", "env.production.triggers"]);
  });

  it("sweeps parts only and cleans up in dry-run on staging; production has no cleanup and no parts dispatch", () => {
    const s = sections();
    const preview = s["env.preview"]!.join("\n");
    const production = s["env.production"]!.join("\n");
    expect(preview).toContain('PACKS_SWEEP = "parts"');
    expect(preview).toContain('PACKS_CLEANUP = "dry-run"');
    expect(production).not.toContain("PACKS_CLEANUP");
    expect(production).not.toContain("PACKS_SWEEP");
    expect(production).not.toContain("PACKS_PARTS_DISPATCH");
    const anywhere = Object.values(s)
      .flat()
      .filter((l) => /PACKS_CLEANUP|PACKS_SWEEP/.test(l));
    expect(anywhere).toEqual(
      s["env.preview"]!.filter((l) => l.startsWith("vars")),
    );
  });
});
