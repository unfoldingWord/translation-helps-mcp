/**
 * Asks tc-study's language-packs workflow for a build, at most once. The guard reads the status the workflow keeps
 * in the bucket (`status/<compat>/<lang>.json`), so a language that is building, failing or broken is not
 * dispatched again on every request; a KV counter caps the day across all languages.
 */

import {
  GITHUB_API,
  forgetInstallationToken,
  githubHeaders,
  installationToken,
  type DispatchEnv,
} from "./githubApp";

/** Structurally a subset of the packs route's env, so that env can be passed as is. */
export type BuildEnv = {
  LANGUAGE_PACKS?: R2Bucket;
  TRANSLATION_HELPS_CACHE: KVNamespace;
  /** `on` lets the Worker ask for parts builds (see `partsDispatchEnabled`); anything else, or unset, is off. */
  PACKS_PARTS_DISPATCH?: string;
  /** Counted parts dispatches a day, apart from f1.1's `DAILY_CAP`. Default `PARTS_DAILY_CAP`. */
  PACKS_PARTS_DAILY_CAP?: string;
} & DispatchEnv;

export type BuildOutcome =
  | "dispatched"
  | "running"
  | "cooling"
  | "stopped"
  | "capped"
  | "unconfigured"
  | "invalid"
  | "parts-off"
  | "error";

export type BuildStatus = {
  state: "running" | "ok" | "failed";
  at: string;
  failures: number;
  run: string;
  /**
   * When the workflow's build began reading Door43 (its own `running` write sets it; `ok` and `failed` keep it).
   * The Worker's `running` mark at dispatch has none: the build has not started yet.
   */
  started?: string;
  /**
   * The builder code a parts run built with (tc-study writes it on `ok`, parts only). The parts freshness check
   * takes a code change as seen only by a run of that code.
   */
  code?: string;
};

const HOUR_MS = 3_600_000;
/** Longer than the workflow job's 300-min timeout, so a slow build is never dispatched twice. */
export const RUNNING_STALE_MS = 5.5 * HOUR_MS;
export const FAILED_COOLDOWN_MS = 24 * HOUR_MS;
export const MAX_FAILURES = 3;
export const DAILY_CAP = 20;
/**
 * Parts dispatches have a counter and a cap of their own, so f2.0 traffic (a first visit per language, then code
 * rebuilds) can never use up the day f1.1 phones still depend on, and the other way round.
 */
export const PARTS_DAILY_CAP = 20;
const COUNTER_TTL_S = 2 * 24 * 3600;

const WORKFLOW_DISPATCH = `${GITHUB_API}/repos/unfoldingWord/tc-study/actions/workflows/language-packs.yml/dispatches`;
const STATUS_METADATA = {
  httpMetadata: { contentType: "application/json", cacheControl: "no-cache" },
};

// Callers normalize these already; checked again because both end up in bucket keys and workflow inputs.
export const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
export const COMPAT_RE = /^f\d+\.\d+-u[\w.]+-p\d+-q\d+-a\d+-t\d+$/;

/**
 * The compatibility folder the workflow builds into today, and the only one that may ask for a build: the workflow
 * builds whatever compat its own code computes, so a build asked for any other compat would never land and would be
 * asked for again every time the running guard expired, using up the daily cap.
 *
 * Must equal tc-study's `compatKeyOf(PACK_FORMAT_VERSION, PACK_VERSIONS)` (bt-synergy, packages/language-pack).
 * After a bump in tc-study, change it here and redeploy v2; until then, phones on the old compat keep the packs they
 * have and nothing loops.
 */
export const CURRENT_PACK_COMPAT = "f1.1-u2.3.0-p6000230-q9-a12-t1";

/**
 * The compatibility folder the workflow builds parts into today (`parts: true`). The same rule as for
 * `CURRENT_PACK_COMPAT` holds: only this parts compat may ask for a build.
 *
 * Must equal tc-study's `compatKeyOf(PARTS_FORMAT_VERSION, PACK_VERSIONS)`, which `packs-status --print-compat
 * --parts` prints. After a bump in tc-study, change it here and redeploy v2.
 */
export const CURRENT_PARTS_COMPAT = "f2.0-u2.3.0-p6000230-q9-a12-t1";

/** Format 2 and later are parts: lists of content-addressed parts instead of one zip per language. */
export function isPartsCompat(compat: string): boolean {
  return /^f([2-9]|\d{2,})\./.test(compat);
}

/**
 * Whether this Worker may ask for parts builds at all. Off until the workflow may publish parts to the Worker's
 * target (staging now; production after delivery 3's Task 14), because a parts dispatch the workflow refuses
 * would be marked failed and cool the language for nothing. The parts freshness check and the sweep check it
 * before observing anything, and `requestBuild` checks it again.
 */
export function partsDispatchEnabled(env: {
  PACKS_PARTS_DISPATCH?: string;
}): boolean {
  return env.PACKS_PARTS_DISPATCH === "on";
}

/** A whole count, else the default: a typo must not lift the cap or close it. `0` closes it. */
function partsDailyCap(raw: string | undefined): number {
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : PARTS_DAILY_CAP;
}

/** The compats the workflow builds today; any other would never land (see `CURRENT_PACK_COMPAT`). */
export function isBuildableCompat(compat: string): boolean {
  return compat === CURRENT_PACK_COMPAT || compat === CURRENT_PARTS_COMPAT;
}

function statusKey(compat: string, language: string): string {
  return `status/${compat}/${language}.json`;
}

/** The build status the workflow (or a dispatch's `running` mark) left for a language; null when none parses. */
export async function readBuildStatus(
  bucket: R2Bucket,
  compat: string,
  language: string,
): Promise<BuildStatus | null> {
  const object = await bucket.get(statusKey(compat, language));
  return parseStatus(object ? await object.text() : null);
}

/** Same reading as the workflow's packsStatus: anything malformed counts as no status. */
function parseStatus(raw: string | null): BuildStatus | null {
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw) as Partial<BuildStatus> | null;
    if (
      s &&
      (s.state === "running" || s.state === "ok" || s.state === "failed") &&
      typeof s.at === "string" &&
      typeof s.failures === "number" &&
      Number.isFinite(s.failures)
    ) {
      return {
        state: s.state,
        at: s.at,
        failures: s.failures,
        run: typeof s.run === "string" ? s.run : "",
        ...(typeof s.started === "string" ? { started: s.started } : {}),
        ...(typeof s.code === "string" ? { code: s.code } : {}),
      };
    }
  } catch {
    // Falls through to "no status".
  }
  return null;
}

function guard(status: BuildStatus | null, now: Date): BuildOutcome | null {
  if (!status) return null;
  if (status.failures >= MAX_FAILURES) return "stopped";
  // An unreadable date is treated as old, so it cannot hold a language forever.
  const at = Date.parse(status.at);
  const age = Number.isNaN(at) ? Infinity : now.getTime() - at;
  if (status.state === "running" && age < RUNNING_STALE_MS) return "running";
  if (status.state === "failed" && age < FAILED_COOLDOWN_MS) return "cooling";
  return null;
}

type BuildRequest = {
  env: BuildEnv;
  compat: string;
  language: string;
  /**
   * `daily` is the cron's own work: bounded by the bucket's languages, so it neither waits for nor uses the cap.
   * `code` is a rebuild for a new builder version alone; it is counted like `stale`.
   */
  reason: "missing" | "stale" | "code" | "daily";
  now?: Date;
  fetch?: typeof fetch;
};

/** Never throws: the packs route calls it on a phone's request and only needs an outcome to report. */
export async function requestBuild(o: BuildRequest): Promise<BuildOutcome> {
  if (!LANGUAGE_RE.test(o.language) || !COMPAT_RE.test(o.compat)) {
    return "invalid";
  }
  if (isPartsCompat(o.compat) && !partsDispatchEnabled(o.env)) {
    return "parts-off";
  }
  try {
    return await guardedDispatch(o);
  } catch (err) {
    console.error(
      `[packs] build request for ${o.compat}/${o.language} failed:`,
      err,
    );
    return "error";
  }
}

async function guardedDispatch(o: BuildRequest): Promise<BuildOutcome> {
  const { env, compat, language } = o;
  const now = o.now ?? new Date();
  const fetchImpl = o.fetch ?? fetch;
  const bucket = env.LANGUAGE_PACKS;
  const kv = env.TRANSLATION_HELPS_CACHE;
  if (
    !bucket ||
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_APP_INSTALLATION_ID
  ) {
    return "unconfigured";
  }

  const key = statusKey(compat, language);
  const object = await bucket.get(key);
  const previousRaw = object ? await object.text() : null;
  const previous = parseStatus(previousRaw);
  const held = guard(previous, now);
  if (held) return held;

  // Past the guard, a `running` status is stale: that run died without writing its result (before its tools were
  // built, or killed with the runner), so it counts as a failure, or a language that always dies early would be
  // dispatched every 5.5 h forever.
  let failures = previous?.failures ?? 0;
  if (previous?.state === "running") {
    failures += 1;
    if (failures >= MAX_FAILURES) {
      const stopped: BuildStatus = {
        ...previous,
        state: "failed",
        at: now.toISOString(),
        failures,
      };
      await bucket.put(key, JSON.stringify(stopped), STATUS_METADATA);
      return "stopped";
    }
  }

  // Best effort both ways: KV is eventually consistent and allows one write per second per key, so the cap is
  // soft by a few dispatches and a failed read or write never blocks a build.
  const parts = isPartsCompat(compat);
  const day = now.toISOString().slice(0, 10);
  // f1.1's key is the one the deployed Worker has always used.
  const counterKey = parts
    ? `packs:dispatch-parts:${day}`
    : `packs:dispatch:${day}`;
  const cap = parts ? partsDailyCap(env.PACKS_PARTS_DAILY_CAP) : DAILY_CAP;
  const counted = o.reason !== "daily";
  if (counted && (await readCounter(kv, counterKey)) >= cap) {
    return "capped";
  }

  // Marked before GitHub is called: a run that dies before the workflow writes its own status still holds the
  // language for RUNNING_STALE_MS instead of being dispatched again on the next request.
  const running: BuildStatus = {
    state: "running",
    at: now.toISOString(),
    failures,
    run: "dispatched",
  };
  const mark = await bucket.put(key, JSON.stringify(running), STATUS_METADATA);

  try {
    await dispatchWorkflow(env, kv, now, fetchImpl, language, compat);
  } catch (err) {
    console.error(
      `[packs] dispatch for ${compat}/${language} (${o.reason}) failed:`,
      err,
    );
    await restoreStatus(bucket, key, previousRaw, mark?.etag);
    return "error";
  }

  // Only a dispatch GitHub accepted uses up the cap; a GitHub outage must not spend the day.
  if (counted) {
    const count = await readCounter(kv, counterKey);
    try {
      await kv.put(counterKey, String(count + 1), {
        expirationTtl: COUNTER_TTL_S,
      });
    } catch {
      // Ignored.
    }
  }
  return "dispatched";
}

async function readCounter(kv: KVNamespace, key: string): Promise<number> {
  try {
    return Number.parseInt((await kv.get(key)) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

async function dispatchWorkflow(
  env: BuildEnv,
  kv: KVNamespace,
  now: Date,
  fetchImpl: typeof fetch,
  language: string,
  compat: string,
): Promise<void> {
  const post = async () =>
    fetchImpl(WORKFLOW_DISPATCH, {
      method: "POST",
      headers: {
        ...githubHeaders(await installationToken(env, kv, now, fetchImpl)),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "master",
        inputs: {
          language,
          mode: "publish",
          target: env.PACKS_TARGET ?? "staging",
          // The workflow stops (and marks this compat failed) when its code builds another one.
          compat,
          // Only for parts, so the f1.1 body stays what the deployed workflow has always been sent.
          ...(compat === CURRENT_PARTS_COMPAT ? { parts: "true" } : {}),
        },
      }),
    });

  let res = await post();
  // A cached token GitHub no longer accepts (revoked, App reinstalled) would otherwise fail every dispatch until
  // its KV entry expires: drop it and try once more with a freshly minted one.
  if (res.status === 401) {
    await res.body?.cancel();
    await forgetInstallationToken(env, kv);
    res = await post();
    if (res.status === 401) await forgetInstallationToken(env, kv);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`GitHub workflow dispatch: ${res.status}`);
  }
}

/** Puts back what was there before the `running` mark, unless the workflow has written a newer status since. */
async function restoreStatus(
  bucket: R2Bucket,
  key: string,
  previousRaw: string | null,
  markEtag: string | undefined,
): Promise<void> {
  try {
    if (previousRaw === null) {
      // R2 has no conditional delete; the window between head and delete is milliseconds.
      const current = await bucket.head(key);
      if (current && (markEtag === undefined || current.etag === markEtag)) {
        await bucket.delete(key);
      }
    } else {
      await bucket.put(
        key,
        previousRaw,
        markEtag === undefined
          ? STATUS_METADATA
          : { ...STATUS_METADATA, onlyIf: { etagMatches: markEtag } },
      );
    }
  } catch (err) {
    // The `running` mark stays; the guard lets the language go again after RUNNING_STALE_MS.
    console.error(`[packs] could not restore ${key}:`, err);
  }
}
