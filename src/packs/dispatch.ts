/**
 * Asks tc-study's language-packs workflow for a build, at most once. The guard reads the status the workflow keeps
 * in the bucket (`status/<compat>/<lang>.json`), so a language that is building, failing or broken is not
 * dispatched again on every request; a KV counter caps the day across all languages.
 */

import {
  GITHUB_API,
  githubHeaders,
  installationToken,
  type DispatchEnv,
} from "./githubApp";

/** Structurally a subset of the packs route's env, so that env can be passed as is. */
export type BuildEnv = {
  LANGUAGE_PACKS?: R2Bucket;
  TRANSLATION_HELPS_CACHE: KVNamespace;
} & DispatchEnv;

export type BuildOutcome =
  | "dispatched"
  | "running"
  | "cooling"
  | "stopped"
  | "capped"
  | "unconfigured"
  | "error";

type BuildStatus = {
  state: "running" | "ok" | "failed";
  at: string;
  failures: number;
  run: string;
};

const HOUR_MS = 3_600_000;
/** Longer than the workflow job's 300-min timeout, so a slow build is never dispatched twice. */
export const RUNNING_STALE_MS = 5.5 * HOUR_MS;
export const FAILED_COOLDOWN_MS = 24 * HOUR_MS;
export const MAX_FAILURES = 3;
export const DAILY_CAP = 20;
const COUNTER_TTL_S = 2 * 24 * 3600;

const WORKFLOW_DISPATCH = `${GITHUB_API}/repos/unfoldingWord/tc-study/actions/workflows/language-packs.yml/dispatches`;
const STATUS_METADATA = {
  httpMetadata: { contentType: "application/json", cacheControl: "no-cache" },
};

function statusKey(compat: string, language: string): string {
  return `status/${compat}/${language}.json`;
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

export async function requestBuild(o: {
  env: BuildEnv;
  compat: string;
  language: string;
  reason: "missing" | "stale" | "daily";
  now?: Date;
  fetch?: typeof fetch;
}): Promise<BuildOutcome> {
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
  let previousRaw: string | null;
  try {
    const object = await bucket.get(key);
    previousRaw = object ? await object.text() : null;
  } catch {
    return "error";
  }
  const previous = parseStatus(previousRaw);
  const held = guard(previous, now);
  if (held) return held;

  // Best effort: KV is eventually consistent, so the cap is soft by a few dispatches.
  const counterKey = `packs:dispatch:${now.toISOString().slice(0, 10)}`;
  const count = Number.parseInt((await kv.get(counterKey)) ?? "0", 10) || 0;
  if (count >= DAILY_CAP) return "capped";
  await kv.put(counterKey, String(count + 1), { expirationTtl: COUNTER_TTL_S });

  // Marked before GitHub is called: a run that dies before the workflow writes its own status still holds the
  // language for RUNNING_STALE_MS instead of being dispatched again on the next request.
  const running: BuildStatus = {
    state: "running",
    at: now.toISOString(),
    failures: previous?.failures ?? 0,
    run: "dispatched",
  };
  try {
    await bucket.put(key, JSON.stringify(running), STATUS_METADATA);
  } catch {
    return "error";
  }

  try {
    const token = await installationToken(env, kv, now, fetchImpl);
    const res = await fetchImpl(WORKFLOW_DISPATCH, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "master",
        inputs: {
          language,
          mode: "publish",
          target: env.PACKS_TARGET ?? "staging",
        },
      }),
    });
    if (!res.ok) throw new Error(`GitHub workflow dispatch: ${res.status}`);
    return "dispatched";
  } catch (err) {
    console.error(
      `[packs] dispatch for ${compat}/${language} (${o.reason}) failed:`,
      err,
    );
    try {
      if (previousRaw === null) await bucket.delete(key);
      else await bucket.put(key, previousRaw, STATUS_METADATA);
    } catch (restoreErr) {
      // The `running` mark stays; the guard lets the language go again after RUNNING_STALE_MS.
      console.error(
        `[packs] could not restore the status of ${compat}/${language}:`,
        restoreErr,
      );
    }
    return "error";
  }
}
