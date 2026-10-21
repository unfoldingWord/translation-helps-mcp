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
} & DispatchEnv;

export type BuildOutcome =
  | "dispatched"
  | "running"
  | "cooling"
  | "stopped"
  | "capped"
  | "unconfigured"
  | "invalid"
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

// Callers normalize these already; checked again because both end up in bucket keys and workflow inputs.
export const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
export const COMPAT_RE = /^f\d+\.\d+-u[\w.]+-p\d+-q\d+-a\d+-t\d+$/;

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

type BuildRequest = {
  env: BuildEnv;
  compat: string;
  language: string;
  reason: "missing" | "stale" | "daily";
  now?: Date;
  fetch?: typeof fetch;
};

/** Never throws: the packs route calls it on a phone's request and only needs an outcome to report. */
export async function requestBuild(o: BuildRequest): Promise<BuildOutcome> {
  if (!LANGUAGE_RE.test(o.language) || !COMPAT_RE.test(o.compat)) {
    return "invalid";
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

  // Best effort both ways: KV is eventually consistent and allows one write per second per key, so the cap is
  // soft by a few dispatches and a failed read or write never blocks a build.
  const counterKey = `packs:dispatch:${now.toISOString().slice(0, 10)}`;
  let count = 0;
  try {
    count = Number.parseInt((await kv.get(counterKey)) ?? "0", 10) || 0;
  } catch {
    // Counted as 0.
  }
  if (count >= DAILY_CAP) return "capped";
  try {
    await kv.put(counterKey, String(count + 1), {
      expirationTtl: COUNTER_TTL_S,
    });
  } catch {
    // Ignored.
  }

  // Marked before GitHub is called: a run that dies before the workflow writes its own status still holds the
  // language for RUNNING_STALE_MS instead of being dispatched again on the next request.
  const running: BuildStatus = {
    state: "running",
    at: now.toISOString(),
    failures: previous?.failures ?? 0,
    run: "dispatched",
  };
  const mark = await bucket.put(key, JSON.stringify(running), STATUS_METADATA);

  try {
    await dispatchWorkflow(env, kv, now, fetchImpl, language);
    return "dispatched";
  } catch (err) {
    console.error(
      `[packs] dispatch for ${compat}/${language} (${o.reason}) failed:`,
      err,
    );
    await restoreStatus(bucket, key, previousRaw, mark?.etag);
    return "error";
  }
}

async function dispatchWorkflow(
  env: BuildEnv,
  kv: KVNamespace,
  now: Date,
  fetchImpl: typeof fetch,
  language: string,
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
