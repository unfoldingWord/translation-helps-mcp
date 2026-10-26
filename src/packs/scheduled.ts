/**
 * The hourly cron (delivery 3, Decision 8). Each run does at most three things, each wrapped so that a failure stops
 * only itself:
 *
 * - at 06 UTC, the f1.1 sweep, exactly as the daily cron ran it before (`runDailySweep`), unless `PACKS_SWEEP` is
 *   `parts` (staging, which never swept f1.1);
 * - at 03 UTC, the parts cleanup, when `PACKS_CLEANUP` is `dry-run` or `delete` (anything else is off);
 * - every hour, the parts languages whose `fnv1a32(language) % 24` is the hour, so each is checked once a day and the
 *   Door43 and GitHub requests are spread across the day. Only while parts dispatch is on: a check that may not ask
 *   for a build reads nothing.
 *
 * Subrequests. The account's Workers plan is not known here, so a run is kept under the Free plan's limits per
 * invocation, 50 fetches outside Cloudflare and 1,000 calls to KV and R2 (Paid allows 10,000 of each by default). A
 * parts check fetches at most: the language's catalog search (1), UHB and UGNT (2) and MACULA (2, plus a token mint),
 * which are cached in KV for the hour and so are paid by the run's first check only, the two lexicons (4), and a
 * dispatch (a token mint and the POST, twice when GitHub refuses a cached token: 4). That is at most 14 for the
 * first check and 9 for each other one, so `PARTS_CHECKS_PER_RUN = 5` checks stay at 50 or fewer. The search always
 * asks Door43, past the catalog cache, and a shared reading with an input left out is kept 10 minutes, so a run
 * still reads it once. KV and R2: about 26 calls a check (the hour, the list, the shared readings and the token, the
 * builder file and the status, one bulk read of the first-seen records, which KV counts as one call, a dispatch and
 * the code budget), plus one KV write for each change the Worker sees for the first time, once per key and stamp in
 * the whole Worker. Five checks are about 130; at 03 UTC, with the cleanup's 800, that leaves room for some 70 stamps
 * never seen before in one run. A slice with more than five languages checks five of them, chosen afresh each day,
 * and the rest are still checked by the phones that open them. The f1.1 sweep stays one daily loop, as before, and
 * the cleanup counts its own R2 calls (`src/packs/cleanup.ts`). Going over a limit is not a disaster either: the
 * call that goes over throws, and every check and the cleanup turn a thrown call into an unreadable input,
 * "unknown", "error" or "aborted".
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
import { runPartsCleanup } from "./cleanup.js";
import type { observeParts } from "./partsSources.js";

export type ScheduledEnv = FreshnessEnv & {
  /** `parts`: the cron sweeps parts only, never f1.1 (staging). Anything else, or unset, sweeps both. */
  PACKS_SWEEP?: string;
  /** `dry-run` or `delete` runs the parts cleanup at 03 UTC; anything else, or unset, is off. */
  PACKS_CLEANUP?: string;
};

export type CleanupMode = "dry-run" | "delete";

/** The hour (UTC) the f1.1 sweep has always run in (it was `17 6 * * *`). */
export const F11_SWEEP_HOUR = 6;
export const CLEANUP_HOUR = 3;
/** Code-only rebuilds the sweep may ask for in a day (Decision 7): a code bump reaches 100 languages in ten days. */
export const CODE_REBUILDS_PER_DAY = 10;
/** Parts checks in one run, so that a run stays within the Free plan's 50 outside fetches (see above). */
export const PARTS_CHECKS_PER_RUN = 5;
const COUNTER_TTL_S = 2 * 24 * 3600;

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
  /** The cron's own time (`ScheduledController.scheduledTime`): it picks the hour, even when a run starts late. */
  scheduledTime?: number | Date;
  /** The clock of the checks and of the code budget's day. Unset in production, as the f1.1 sweep always had it. */
  now?: Date;
  requestBuild?: typeof requestBuild;
  checkFreshness?: typeof checkFreshness;
  checkPartsFreshness?: typeof checkPartsFreshness;
  observe?: typeof observeParts;
  cleanup?: (
    env: ScheduledEnv,
    o: { now?: Date; mode: CleanupMode },
  ) => Promise<unknown>;
};

export async function runScheduled(
  env: ScheduledEnv,
  ctx: ExecutionContext,
  deps: ScheduledDeps = {},
): Promise<void> {
  const at = new Date(deps.scheduledTime ?? deps.now ?? Date.now());
  const hour = at.getUTCHours();

  if (hour === F11_SWEEP_HOUR && env.PACKS_SWEEP !== "parts") {
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

  // Before the parts slice: a build that slice dispatches would otherwise postpone the cleanup every day.
  const mode = cleanupMode(env.PACKS_CLEANUP);
  if (hour === CLEANUP_HOUR && mode) {
    try {
      await (deps.cleanup ?? runPartsCleanup)(env, { now: deps.now, mode });
    } catch (err) {
      console.error(`[packs] cleanup stopped:`, err);
    }
  }

  try {
    await runPartsSweep(env, ctx, hour, deps);
  } catch (err) {
    console.error(`[packs] parts sweep stopped:`, err);
  }
}

async function runPartsSweep(
  env: ScheduledEnv,
  ctx: ExecutionContext,
  hour: number,
  deps: ScheduledDeps,
): Promise<void> {
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
  const day = (deps.now ?? new Date()).toISOString().slice(0, 10);
  // A different order each day, so that a slice over the cap leaves out other languages tomorrow.
  const ordered = [...slice].sort(
    (a, b) =>
      fnv1a32(`${day}:${a}`) - fnv1a32(`${day}:${b}`) || (a < b ? -1 : 1),
  );
  const checked = ordered.slice(0, PARTS_CHECKS_PER_RUN);
  const left = ordered.slice(PARTS_CHECKS_PER_RUN);
  const budgetKey = `packs:code-rebuilds:${day}`;
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
          return (await readCounter(kv, budgetKey)) < CODE_REBUILDS_PER_DAY;
        },
      });
      if (askedForCode && result === "dispatched") {
        await bumpCounter(kv, budgetKey);
      }
      results.push(`${language} ${result}`);
    } catch (err) {
      console.error(`[packs] parts sweep of ${language} failed:`, err);
      results.push(`${language} error`);
    }
  }
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

async function readCounter(kv: KVNamespace, key: string): Promise<number> {
  try {
    return Number.parseInt((await kv.get(key)) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

/** Best effort, as the dispatch cap: KV is eventually consistent, so the budget is soft by a rebuild or so. */
async function bumpCounter(kv: KVNamespace, key: string): Promise<void> {
  try {
    const count = await readCounter(kv, key);
    await kv.put(key, String(count + 1), { expirationTtl: COUNTER_TTL_S });
  } catch {
    // Ignored.
  }
}
