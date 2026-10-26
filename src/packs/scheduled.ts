/**
 * The packs crons (delivery 3, Decision 8, review 7-8). Each job has a cron string of its own, and the handler picks
 * the job by `event.cron`, so every job is its own invocation with its own limits:
 *
 * - `17 6 * * *`: the f1.1 sweep, exactly as the daily cron always ran it (`runDailySweep`), unless `PACKS_SWEEP` is
 *   `parts` (staging, which never swept f1.1);
 * - `7 3 * * *`: the parts cleanup, when `PACKS_CLEANUP` is `dry-run` or `delete` (anything else is off);
 * - `7 4,5 * * *`: the cleanup again, only when the day's run was postponed or aborted (the ledger records each day's
 *   outcome); a day with no outcome at all is not retried but logged under `[packs] cleanup-alert:`. One cron string
 *   for both retries: the Free plan allows 5 cron triggers in the whole account;
 * - `37 * * * *`: the parts languages whose `fnv1a32(language) % 24` is the hour, so each is checked once a day and
 *   the Door43 and GitHub requests are spread across the day. Only while parts dispatch is on: a check that may not
 *   ask for a build reads nothing.
 *
 * Any other cron string does nothing but say so in the log. Each job is wrapped so that a failure stops only itself.
 *
 * Subrequests. The account's Workers plan is not known here, so a run is kept under the Free plan's limits per
 * invocation, 50 fetches outside Cloudflare and 1,000 calls to KV and R2 (Paid allows 10,000 of each by default). A
 * parts check fetches at most: the language's catalog search (1), UHB and UGNT (2) and MACULA (2, plus a token mint),
 * which are cached in KV for the hour and so are paid by the run's first check only, the two lexicons (4), and a
 * dispatch (a token mint and the POST, twice when GitHub refuses a cached token: 4). That is at most 14 for the
 * first check and 9 for each other one, so `PARTS_CHECKS_PER_RUN = 5` checks stay at 50 or fewer. The search always
 * asks Door43, past the catalog cache, and a shared reading with an input left out is kept 10 minutes, so a run
 * still reads it once. KV and R2: about 26 calls a check (the hour, the list, the shared readings and the token, the
 * builder file and the status, one bulk read of the first-seen records, which KV counts as one call, and a
 * dispatch), plus one KV write for each change the Worker sees for the first time, once per key and stamp in the
 * whole Worker, and the code budget, read once and written once a run. Five checks are about 130. A slice with more
 * than five languages checks five of them, the next five each day (so each of k languages at least every
 * ceil(k / 5) days), and the rest are still checked by the phones that open them. `PARTS_CHECKS_PER_RUN` changes the
 * five (on a Paid plan it can be raised). The f1.1 sweep stays one daily loop, as before, and the cleanup counts its own R2 calls
 * (`src/packs/cleanup.ts`). Going over a limit is not a disaster either: the call that goes over throws, and every
 * check and the cleanup turn a thrown call into an unreadable input, "unknown", "error" or "aborted".
 */

import {
  CURRENT_PARTS_COMPAT,
  partsDispatchEnabled,
  requestBuild,
} from "./dispatch.js";
import {
  checkFreshness,
  publishedLanguages,
  runDailySweep,
  type FreshnessEnv,
} from "./freshness.js";
import {
  checkPartsFreshness,
  type PartsCheck,
  type PartsListLite,
} from "./partsFreshness.js";
import {
  ALERT_TAG,
  LEDGER,
  cleanupOutcome,
  runPartsCleanup,
} from "./cleanup.js";
import type { observeParts } from "./partsSources.js";

export type ScheduledEnv = FreshnessEnv & {
  /** `parts`: the cron sweeps parts only, never f1.1 (staging). Anything else, or unset, sweeps both. */
  PACKS_SWEEP?: string;
  /** `dry-run` or `delete` runs the parts cleanup at 03 UTC; anything else, or unset, is off. */
  PACKS_CLEANUP?: string;
  /** Parts checks in one run of the parts slice: a whole number, 0 for none; unset or anything else is 5. */
  PARTS_CHECKS_PER_RUN?: string;
};

export type CleanupMode = "dry-run" | "delete";

/** The f1.1 sweep's cron, the one it has always had. */
export const F11_SWEEP_CRON = "17 6 * * *";
export const CLEANUP_CRON = "7 3 * * *";
/** 04:07 and 05:07 UTC: runs the cleanup only when the day's was postponed or aborted. */
export const CLEANUP_RETRY_CRON = "7 4,5 * * *";
export const PARTS_SLICE_CRON = "37 * * * *";
/** Every cron string this Worker has a job for. */
export const PACKS_CRONS: readonly string[] = [
  F11_SWEEP_CRON,
  CLEANUP_CRON,
  CLEANUP_RETRY_CRON,
  PARTS_SLICE_CRON,
];
/** Code-only rebuilds the sweep may ask for in a day (Decision 7): a code bump reaches 100 languages in ten days. */
export const CODE_REBUILDS_PER_DAY = 10;
/** Parts checks in one run by default, so that a run stays within the Free plan's 50 outside fetches (see above). */
export const PARTS_CHECKS_PER_RUN = 5;
const COUNTER_TTL_S = 2 * 24 * 3600;
const DAY_MS = 24 * 3_600_000;

/**
 * `PARTS_CHECKS_PER_RUN`: digits only, as the parts daily cap reads its own (0 checks none); unset, empty or anything
 * else (`1e2`, `5.0`, ` 7`) is the default, so a typo can neither lift the cap nor stop the checks.
 */
export function checksPerRun(raw: string | undefined): number {
  return raw !== undefined && /^\d+$/.test(raw)
    ? Number(raw)
    : PARTS_CHECKS_PER_RUN;
}

/** The standard 32-bit FNV-1a, a copy of tc-study language-pack `parts/partSlots.ts` `fnv1a32`. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The UTC hour whose run checks this parts language. */
export function partsHourOf(language: string): number {
  return fnv1a32(language) % 24;
}

/** `dry-run` and `delete` exactly; anything else (unset, a typo) is off, so a typo can never delete. */
export function cleanupMode(raw: string | undefined): CleanupMode | null {
  return raw === "dry-run" || raw === "delete" ? raw : null;
}

export type ScheduledDeps = {
  /** The cron string that fired (`ScheduledController.cron`): it picks the job. */
  cron?: string;
  /** The cron's own time (`ScheduledController.scheduledTime`): it picks the hour and the day, even when late. */
  scheduledTime?: number | Date;
  /** The clock of the checks and of the code budget's day. Unset in production, as the f1.1 sweep always had it. */
  now?: Date;
  requestBuild?: typeof requestBuild;
  checkFreshness?: typeof checkFreshness;
  checkPartsFreshness?: typeof checkPartsFreshness;
  observe?: typeof observeParts;
  cleanup?: (
    env: ScheduledEnv,
    o: { now?: Date; mode: CleanupMode; day: string },
  ) => Promise<unknown>;
};

export async function runScheduled(
  env: ScheduledEnv,
  ctx: ExecutionContext,
  deps: ScheduledDeps = {},
): Promise<void> {
  const at = new Date(deps.scheduledTime ?? deps.now ?? Date.now());
  switch (deps.cron) {
    case F11_SWEEP_CRON:
      return runF11Sweep(env, ctx, deps);
    case CLEANUP_CRON:
      return runCleanup(env, at, deps, false);
    case CLEANUP_RETRY_CRON:
      return runCleanup(env, at, deps, true);
    case PARTS_SLICE_CRON:
      try {
        await runPartsSweep(env, ctx, at, deps);
      } catch (err) {
        console.error(`[packs] parts sweep stopped:`, err);
      }
      return;
    default:
      // Loud, with a stable prefix to alert on: a cron in wrangler.toml with no job here runs nothing. No guess from
      // the clock: it could run the cleanup or a sweep at the wrong time.
      console.error(
        `[packs] cron-unknown: ${JSON.stringify(deps.cron ?? null)} is none of the packs jobs (${PACKS_CRONS.join(", ")}); nothing done`,
      );
  }
}

async function runF11Sweep(
  env: ScheduledEnv,
  ctx: ExecutionContext,
  deps: ScheduledDeps,
): Promise<void> {
  if (env.PACKS_SWEEP === "parts") {
    console.log(`[packs] f1.1 sweep: off here (PACKS_SWEEP = parts)`);
    return;
  }
  try {
    // The same call the daily cron made, with the same defaults.
    await runDailySweep(env, ctx, {
      requestBuild: deps.requestBuild,
      checkFreshness: deps.checkFreshness,
      now: deps.now,
    });
  } catch (err) {
    console.error(`[packs] f1.1 sweep stopped:`, err);
  }
}

async function runCleanup(
  env: ScheduledEnv,
  at: Date,
  deps: ScheduledDeps,
  retry: boolean,
): Promise<void> {
  const mode = cleanupMode(env.PACKS_CLEANUP);
  if (!mode) return;
  const day = at.toISOString().slice(0, 10);
  try {
    if (retry) {
      const outcome = await cleanupOutcome(env, day);
      if (!outcome) {
        // Every run that ends records its outcome, so none means the 03:07 run never ended (the runtime killed it,
        // over its CPU or memory, before it could write), never started, or could not write the ledger (its put
        // failed, and failed again when the stop was recorded); or this read of the ledger failed. Still not retried
        // (a missing outcome only delays the cleanup), but loud, under the cleanup's alert tag: otherwise it could
        // fail silently every day.
        console.error(
          `${ALERT_TAG} no outcome recorded for ${day}: the 03:07 UTC cleanup (${mode}) was killed, did not fire, or could not read or write ${LEDGER}; not retried`,
        );
        return;
      }
      if (outcome === "done") {
        console.log(
          `[packs] cleanup (${mode}) retry: the day's cleanup was done; nothing to retry`,
        );
        return;
      }
      console.log(
        `[packs] cleanup (${mode}) retry: the day's cleanup was ${outcome}`,
      );
    }
    await (deps.cleanup ?? runPartsCleanup)(env, { now: deps.now, mode, day });
  } catch (err) {
    console.error(`[packs] cleanup stopped:`, err);
  }
}

async function runPartsSweep(
  env: ScheduledEnv,
  ctx: ExecutionContext,
  at: Date,
  deps: ScheduledDeps,
): Promise<void> {
  const hour = at.getUTCHours();
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket || !partsDispatchEnabled(env)) return;
  const compat = CURRENT_PARTS_COMPAT;
  const slice: string[] = [];
  for await (const language of publishedLanguages(bucket, compat, {
    delimiter: "/",
  })) {
    if (partsHourOf(language) === hour) slice.push(language);
  }
  if (!slice.length) return;

  const kv = env.TRANSLATION_HELPS_CACHE;
  // The schedule's day, not the clock's: a 23:37 run that starts after midnight keeps its day's turn and budget.
  const day = at.toISOString().slice(0, 10);
  const perRun = checksPerRun(env.PARTS_CHECKS_PER_RUN);
  // A slice over the cap starts each day perRun further along (sorted, as a ring), so each of its k languages is
  // checked at least every ceil(k / perRun) days.
  const sorted = [...slice].sort();
  const k = sorted.length;
  const offset =
    k > perRun ? (Math.floor(at.getTime() / DAY_MS) * perRun) % k : 0;
  const ordered = [...sorted.slice(offset), ...sorted.slice(0, offset)];
  const checked = ordered.slice(0, perRun);
  const left = ordered.slice(perRun);
  const budget = codeBudgetOf(kv, `packs:code-rebuilds:${day}`);
  const check = deps.checkPartsFreshness ?? checkPartsFreshness;
  const results: string[] = [];
  for (const language of checked) {
    let askedForCode = false;
    try {
      const result: PartsCheck = await check({
        env,
        ctx,
        compat,
        language,
        list: () => readPartsList(bucket, compat, language),
        now: deps.now,
        reason: "daily",
        ...(deps.observe ? { observe: deps.observe } : {}),
        ...(deps.requestBuild ? { requestBuild: deps.requestBuild } : {}),
        // Asked only for a code-only change; spent only when that change was dispatched (below).
        codeBudget: async () => {
          askedForCode = true;
          return budget.left();
        },
      });
      if (askedForCode && result === "dispatched") budget.spend();
      results.push(`${language} ${result}`);
    } catch (err) {
      console.error(`[packs] parts sweep of ${language} failed:`, err);
      results.push(`${language} error`);
    }
  }
  await budget.save();
  console.log(
    `[packs] parts sweep ${String(hour).padStart(2, "0")} UTC: ${results.join(", ")}` +
      (left.length
        ? `; ${left.length} left for another day (${left.join(", ")})`
        : ""),
  );
}

async function readPartsList(
  bucket: R2Bucket,
  compat: string,
  language: string,
): Promise<PartsListLite | null> {
  const object = await bucket.get(`catalog/${compat}/${language}.json`);
  if (!object) return null;
  try {
    return JSON.parse(await object.text()) as PartsListLite;
  } catch {
    return null;
  }
}

/**
 * The day's code budget for one run: the counter is read once, when a check first asks, spent in memory, and written
 * back once at the end, only if the run spent some. One parts slice runs an hour, so no other run spends it meanwhile
 * (a phone's `code` rebuild counts against the parts cap, not this budget). A counter that cannot be read leaves no
 * budget for this run: code rebuilds are never urgent, and an unread counter could otherwise allow ten every hour.
 */
function codeBudgetOf(kv: KVNamespace, key: string) {
  let spent: number | undefined;
  let read: Promise<number> | undefined;
  let dirty = false;
  const load = () =>
    (read ??= (async () => {
      try {
        return Number.parseInt((await kv.get(key)) ?? "0", 10) || 0;
      } catch (err) {
        console.error(
          `[packs] code budget ${key} unreadable; no code rebuild this run:`,
          err,
        );
        return CODE_REBUILDS_PER_DAY;
      }
    })());
  return {
    async left(): Promise<boolean> {
      spent ??= await load();
      return spent < CODE_REBUILDS_PER_DAY;
    },
    spend(): void {
      spent = (spent ?? 0) + 1;
      dirty = true;
    },
    /** Best effort, as the dispatch cap: KV is eventually consistent. */
    async save(): Promise<void> {
      if (!dirty) return;
      try {
        await kv.put(key, String(spent), { expirationTtl: COUNTER_TTL_S });
      } catch (err) {
        console.error(`[packs] code budget ${key} not saved:`, err);
      }
    },
  };
}
