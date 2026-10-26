/**
 * The parts cleanup deletes only what no current list has named for 30 days in a row, waits for running builds,
 * aborts on any partial view or any change before it deletes, and never reaches outside `parts/` and the
 * content-addressed originals lists.
 */

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  ABORT_ALERT_DAYS,
  CLEANUP_R2_CALLS,
  LEDGER,
  MAX_DELETES,
  cleanupOutcome,
  runPartsCleanup,
  type CleanupEnv,
} from "../../src/packs/cleanup";
import {
  CLEANUP_CRON,
  CLEANUP_RETRY_CRON,
  runScheduled,
} from "../../src/packs/scheduled";
import {
  CURRENT_PACK_COMPAT,
  CURRENT_PARTS_COMPAT,
  RUNNING_STALE_MS,
} from "../../src/packs/dispatch";
import { fakeKv, fakeR2 } from "./fakeR2";

const C = CURRENT_PARTS_COMPAT;
const OLD = "f2.0-u2.3.0-p6000229-q9-a12-t1";
const F11 = CURRENT_PACK_COMPAT;
const DAY = 24 * 3_600_000;
const T0 = new Date("2026-10-01T03:17:00Z");
const day = (n: number) => new Date(T0.getTime() + n * DAY);
const sha = (n: number) => n.toString(16).padStart(64, "0");
const part = (n: number) => `parts/${sha(n)}.part.gz`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function originalsText(parts: number[]): string {
  return JSON.stringify({
    schema: 2,
    language: "originals",
    compat: C,
    code: `${C}+x`,
    resources: [],
    parts: parts.map((n) => ({ sha256: sha(n), bytes: 1 })),
  });
}

function languageText(
  language: string,
  parts: number[],
  originals: string,
  compat = C,
): string {
  const s = hash(originals);
  return JSON.stringify({
    schema: 2,
    language,
    compat,
    code: `${compat}+x`,
    resources: [],
    parts: parts.map((n) => ({ sha256: sha(n), bytes: 1 })),
    originals: { path: `catalog/${compat}/originals/${s}.json`, sha256: s },
  });
}

const ORIGINALS = originalsText([101, 102]);
const OLD_DATE = day(-90);

/**
 * es-419 names parts 1 and 2 and the originals list (parts 101 and 102), which is also `originals.json`. Part 9 is
 * named by no list. The rest of the bucket is what the cleanup must never touch.
 */
function world(
  extra: Record<string, string | { text: string; uploaded?: Date }> = {},
) {
  const old = (text: string) => ({ text, uploaded: OLD_DATE });
  const r2 = fakeR2(
    {
      [`catalog/${C}/es-419.json`]: old(
        languageText("es-419", [1, 2], ORIGINALS),
      ),
      [`catalog/${C}/originals.json`]: old(ORIGINALS),
      [`catalog/${C}/originals/${hash(ORIGINALS)}.json`]: old(ORIGINALS),
      [part(1)]: old("p1"),
      [part(2)]: old("p2"),
      [part(101)]: old("o1"),
      [part(102)]: old("o2"),
      [part(9)]: old("orphan nine"),
      [`status/${C}/es-419.json`]: old(
        JSON.stringify({
          state: "ok",
          at: "2026-09-01T00:00:00Z",
          failures: 0,
          run: "r",
        }),
      ),
      "status/builder.json": old("{}"),
      [`packs/${F11}/es-419/x.langpack.zip`]: old("zip"),
      [`packs/${F11}/originals/${sha(7)}.langpack.zip`]: old("zip"),
      "v1/es-419/notes/TIT/1.json": old("{}"),
      [`catalog/${F11}/es-419.json`]: old("{}"),
      [`catalog/${F11}/originals.json`]: old("{}"),
      [`status/${F11}/es-419.json`]: old("{}"),
      ...extra,
    },
    { now: OLD_DATE },
  );
  const points: string[][] = [];
  const env: CleanupEnv = {
    LANGUAGE_PACKS: r2.bucket,
    ANALYTICS: {
      writeDataPoint: (p: { blobs?: string[] }) =>
        void points.push(p.blobs ?? []),
    } as unknown as AnalyticsEngineDataset,
  };
  // The bucket's clock follows the runs, so what a test writes between two runs is dated like a build's write.
  const run = (n: number, mode: "dry-run" | "delete" = "delete") => {
    r2.setNow(day(n));
    return runPartsCleanup(env, { now: day(n), mode });
  };
  const ledger = () => {
    const raw = r2.objects.get(LEDGER)?.text;
    return raw
      ? (JSON.parse(raw) as {
          since: Record<string, string>;
          checked?: string;
          outcomes?: Record<string, string>;
        })
      : null;
  };
  /** What decides deletes: the first dates and the last finished run (not the days' outcomes). */
  const counts = () => {
    const l = ledger();
    return l ? { since: l.since, checked: l.checked } : null;
  };
  return { r2, env, run, ledger, counts, points };
}

const dayOf = (n: number) => day(n).toISOString().slice(0, 10);

/** Runs once a day from `from` to `to`, as the cron does; returns the last summary. */
async function daily(w: ReturnType<typeof world>, from: number, to: number) {
  let last;
  for (let n = from; n <= to; n++) last = await w.run(n);
  return last!;
}

describe("runPartsCleanup: what is named", () => {
  it("never takes a part a language list, the originals list it names or originals.json names for a candidate", async () => {
    const w = world();
    const s = await w.run(0);
    expect(s).toMatchObject({ state: "done", orphans: 1, due: 0, deleted: 0 });
    expect(Object.keys(w.ledger()!.since)).toEqual([part(9)]);
    // 1, 2, 101, 102 and the originals list.
    expect(s.named).toBe(5);
  });

  it("takes a part named only by a list in another parts compat as named", async () => {
    const oldOriginals = originalsText([103]);
    const w = world({
      [`catalog/${OLD}/fr.json`]: languageText("fr", [9], oldOriginals, OLD),
      [`catalog/${OLD}/originals/${hash(oldOriginals)}.json`]: oldOriginals,
      [part(103)]: "o3",
    });
    const s = await daily(w, 0, 40);
    expect(s).toMatchObject({ state: "done", orphans: 0 });
    expect(w.r2.deleted).toEqual([]);
  });

  it("keeps the originals list es-419 names and the one originals.json is; another one is a candidate, and goes", async () => {
    const stale = originalsText([104]);
    const latest = originalsText([105]);
    const w = world({
      [`catalog/${C}/originals.json`]: { text: latest, uploaded: OLD_DATE },
      [`catalog/${C}/originals/${hash(latest)}.json`]: {
        text: latest,
        uploaded: OLD_DATE,
      },
      [`catalog/${C}/originals/${hash(stale)}.json`]: {
        text: stale,
        uploaded: OLD_DATE,
      },
      [part(104)]: { text: "o4", uploaded: OLD_DATE },
      [part(105)]: { text: "o5", uploaded: OLD_DATE },
    });
    await w.run(0);
    expect(Object.keys(w.ledger()!.since).sort()).toEqual(
      [`catalog/${C}/originals/${hash(stale)}.json`, part(104), part(9)].sort(),
    );
    await daily(w, 1, 30);
    expect(w.r2.deleted.sort()).toEqual(
      [`catalog/${C}/originals/${hash(stale)}.json`, part(104), part(9)].sort(),
    );
    expect(
      w.r2.objects.has(`catalog/${C}/originals/${hash(ORIGINALS)}.json`),
    ).toBe(true);
    expect(
      w.r2.objects.has(`catalog/${C}/originals/${hash(latest)}.json`),
    ).toBe(true);
  });

  it("never lists packs/, v1/, status/, cleanup/ or catalog/f1.1 objects as candidates, and never deletes them", async () => {
    const w = world();
    const keys = [...w.r2.objects.keys()].filter((k) => k !== LEDGER);
    await daily(w, 0, 60);
    expect(w.r2.deleted).toEqual([part(9)]);
    expect([...w.r2.objects.keys()].filter((k) => k !== LEDGER).sort()).toEqual(
      keys.filter((k) => k !== part(9)).sort(),
    );
    const lists = w.r2.ops.filter((op) => op.op === "list").map((op) => op.key);
    expect(
      lists.some((k) => k?.startsWith("packs/") || k?.startsWith("v1/")),
    ).toBe(false);
    expect(
      lists.some(
        (k) =>
          k?.startsWith(`catalog/${F11}`) || k?.startsWith(`status/${F11}`),
      ),
    ).toBe(false);
  });

  it("does not take a stray object under parts/ for a part", async () => {
    const w = world({ "parts/readme.txt": { text: "x", uploaded: OLD_DATE } });
    await daily(w, 0, 40);
    expect(w.r2.objects.has("parts/readme.txt")).toBe(true);
  });
});

describe("runPartsCleanup: 30 days in a row", () => {
  it("marks everything on its first run and deletes nothing", async () => {
    const w = world();
    const s = await w.run(0);
    expect(s).toMatchObject({ state: "done", deleted: 0, due: 0 });
    expect(w.ledger()).toEqual({
      schema: 1,
      checked: day(0).toISOString(),
      since: { [part(9)]: day(0).toISOString() },
      outcomes: { [dayOf(0)]: "done" },
    });
  });

  it("does not delete a part uploaded 90 days ago and unnamed since yesterday; it does 30 days after it was first seen", async () => {
    const w = world();
    await daily(w, 0, 29);
    expect(w.r2.deleted).toEqual([]);
    const s = await w.run(30);
    expect(s).toMatchObject({
      state: "done",
      due: 1,
      deleted: 1,
      bytes: "orphan nine".length,
    });
    expect(w.r2.deleted).toEqual([part(9)]);
    expect(w.ledger()!.since).toEqual({});
  });

  it("does not delete a part R2 wrote less than 30 days ago, however long it has been unnamed", async () => {
    const w = world();
    await daily(w, 0, 20);
    // Written again on day 20 (the bucket's clock), as a build that found it missing would.
    w.r2.put(part(9), "orphan nine");
    expect(w.r2.objects.get(part(9))?.uploaded).toEqual(day(20));
    const s = await daily(w, 21, 49);
    expect(s.deleted).toBe(0);
    expect(w.r2.deleted).toEqual([]);
    await w.run(50);
    expect(w.r2.deleted).toEqual([part(9)]);
  });

  it("drops a part from the ledger when a list names it again, and counts from scratch when it is unnamed again", async () => {
    const w = world();
    await daily(w, 0, 20);
    w.r2.put(
      `catalog/${C}/es-419.json`,
      languageText("es-419", [1, 2, 9], ORIGINALS),
    );
    await w.run(21);
    expect(w.ledger()!.since).toEqual({});
    w.r2.put(
      `catalog/${C}/es-419.json`,
      languageText("es-419", [1, 2], ORIGINALS),
    );
    await daily(w, 22, 51);
    expect(w.r2.deleted).toEqual([]);
    expect(w.ledger()!.since[part(9)]).toBe(day(22).toISOString());
    await w.run(52);
    expect(w.r2.deleted).toEqual([part(9)]);
  });

  it("starts every count again when the last finished run is more than three days old", async () => {
    const w = world();
    await daily(w, 0, 20);
    // Off (or aborted) from day 21 to day 24.
    await w.run(25);
    expect(w.ledger()!.since[part(9)]).toBe(day(25).toISOString());
    await daily(w, 26, 54);
    expect(w.r2.deleted).toEqual([]);
    await w.run(55);
    expect(w.r2.deleted).toEqual([part(9)]);
  });

  it("keeps counting across a missed day or two", async () => {
    const w = world();
    await daily(w, 0, 10);
    await daily(w, 13, 30);
    expect(w.r2.deleted).toEqual([part(9)]);
  });

  it("counts again from today a first date that does not parse, so it cannot hold a part forever", async () => {
    const w = world({
      [LEDGER]: JSON.stringify({
        schema: 1,
        checked: day(-1).toISOString(),
        since: { [part(9)]: "soon" },
      }),
    });
    await w.run(0);
    expect(w.ledger()!.since[part(9)]).toBe(day(0).toISOString());
    await daily(w, 1, 30);
    expect(w.r2.deleted).toEqual([part(9)]);
  });

  it("reads a ledger that does not parse as none: counting starts again, nothing is deleted", async () => {
    const w = world({ [LEDGER]: "{not json" });
    const s = await w.run(40);
    expect(s).toMatchObject({ state: "done", deleted: 0 });
    expect(w.ledger()!.since[part(9)]).toBe(day(40).toISOString());
  });
});

describe("runPartsCleanup: a partial view never deletes", () => {
  async function ready() {
    const w = world();
    await daily(w, 0, 29);
    return w;
  }

  /** Nothing deleted, the counts as they were; only the day's outcome is recorded. */
  function unchanged(
    w: ReturnType<typeof world>,
    before: ReturnType<ReturnType<typeof world>["counts"]>,
  ) {
    expect(w.r2.deleted).toEqual([]);
    expect(w.counts()).toEqual(before);
    expect(w.ledger()!.outcomes![dayOf(30)]).toBe("aborted");
  }

  it("aborts when a list cannot be read, and leaves the counts as they were", async () => {
    const w = await ready();
    const before = w.counts();
    w.r2.fail.push(
      (op, key) => op === "get" && key === `catalog/${C}/es-419.json`,
    );
    const s = await w.run(30);
    expect(s.state).toBe("aborted");
    expect(s.why).toContain("es-419.json");
    unchanged(w, before);
    expect(w.points.at(-1)).toEqual(["pack", "cleanup", "delete", "aborted"]);
  });

  it.each([
    ["a list that does not parse", `catalog/${C}/es-419.json`, "{"],
    [
      "a list with no parts",
      `catalog/${C}/es-419.json`,
      JSON.stringify({ schema: 2 }),
    ],
    [
      "a part without a sha256",
      `catalog/${C}/es-419.json`,
      JSON.stringify({ parts: [{ bytes: 1 }] }),
    ],
    [
      "an originals list named by path only",
      `catalog/${C}/es-419.json`,
      JSON.stringify({ parts: [], originals: { path: "x" } }),
    ],
    [
      "originals.json that does not parse",
      `catalog/${C}/originals.json`,
      "nope",
    ],
    [
      "a list in an older parts compat that does not parse",
      `catalog/${OLD}/fr.json`,
      "{",
    ],
  ])("aborts on %s", async (_name, key, text) => {
    const w = await ready();
    const before = w.counts();
    w.r2.put(key, text, OLD_DATE);
    expect((await w.run(30)).state).toBe("aborted");
    unchanged(w, before);
  });

  it("aborts when the originals list a language names is missing", async () => {
    const w = await ready();
    const before = w.counts();
    w.r2.objects.delete(`catalog/${C}/originals/${hash(ORIGINALS)}.json`);
    expect((await w.run(30)).state).toBe("aborted");
    unchanged(w, before);
  });

  it.each([
    "catalog/",
    "status/",
    "parts/",
    `catalog/${C}/`,
    `catalog/${C}/originals/`,
    `status/${C}/`,
  ])("aborts when listing %s fails", async (prefix) => {
    const w = await ready();
    const before = w.counts();
    w.r2.fail.push((op, key) => op === "list" && key === prefix);
    expect((await w.run(30)).state).toBe("aborted");
    unchanged(w, before);
  });

  it("aborts, deleting nothing, when a run would need more than its R2 calls", async () => {
    const extra: Record<string, string> = {};
    for (let n = 0; n < CLEANUP_R2_CALLS; n++) {
      extra[`status/${C}/l${n}.json`] = JSON.stringify({
        state: "ok",
        at: "2026-09-01T00:00:00Z",
        failures: 0,
      });
    }
    const w = world(extra);
    const s = await w.run(0);
    expect(s).toMatchObject({ state: "aborted", deleted: 0 });
    expect(s.why).toContain(`${CLEANUP_R2_CALLS} R2 calls`);
    expect(w.r2.ops.filter((op) => op.op !== "put").length).toBeLessThanOrEqual(
      CLEANUP_R2_CALLS,
    );
    // Only the day's outcome: no first date, no finished run.
    expect(w.ledger()).toEqual({
      schema: 1,
      since: {},
      outcomes: { [dayOf(0)]: "aborted" },
    });
  });
});

describe("runPartsCleanup: builds", () => {
  const running = (at: Date) =>
    JSON.stringify({
      state: "running",
      at: at.toISOString(),
      failures: 0,
      run: "dispatched",
    });

  it("is postponed while a parts build is running, and leaves the counts as they were", async () => {
    const w = world();
    await daily(w, 0, 29);
    const before = w.counts();
    w.r2.put(
      `status/${C}/es-419.json`,
      running(new Date(day(30).getTime() - 3_600_000)),
    );
    const s = await w.run(30);
    expect(s).toMatchObject({ state: "postponed", deleted: 0 });
    expect(s.why).toContain(`status/${C}/es-419.json`);
    expect(w.counts()).toEqual(before);
    expect(w.ledger()!.outcomes![dayOf(30)]).toBe("postponed");
    expect(w.points.at(-1)).toEqual(["pack", "cleanup", "delete", "postponed"]);
  });

  it("is postponed by a running build of a parts compat that has no list yet", async () => {
    const w = world({
      [`status/f2.1-u2.3.0-p6000230-q9-a12-t1/es-419.json`]: running(day(0)),
    });
    expect((await w.run(0)).state).toBe("postponed");
  });

  it("is not held by a running f1.1 build, nor by a parts status `running` 6 h old (the guard calls it dead)", async () => {
    const w = world({
      [`status/${F11}/es-419.json`]: running(day(30)),
    });
    await daily(w, 0, 29);
    w.r2.put(
      `status/${C}/es-419.json`,
      running(new Date(day(30).getTime() - 6 * 3_600_000)),
    );
    const s = await w.run(30);
    expect(s).toMatchObject({ state: "done", deleted: 1 });
  });

  it("aborts when a build starts between the first look and the deletes", async () => {
    const w = world();
    await daily(w, 0, 29);
    const before = w.counts();
    let started = false;
    w.r2.before.push((op, key) => {
      if (!started && op === "list" && key === "parts/") {
        started = true;
        w.r2.put(`status/${C}/en.json`, running(day(30)));
      }
    });
    const s = await w.run(30);
    expect(s.state).toBe("aborted");
    expect(s.why).toContain(`status/${C}/en.json is running`);
    expect(w.r2.deleted).toEqual([]);
    expect(w.counts()).toEqual(before);
  });

  it.each([
    [
      "rewritten",
      (w: ReturnType<typeof world>) =>
        w.r2.put(
          `catalog/${C}/es-419.json`,
          languageText("es-419", [1, 2, 9], ORIGINALS),
        ),
    ],
    [
      "added",
      (w: ReturnType<typeof world>) =>
        w.r2.put(`catalog/${C}/en.json`, languageText("en", [9], ORIGINALS)),
    ],
    [
      "removed",
      (w: ReturnType<typeof world>) =>
        void w.r2.objects.delete(`catalog/${C}/es-419.json`),
    ],
    [
      "a new parts compat",
      (w: ReturnType<typeof world>) =>
        w.r2.put(`catalog/f2.1-u2.3.0-p6000230-q9-a12-t1/en.json`, "{}"),
    ],
  ])(
    "aborts when a list is %s between the read and the delete",
    async (_what, change) => {
      const w = world();
      await daily(w, 0, 29);
      const before = w.counts();
      let done = false;
      w.r2.before.push((op, key) => {
        if (!done && op === "list" && key === "parts/") {
          done = true;
          change(w);
        }
      });
      const s = await w.run(30);
      expect(s.state).toBe("aborted");
      expect(w.r2.deleted).toEqual([]);
      expect(w.counts()).toEqual(before);
    },
  );

  it("logs the language when a build starts during the deletes, so a person can rebuild it", async () => {
    const w = world();
    await daily(w, 0, 29);
    w.r2.before.push((op) => {
      if (op === "delete") w.r2.put(`status/${C}/en.json`, running(day(30)));
    });
    const errors: string[] = [];
    const error = console.error;
    console.error = (line: string) => void errors.push(String(line));
    try {
      expect(await w.run(30)).toMatchObject({ state: "done", deleted: 1 });
    } finally {
      console.error = error;
    }
    expect(errors.join("\n")).toContain(
      `status/${C}/en.json started during the deletes`,
    );
  });
});

describe("runPartsCleanup: the open windows, documented", () => {
  const running = (at: Date) =>
    JSON.stringify({
      state: "running",
      at: at.toISOString(),
      failures: 0,
      run: "dispatched",
    });

  /** Runs `fn` with console.error and console.log captured. */
  async function quiet<T>(fn: () => Promise<T>) {
    const errors: string[] = [];
    const logs: string[] = [];
    const error = console.error;
    const log = console.log;
    console.error = (line: string) => void errors.push(String(line));
    console.log = (line: string) => void logs.push(String(line));
    try {
      return { result: await fn(), errors, logs };
    } finally {
      console.error = error;
      console.log = log;
    }
  }

  it("a list written after the recheck and before the delete cannot stop it, but is named in an error after it", async () => {
    const w = world();
    await daily(w, 0, 29);
    // The window the recheck leaves: a build that found part 9 present writes a list naming it right then.
    w.r2.before.push((op) => {
      if (op === "delete") {
        w.r2.put(`catalog/${C}/en.json`, languageText("en", [9], ORIGINALS));
      }
    });
    const { result, errors } = await quiet(() => w.run(30));
    expect(result).toMatchObject({ state: "done", deleted: 1 });
    expect(w.r2.deleted).toEqual([part(9)]);
    expect(errors.join("\n")).toContain(
      `catalog/${C}/en.json names 1 deleted key (${part(9)})`,
    );
  });

  it("a list rewritten after the deletes that names nothing deleted raises no error", async () => {
    const w = world();
    await daily(w, 0, 29);
    w.r2.before.push((op) => {
      if (op === "delete") {
        w.r2.put(`catalog/${C}/en.json`, languageText("en", [1], ORIGINALS));
      }
    });
    const { result, errors } = await quiet(() => w.run(30));
    expect(result).toMatchObject({ state: "done", deleted: 1 });
    expect(errors).toEqual([]);
  });

  it("an originals list a new list names, unnamed before, is read for deleted parts too", async () => {
    const other = originalsText([9]);
    const w = world({
      [`catalog/${C}/originals/${hash(other)}.json`]: {
        text: other,
        uploaded: day(1),
      },
    });
    await daily(w, 0, 29);
    w.r2.before.push((op) => {
      if (op === "delete") {
        w.r2.put(`catalog/${C}/en.json`, languageText("en", [1], other));
      }
    });
    const { result, errors } = await quiet(() => w.run(30));
    // Part 9 was due; the unnamed originals list naming it was not (R2 wrote it on day 1).
    expect(result).toMatchObject({ state: "done", deleted: 1 });
    expect(errors.join("\n")).toContain(
      `catalog/${C}/en.json names 1 deleted key (${part(9)})`,
    );
  });

  it("a status turned running after the recheck is named after the deletes (the same window)", async () => {
    const w = world();
    await daily(w, 0, 29);
    w.r2.before.push((op) => {
      if (op === "delete") w.r2.put(`status/${C}/fr.json`, running(day(30)));
    });
    const { result, errors } = await quiet(() => w.run(30));
    expect(result).toMatchObject({ state: "done", deleted: 1 });
    expect(errors.join("\n")).toContain(
      `status/${C}/fr.json started during the deletes`,
    );
  });

  it("a running status dated in the future postpones, as the dispatch guard reads it", async () => {
    const w = world();
    await daily(w, 0, 29);
    w.r2.put(
      `status/${C}/es-419.json`,
      running(new Date(day(30).getTime() + 3_600_000)),
    );
    const { result } = await quiet(() => w.run(30));
    expect(result).toMatchObject({ state: "postponed", deleted: 0 });
  });

  it("a running status is a build until RUNNING_STALE_MS (5.5 h) has passed, and dead from then on", async () => {
    for (const [age, state] of [
      [RUNNING_STALE_MS - 1, "postponed"],
      [RUNNING_STALE_MS, "done"],
    ] as const) {
      const w = world();
      await daily(w, 0, 29);
      w.r2.put(
        `status/${C}/es-419.json`,
        running(new Date(day(30).getTime() - age)),
      );
      const { result } = await quiet(() => w.run(30));
      expect(result.state).toBe(state);
    }
    expect(RUNNING_STALE_MS).toBe(5.5 * 3_600_000);
  });

  it("two cleanups at once delete only the due orphan, and leave one consistent ledger", async () => {
    const w = world();
    await daily(w, 0, 29);
    w.r2.setNow(day(30));
    const { result } = await quiet(() =>
      Promise.all([
        runPartsCleanup(w.env, { now: day(30), mode: "delete" }),
        runPartsCleanup(w.env, { now: day(30), mode: "delete" }),
      ]),
    );
    expect(result.map((r) => r.state)).toEqual(["done", "done"]);
    expect(w.r2.deleted).toEqual([part(9)]);
    for (const n of [1, 2, 101, 102])
      expect(w.r2.objects.has(part(n))).toBe(true);
    expect(w.ledger()).toMatchObject({
      checked: day(30).toISOString(),
      since: {},
    });
    expect((await quiet(() => w.run(31))).result).toMatchObject({
      state: "done",
      orphans: 0,
      deleted: 0,
    });
  });

  it("a ledger write that fails after the deletes: aborted with the deletes reported, and the next run drops them", async () => {
    const w = world();
    await daily(w, 0, 29);
    w.r2.fail.push((op, key) => op === "put" && key === LEDGER);
    const { result, logs } = await quiet(() => w.run(30));
    expect(result).toMatchObject({ state: "aborted", deleted: 1 });
    expect(result.why).toContain(`writing ${LEDGER} failed after deleting 1`);
    expect(logs.join("\n")).toContain("aborted, writing");
    expect(w.r2.deleted).toEqual([part(9)]);
    // The old ledger still has part 9's first date; it is gone from the bucket, so the next run drops it.
    expect(w.ledger()!.since[part(9)]).toBe(day(0).toISOString());
    w.r2.fail.length = 0;
    const next = (await quiet(() => w.run(31))).result;
    expect(next).toMatchObject({ state: "done", orphans: 0, deleted: 0 });
    expect(w.ledger()!.since).toEqual({});
  });
});

describe("runPartsCleanup: the day's outcome and the alert", () => {
  async function quiet<T>(fn: () => Promise<T>) {
    const errors: string[] = [];
    const error = console.error;
    const log = console.log;
    console.error = (line: string) => void errors.push(String(line));
    console.log = () => {};
    try {
      return { result: await fn(), errors };
    } finally {
      console.error = error;
      console.log = log;
    }
  }
  const alerts = (errors: string[]) =>
    errors.filter((e) => e.startsWith("[packs] cleanup-alert:"));

  it("records each day's outcome, keeps a week of them, and cleanupOutcome reads the day's", async () => {
    const w = world();
    await quiet(() => daily(w, 0, 9));
    expect(Object.keys(w.ledger()!.outcomes!).sort()).toEqual(
      [3, 4, 5, 6, 7, 8, 9].map(dayOf),
    );
    expect(await cleanupOutcome(w.env, dayOf(9))).toBe("done");
    expect(await cleanupOutcome(w.env, dayOf(10))).toBeNull();
    w.r2.put(
      `status/${C}/es-419.json`,
      JSON.stringify({ state: "running", at: day(10).toISOString() }),
    );
    await quiet(() => w.run(10));
    expect(await cleanupOutcome(w.env, dayOf(10))).toBe("postponed");
  });

  it("reads no outcome from a bucket it cannot read or a ledger that does not parse", async () => {
    const w = world({ [LEDGER]: "{" });
    expect(await cleanupOutcome(w.env, dayOf(0))).toBeNull();
    w.r2.fail.push((op) => op === "get");
    expect(await cleanupOutcome(w.env, dayOf(0))).toBeNull();
    expect(await cleanupOutcome({}, dayOf(0))).toBeNull();
  });

  it(`alerts with a stable tag on the ${ABORT_ALERT_DAYS}rd day in a row that ends aborted, not before`, async () => {
    const w = world();
    await quiet(() => daily(w, 0, 29));
    w.r2.fail.push(
      (op, key) => op === "get" && key === `catalog/${C}/es-419.json`,
    );
    const runs = [];
    for (const n of [30, 31, 32, 33]) runs.push(await quiet(() => w.run(n)));
    expect(runs.map((r) => alerts(r.errors).length)).toEqual([0, 0, 1, 1]);
    expect(alerts(runs[2]!.errors)[0]).toContain(
      `aborted ${ABORT_ALERT_DAYS} days in a row (since ${dayOf(30)})`,
    );
    expect(alerts(runs[3]!.errors)[0]).toContain("aborted 4 days in a row");
  });

  it("a day that ends done (a retry) or a day without a run breaks the streak", async () => {
    const w = world();
    await quiet(() => daily(w, 0, 29));
    const broken = (op: string, key: string) =>
      op === "get" && key === `catalog/${C}/es-419.json`;
    w.r2.fail.push(broken);
    await quiet(() => w.run(30));
    await quiet(() => w.run(31));
    // Day 31's retry finishes it.
    w.r2.fail.length = 0;
    await quiet(() => w.run(31));
    w.r2.fail.push(broken);
    const day32 = await quiet(() => w.run(32));
    expect(alerts(day32.errors)).toEqual([]);
    // Day 34 with no run on day 33.
    await quiet(() => w.run(33));
    w.r2.objects.set(LEDGER, {
      ...w.r2.objects.get(LEDGER)!,
      text: JSON.stringify({
        ...w.ledger(),
        outcomes: { [dayOf(32)]: "aborted", [dayOf(34)]: "aborted" },
      }),
    });
    const day35 = await quiet(() => w.run(35));
    expect(alerts(day35.errors)).toEqual([]);
  });
});

describe("runPartsCleanup: modes and limits", () => {
  it("in dry-run deletes nothing, writes the ledger, and says what it would delete", async () => {
    const w = world();
    const logs: string[] = [];
    const log = console.log;
    console.log = (line: string) => void logs.push(String(line));
    let s;
    try {
      for (let n = 0; n <= 30; n++) s = await w.run(n, "dry-run");
    } finally {
      console.log = log;
    }
    expect(s).toMatchObject({
      state: "done",
      due: 1,
      deleted: 0,
      bytes: "orphan nine".length,
    });
    expect(w.r2.deleted).toEqual([]);
    expect(w.r2.ops.some((op) => op.op === "delete")).toBe(false);
    expect(w.ledger()!.since[part(9)]).toBe(day(0).toISOString());
    expect(logs.at(-1)).toMatch(
      /^\[packs\] cleanup \(dry-run\): done; 5 named, 1 unnamed, 1 due; would delete 1 \(0\.0 MB\)/,
    );
    expect(w.points.at(-1)).toEqual(["pack", "cleanup", "dry-run", "done"]);
    // The 30 days counted in dry-run hold when it turns to delete.
    expect((await w.run(31, "delete")).deleted).toBe(1);
  });

  it("deletes at most 1000 keys a run, in one call, and leaves the rest for the next run", async () => {
    const extra: Record<string, { text: string; uploaded: Date }> = {};
    for (let n = 1000; n < 2500; n++)
      extra[part(n)] = { text: "x", uploaded: OLD_DATE };
    const w = world(extra);
    await daily(w, 0, 29);
    const s = await w.run(30);
    expect(s).toMatchObject({ state: "done", due: 1501, deleted: MAX_DELETES });
    expect(w.r2.ops.filter((op) => op.op === "delete")).toHaveLength(1);
    expect(Object.keys(w.ledger()!.since)).toHaveLength(501);
    const next = await w.run(31);
    expect(next).toMatchObject({ due: 501, deleted: 501 });
    expect(w.r2.deleted).toHaveLength(1501);
  });

  it("pages through R2's listings", async () => {
    const extra: Record<string, { text: string; uploaded: Date }> = {};
    for (let n = 1000; n < 1010; n++)
      extra[part(n)] = { text: "x", uploaded: OLD_DATE };
    const objects = world(extra).r2.objects;
    const paged = fakeR2(
      Object.fromEntries(
        [...objects].map(([key, o]) => [
          key,
          { text: o.text, uploaded: o.uploaded },
        ]),
      ),
      { pageSize: 3 },
    );
    for (let n = 0; n <= 30; n++) {
      await runPartsCleanup(
        { LANGUAGE_PACKS: paged.bucket },
        { now: day(n), mode: "delete" },
      );
    }
    expect(paged.deleted).toHaveLength(11);
    expect(paged.ops.some((op) => (op.o as { cursor?: string })?.cursor)).toBe(
      true,
    );
  });
});

describe("runScheduled runs the cleanup", () => {
  const cron = (
    w: ReturnType<typeof world>,
    which: string,
    when: Date,
    env: Partial<CleanupEnv & { PACKS_CLEANUP: string }> = {},
  ) => {
    w.r2.setNow(when);
    return runScheduled(
      { ...w.env, TRANSLATION_HELPS_CACHE: fakeKv().kv, ...env },
      {} as ExecutionContext,
      { cron: which, scheduledTime: when.getTime(), now: when },
    );
  };

  it("on the 03:07 cron, in the PACKS_CLEANUP mode, with the real cleanup", async () => {
    const w = world();
    await cron(w, CLEANUP_CRON, day(0), { PACKS_CLEANUP: "dry-run" });
    expect(w.ledger()!.since).toEqual({ [part(9)]: day(0).toISOString() });
    expect(w.points.at(-1)).toEqual(["pack", "cleanup", "dry-run", "done"]);
  });

  it("not at all when PACKS_CLEANUP is unset", async () => {
    const w = world();
    await cron(w, CLEANUP_CRON, day(0));
    await cron(w, CLEANUP_RETRY_CRON, new Date(day(0).getTime() + 3_600_000));
    expect(w.r2.ops).toEqual([]);
  });

  it("again on a retry cron when the day's run was postponed, and not once it is done", async () => {
    const w = world({
      [`status/${C}/en.json`]: JSON.stringify({
        state: "running",
        at: day(0).toISOString(),
      }),
    });
    const env = { PACKS_CLEANUP: "delete" };
    const hour = (h: number) => new Date(day(0).getTime() + h * 3_600_000);
    const log = console.log;
    console.log = () => {};
    try {
      await cron(w, CLEANUP_CRON, day(0), env);
      expect(w.ledger()!.outcomes).toEqual({ [dayOf(0)]: "postponed" });
      // The build ends before 04:07.
      w.r2.put(
        `status/${C}/en.json`,
        JSON.stringify({ state: "ok", at: hour(0.5).toISOString() }),
      );
      await cron(w, CLEANUP_RETRY_CRON, hour(1), env);
      expect(w.ledger()!.outcomes).toEqual({ [dayOf(0)]: "done" });
      const calls = w.r2.ops.length;
      await cron(w, CLEANUP_RETRY_CRON, hour(2), env);
      // One read of the ledger, nothing else.
      expect(w.r2.ops.slice(calls)).toEqual([{ op: "get", key: LEDGER }]);
    } finally {
      console.log = log;
    }
  });
});
