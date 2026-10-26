/**
 * Parts lists follow what they were built from. A list hit checks, at most once an hour per language, whether the
 * stamp of anything the build read moved (a release, a lexicon or MACULA commit: `observeParts`) or whether master
 * builds another code (`status/builder.json`), and asks for a parts build when one did. The build then decides unit
 * by unit what to rebuild and what to carry; the Worker computes no fingerprint (delivery 3, Decision 1).
 *
 * Every reason has a breaker: an `ok` build that already saw the change. When the Worker and the build derive a
 * stamp differently, that breaker limits the disagreement to one build per change instead of a loop.
 */

import {
  CURRENT_PARTS_COMPAT,
  partsDispatchEnabled,
  readBuildStatus,
  requestBuild,
  type BuildOutcome,
  type BuildStatus,
} from "./dispatch.js";
import { okBuildSawDoor43At, type FreshnessEnv } from "./freshness.js";
import { MACULA_KEYS, observeParts } from "./partsSources.js";

/** Copied from tc-study language-pack `parts/partsList.ts` (`PartsList`, schema 2), only the fields read here. */
export type PartsListLite = {
  schema: 2;
  /** `es-419`, or `originals`. */
  language: string;
  compat: string;
  /** The code its parts were built with: `<compat>+<hash>` (resource-pipeline `partsCode`). */
  code: string;
  resources: Array<{ key: string; stamp: string; role?: string }>;
  /** A language's list: the originals list at its content address. */
  originals?: { path: string; sha256: string };
  /** A language's list: the stamp of every resource the build read (tc-study Task 10). */
  stamps?: Record<string, string>;
};

/** tc-study resource-pipeline `packsStatus.ts` `PartsBuilder`: what master's code builds today. */
export type PartsBuilder = {
  compat: string;
  code: string;
  commit: string;
  /** When this code first appeared. */
  at: string;
};

export type PartsCheck =
  | "not-current"
  | "throttled"
  | "no-list"
  | "fresh"
  | "unknown"
  | "seen"
  | "budget"
  | BuildOutcome;

const BUILDER_KEY = "status/builder.json";
const CHECK_TTL_S = 3600;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** A `status/builder.json` text: its four strings, else null. */
export function parsePartsBuilder(text: string): PartsBuilder | null {
  try {
    const b = JSON.parse(text) as Partial<PartsBuilder> | null;
    if (
      b &&
      typeof b.compat === "string" &&
      typeof b.code === "string" &&
      typeof b.commit === "string" &&
      typeof b.at === "string"
    ) {
      return { compat: b.compat, code: b.code, commit: b.commit, at: b.at };
    }
  } catch {
    // Falls through to "no file".
  }
  return null;
}

/** `status/builder.json`; anything malformed is no file, so it asks for nothing. */
export async function readPartsBuilder(
  bucket: R2Bucket,
): Promise<PartsBuilder | null> {
  try {
    const object = await bucket.get(BUILDER_KEY);
    return object ? parsePartsBuilder(await object.text()) : null;
  } catch {
    return null;
  }
}

/**
 * What the list was built from: its `stamps`, or, for a list published before tc-study recorded them, its resources
 * and those of the originals list it names (inputs that got no part are then missing, and read as new once).
 */
export function builtStamps(
  list: PartsListLite,
  originals: PartsListLite | null,
): Record<string, string> {
  if (list.stamps && typeof list.stamps === "object") return list.stamps;
  const stamps: Record<string, string> = {};
  const listed = (l: PartsListLite | null) =>
    Array.isArray(l?.resources) ? l.resources : [];
  for (const r of [...listed(originals), ...listed(list)]) {
    if (typeof r?.key === "string" && typeof r.stamp === "string") {
      stamps[r.key] = r.stamp;
    }
  }
  return stamps;
}

/**
 * The observed stamps a list is compared with: all of them but a MACULA key the list does not have. The build stamps
 * a MACULA key only when MACULA has files for it (tc-study `companions.ts` `maculaCatalogRows`), while the Worker
 * stamps both from one commit, so a MACULA key only observed is not a new input.
 */
export function comparedStamps(
  built: Record<string, string>,
  observed: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(observed).filter(
      ([key]) => !MACULA_KEYS.includes(key) || key in built,
    ),
  );
}

/**
 * Keys whose stamp moved, and keys only now there (a new resource), by key. A key only in `built` is ignored: a
 * resource Door43 no longer lists stays in the list until the next build for another reason (Decision 13).
 */
export function changedSources(
  built: Record<string, string>,
  current: Record<string, string>,
): Array<{ key: string; built?: string; current: string }> {
  return Object.keys(current)
    .sort()
    .filter((key) => built[key] !== current[key])
    .map((key) =>
      key in built
        ? { key, built: built[key], current: current[key]! }
        : { key, current: current[key]! },
    );
}

/**
 * The date after `#` of a stamp, sanitizing undone (`_` back to `:`, offsets included: `…T19_52_42-04_00`); NaN
 * when there is none.
 */
function stampDate(stamp: string): number {
  const hash = stamp.lastIndexOf("#");
  if (hash < 0) return NaN;
  return Date.parse(stamp.slice(hash + 1).replaceAll("_", ":"));
}

const FIRST_SEEN_PREFIX = "packs:first-seen:";
/** Longer than any list goes unbuilt in practice; an expired record only costs one build more. */
const FIRST_SEEN_TTL_S = 400 * 24 * 3600;
/** KV's bulk read takes at most 100 keys, and counts as one operation against the invocation's limit. */
const KV_BULK_MAX = 100;

/** Where the Worker keeps when it first saw `stamp` for `key`: a hash, since stamps carry any character. */
export async function firstSeenKey(
  key: string,
  stamp: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${key}|${stamp}`),
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `${FIRST_SEEN_PREFIX}${hex.slice(0, 32)}`;
}

/**
 * When the Worker first saw each change's current stamp, recording `now` for those it never saw before (review H1).
 * A stamp's own date is when it was made, not when a build could read it: a MACULA commit made on a Taller branch
 * on Monday and merged on Thursday is dated Monday, as is a lexicon commit merged late or a release Door43 indexed
 * late, so a build on Wednesday would otherwise count as having seen it. One bulk read for all of them; a write only
 * the first time. A read that fails gives null and writes nothing: the check then knows nothing (`unknown`), since
 * taking every change as first seen now would ask for a build on every check while the records stay unreadable.
 */
async function firstSeen(
  kv: KVNamespace,
  changes: Array<{ key: string; current: string }>,
  now: Date,
): Promise<number[] | null> {
  const keys = await Promise.all(
    changes.map((c) => firstSeenKey(c.key, c.current)),
  );
  const found = new Map<string, string | null>();
  try {
    for (let i = 0; i < keys.length; i += KV_BULK_MAX) {
      const part = await kv.get(keys.slice(i, i + KV_BULK_MAX));
      for (const [k, v] of part) found.set(k, v);
    }
  } catch (err) {
    console.error(`[packs] first-seen records unreadable:`, err);
    return null;
  }
  return Promise.all(
    keys.map(async (k) => {
      const at = Date.parse(found.get(k) ?? "");
      if (!Number.isNaN(at)) return at;
      try {
        await kv.put(k, now.toISOString(), {
          expirationTtl: FIRST_SEEN_TTL_S,
        });
      } catch {
        // Recorded on a later check, which only dates the change later.
      }
      return now.getTime();
    }),
  );
}

/**
 * Whether an `ok` build started after every change: then it read them, and a list that still differs is a
 * disagreement between the two derivations, not news. A change is dated by the later of its stamp's date and when
 * the Worker first saw it (`firstSeen`), so a change with no date, or one made before it could be read, is seen only
 * by a build that started after the Worker saw it: one build per change, then the breaker holds.
 */
function sourcesSeen(
  changes: Array<{ current: string }>,
  seenAt: number[],
  status: BuildStatus | null,
): boolean {
  const sawAt = okBuildSawDoor43At(status);
  if (Number.isNaN(sawAt)) return false;
  const dates = changes.map((c, i) => {
    const dated = stampDate(c.current);
    const seen = seenAt[i] ?? NaN;
    return Math.max(
      Number.isNaN(dated) ? -Infinity : dated,
      Number.isNaN(seen) ? -Infinity : seen,
    );
  });
  return sawAt > Math.max(-Infinity, ...dates);
}

/**
 * A code change is seen only by an `ok` run of that very code (tc-study writes `code` into a parts run's `ok`
 * status). A run's start says nothing here: one queued before the push, or a re-run, builds the old code after it.
 */
function codeSeen(status: BuildStatus | null, code: string): boolean {
  return status?.state === "ok" && status.code === code;
}

/** Never throws: a failed Analytics write must not turn a result into a crash, nor escape the crash path. */
function point(env: FreshnessEnv, language: string, result: string): void {
  try {
    env.ANALYTICS?.writeDataPoint({
      indexes: ["pack"],
      blobs: ["pack", "freshness", language, result],
      doubles: [0],
    });
  } catch (err) {
    console.error(
      `[packs] parts ${language}: analytics point not written:`,
      err,
    );
  }
}

/**
 * The originals list a language list names, when it names it by content: `catalog/<compat>/originals/<sha256>.json`
 * for its own 64-hex sha256, in the compat being read. Anything else is null: a path is never taken from a list as
 * it is. The cleanup reads the same field by the same rule.
 */
export function originalsPathOf(
  compat: string,
  named: { path?: unknown; sha256?: unknown } | null | undefined,
): string | null {
  if (
    !named ||
    typeof named.sha256 !== "string" ||
    !SHA256_RE.test(named.sha256) ||
    named.path !== `catalog/${compat}/originals/${named.sha256}.json`
  ) {
    return null;
  }
  return named.path;
}

async function readOriginals(
  bucket: R2Bucket,
  compat: string,
  list: PartsListLite,
): Promise<PartsListLite | null> {
  const path = originalsPathOf(compat, list.originals);
  if (!path) return null;
  try {
    const object = await bucket.get(path);
    if (!object) return null;
    const originals = JSON.parse(await object.text()) as PartsListLite;
    return Array.isArray(originals?.resources) ? originals : null;
  } catch {
    return null;
  }
}

/**
 * Never throws: it runs in `waitUntil` after the list has been served, and in the cron's sweep. Only the current
 * parts compat may ask for a build, and only while parts dispatch is on; neither case claims the hour or reads
 * anything. `list` is a reader because a 304 carries no body; it is called only once the hour allows a check.
 */
export async function checkPartsFreshness(o: {
  env: FreshnessEnv;
  ctx: ExecutionContext;
  compat: string;
  language: string;
  list: () => Promise<PartsListLite | null>;
  now?: Date;
  observe?: typeof observeParts;
  requestBuild?: typeof requestBuild;
  /** `daily` when the cron sweeps the bucket (see requestBuild's cap). */
  reason?: "stale" | "daily";
  /** On the daily path, whether a code-only rebuild may still be asked for today. Without it, none is. */
  codeBudget?: () => Promise<boolean>;
}): Promise<PartsCheck> {
  const { env, compat, language } = o;
  const now = o.now ?? new Date();
  const kv = env.TRANSLATION_HELPS_CACHE;
  if (compat !== CURRENT_PARTS_COMPAT) return "not-current";
  if (!partsDispatchEnabled(env)) return "parts-off";
  const tag = `[packs] parts ${compat}/${language}`;
  // Inputs the observation left out, named on every result after it.
  let leftOut = "";
  const done = (result: PartsCheck, detail = ""): PartsCheck => {
    console.log(`${tag}: ${result}${detail}${leftOut}`);
    point(env, language, `parts-${result === "seen" ? "stale-seen" : result}`);
    return result;
  };
  try {
    // The same hour as the f1.1 check, under the parts compat's own key.
    const key = `packs:fresh:${compat}:${language}`;
    const last = Date.parse((await kv.get(key)) ?? "");
    if (!Number.isNaN(last) && now.getTime() - last < CHECK_TTL_S * 1000) {
      return "throttled";
    }
    await kv.put(key, now.toISOString(), { expirationTtl: CHECK_TTL_S });

    const bucket = env.LANGUAGE_PACKS;
    const list = await o.list();
    if (!bucket || !list || typeof list.code !== "string") {
      return done("no-list");
    }
    const originals = list.stamps
      ? null
      : await readOriginals(bucket, compat, list);

    const observed = await (o.observe ?? observeParts)({
      language,
      env,
      ctx: o.ctx,
      now,
    });
    if ("unknown" in observed) return done("unknown", ` (${observed.unknown})`);
    if (observed.unreadable?.length) {
      // Left out, so not compared: a key only in the list is never a change.
      leftOut = `; not compared, unreadable: ${observed.unreadable.join("; ")}`;
    }

    const builder = await readPartsBuilder(bucket);
    if (builder && builder.compat !== compat) {
      // Master builds another compat than this Worker asks for: v2 needs the new CURRENT_PARTS_COMPAT first.
      console.log(
        `${tag}: compat-drift (master builds ${builder.compat}); no code rebuild`,
      );
      point(env, language, "parts-compat-drift");
    }
    const built = builtStamps(list, originals);
    const sources = changedSources(
      built,
      comparedStamps(built, observed.stamps),
    );
    const code =
      builder?.compat === compat && builder.code !== list.code
        ? builder.code
        : null;
    if (!sources.length && !code) return done("fresh");

    const detail = ` (${[
      ...sources.map((c) => `${c.key} ${c.built ?? "new"} → ${c.current}`),
      ...(code ? [`code ${list.code} → ${code}`] : []),
    ].join("; ")})`;
    // Recorded whatever the status, so the time is when the change was first seen, not when a build was first ok.
    const seenAt = sources.length ? await firstSeen(kv, sources, now) : [];
    // Without the records, no change can be dated: like an unreadable code budget, that asks for nothing.
    if (!seenAt) {
      return done("unknown", ` (first-seen records unreadable)${detail}`);
    }
    const status = await readBuildStatus(bucket, compat, language);
    const unseenSources =
      sources.length > 0 && !sourcesSeen(sources, seenAt, status);
    const unseenCode = code !== null && !codeSeen(status, code);
    if (!unseenSources && !unseenCode) {
      return done(
        "seen",
        ` by the build started ${status?.started ?? `before ${status?.at}`}${detail}`,
      );
    }

    const daily = o.reason === "daily";
    // A code bump touches every language at once: the sweep spreads its rebuilds over days.
    if (!unseenSources && daily && !(await (o.codeBudget?.() ?? false))) {
      return done("budget", detail);
    }
    const build = await (o.requestBuild ?? requestBuild)({
      env,
      compat,
      language,
      reason: daily ? "daily" : unseenSources ? "stale" : "code",
      now,
    });
    return done(build, detail);
  } catch (err) {
    console.error(`${tag}: freshness unknown:`, err);
    point(env, language, "parts-error");
    return "error";
  }
}
