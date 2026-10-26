/**
 * Packs follow Door43. Every entry hit may check, at most once an hour per language, whether the tc-ready catalog
 * has a newer release of anything the pack was built from, and asks for a `stale` build when it does. The daily cron
 * runs the same check for every published language. The originals (UHB, UGNT), the lexicons and MACULA are not in a
 * language's catalog search: a change to them alone is built with the language's next release, or by hand with the
 * workflow's `force` input, until fingerprints come.
 */

import { catalogSearch, type CatalogEntry } from "@translation-helps/door43";
import {
  CURRENT_PACK_COMPAT,
  LANGUAGE_RE,
  readBuildStatus,
  requestBuild,
  type BuildEnv,
  type BuildOutcome,
  type BuildStatus,
} from "./dispatch.js";

/** Copied from bt-synergy packages/language-pack/src/catalog.ts (schema 1), only the fields read here. */
export type PackCatalogEntry = {
  schema: 1;
  language: string;
  compat: string;
  build: {
    id: string;
    generator: string;
    macula?: string;
    lexicons?: string;
    /** `owner/language/id` → `resourceContentStamp`, of everything the pack was built from. */
    stamps: Record<string, string>;
  };
  createdAt: string;
  pack: { path: string; bytes: number; sha256: string };
  resources: Array<{ key: string; stamp: string }>;
  originals?: { build: string; path: string; bytes: number; sha256: string };
};

export type FreshnessEnv = BuildEnv & { ANALYTICS?: AnalyticsEngineDataset };

export type Search = (
  language: string,
  env: FreshnessEnv,
  ctx: ExecutionContext,
) => Promise<CatalogEntry[]>;

const CHECK_TTL_S = 3600;
/** bt-synergy's SEARCH_LIMIT (resource-pipeline discover/readCatalogSearch.ts), so both see the same rows. */
const SEARCH_LIMIT = 500;
/** Lexicons are stamped in a build as sha10#commitDate, never a catalog tag#published, so they would always differ. */
const NOT_CATALOG_STAMPED = new Set(["uhl", "ugl"]);
/** The workflow job's `timeout-minutes`: no build runs longer, so an ok run ended at most this long after it began. */
const JOB_TIMEOUT_MS = 300 * 60_000;

/**
 * The moment from which an `ok` build had seen Door43: its `started`. A status written before `started` existed (or
 * with one that does not parse) falls back to `at` minus the job timeout, the earliest the run could have begun, so
 * it can never take a release published during its run as seen. NaN for any other state.
 */
export function okBuildSawDoor43At(status: BuildStatus | null): number {
  if (status?.state !== "ok") return NaN;
  const started = Date.parse(status.started ?? "");
  if (!Number.isNaN(started)) return started;
  return Date.parse(status.at) - JOB_TIMEOUT_MS;
}

/** Only keys both maps have count: a source the catalog no longer lists says nothing about the pack's age. */
export function isStale(
  entry: PackCatalogEntry,
  current: Record<string, string>,
): boolean {
  return Object.entries(entry.build.stamps).some(
    ([key, stamp]) => key in current && current[key] !== stamp,
  );
}

/**
 * The latest release date among the sources whose stamps differ, read from the catalog's side (`tag#published_at`,
 * with `:` turned into `_` by the stamp). Stamps with no date after `#` say nothing and are skipped; null when none
 * has one.
 */
export function newestDifferingRelease(
  entry: PackCatalogEntry,
  current: Record<string, string>,
): number | null {
  let newest: number | null = null;
  for (const [key, stamp] of Object.entries(entry.build.stamps)) {
    const now = current[key];
    if (now === undefined || now === stamp) continue;
    const hash = now.lastIndexOf("#");
    if (hash < 0) continue;
    const published = Date.parse(now.slice(hash + 1).replaceAll("_", ":"));
    if (Number.isNaN(published)) continue;
    newest = newest === null ? published : Math.max(newest, published);
  }
  return newest;
}

/** The resource id of a catalog row, as bt-synergy's catalogIdentity takes it: the repo name after the first `_`. */
export function catalogResourceId(row: Pick<CatalogEntry, "name">): string {
  return row.name.includes("_")
    ? row.name.split("_").slice(1).join("_")
    : row.name;
}

/** Keyed as bt-synergy's catalogIdentity keys a hit: owner/language/repo name after the first `_`; null without a name. */
export function catalogKey(
  row: Pick<CatalogEntry, "owner" | "name" | "language">,
  language: string,
): string | null {
  if (!row.name) return null;
  return `${row.owner}/${row.language || language}/${catalogResourceId(row)}`;
}

export function currentStamps(
  rows: CatalogEntry[],
  language: string,
): Record<string, string> {
  const stamps: Record<string, string> = {};
  for (const row of rows) {
    const key = catalogKey(row, language);
    if (!row.stamp || row.stamp === "nostamp" || !key) continue;
    if (NOT_CATALOG_STAMPED.has(catalogResourceId(row))) continue;
    stamps[key] = row.stamp;
  }
  return stamps;
}

export const defaultSearch: Search = (language, env, ctx) =>
  catalogSearch({
    lang: language,
    kv: env.TRANSLATION_HELPS_CACHE,
    ctx,
    limit: SEARCH_LIMIT,
  });

/**
 * Never throws: it runs in `waitUntil` after the entry has been served. The hour is claimed before Door43 is asked,
 * so a Door43 outage is not asked again on every request. `entry` may be a reader because a 304 carries no body; it
 * is called only once the hour allows a check.
 */
export async function checkFreshness(o: {
  env: FreshnessEnv;
  ctx: ExecutionContext;
  compat: string;
  language: string;
  entry: PackCatalogEntry | (() => Promise<PackCatalogEntry | null>);
  now?: Date;
  search?: Search;
  requestBuild?: typeof requestBuild;
  /** `daily` when the cron sweeps the bucket (see requestBuild's cap). */
  reason?: "stale" | "daily";
}): Promise<void> {
  const { env, compat, language } = o;
  const now = o.now ?? new Date();
  const kv = env.TRANSLATION_HELPS_CACHE;
  // Only the current compat can be rebuilt (see CURRENT_PACK_COMPAT).
  if (compat !== CURRENT_PACK_COMPAT) return;
  const key = `packs:fresh:${compat}:${language}`;
  try {
    // KV is eventually consistent, so two isolates may both check within the hour; that only costs a search.
    const last = Date.parse((await kv.get(key)) ?? "");
    if (!Number.isNaN(last) && now.getTime() - last < CHECK_TTL_S * 1000) {
      return;
    }
    await kv.put(key, now.toISOString(), { expirationTtl: CHECK_TTL_S });

    const entry = typeof o.entry === "function" ? await o.entry() : o.entry;
    if (!entry?.build?.stamps) return;
    const rows = await (o.search ?? defaultSearch)(language, env, o.ctx);
    const current = currentStamps(rows, language);
    if (!isStale(entry, current)) return;

    // A build that started after the newest differing release has already seen it and found nothing to publish
    // (publish-language compares its own stamps): when the two stamp derivations disagree on a key, asking again
    // would loop until the cap. Its start, not its end (`at`): a release published while it ran was never read.
    if (env.LANGUAGE_PACKS) {
      const newest = newestDifferingRelease(entry, current);
      const status = await readBuildStatus(
        env.LANGUAGE_PACKS,
        compat,
        language,
      );
      const sawAt = okBuildSawDoor43At(status);
      if (newest !== null && !Number.isNaN(sawAt) && sawAt > newest) {
        console.log(
          `[packs] stale ${compat}/${language}: already seen by the build started ${status?.started ?? `before ${status?.at}`}`,
        );
        env.ANALYTICS?.writeDataPoint({
          indexes: ["pack"],
          blobs: ["pack", "freshness", language, "stale-seen"],
          doubles: [0],
        });
        return;
      }
    }

    const build: BuildOutcome = await (o.requestBuild ?? requestBuild)({
      env,
      compat,
      language,
      reason: o.reason ?? "stale",
      now,
    });
    console.log(`[packs] stale ${compat}/${language}: ${build}`);
    if (build === "dispatched") {
      env.ANALYTICS?.writeDataPoint({
        indexes: ["pack"],
        blobs: ["pack", "freshness", language, "stale-dispatched"],
        doubles: [0],
      });
    }
  } catch (err) {
    console.error(`[packs] freshness of ${compat}/${language} unknown:`, err);
  }
}

/**
 * The cron's work: every language with an entry under the current compat, es-419 and en like any other, gets the
 * same freshness check a phone's visit gives it, so a new Door43 release is built even for a language nobody opened
 * that day. The sweep builds nothing by itself: releases are monthly at most, and a daily build would mostly rebuild
 * what did not change. Until fingerprints come (the parts design), a change to the originals, the lexicons or MACULA
 * alone waits for the language's next release, or a build asked for by hand with the workflow's `force` input.
 */
export async function runDailySweep(
  env: FreshnessEnv,
  ctx: ExecutionContext,
  deps: {
    requestBuild?: typeof requestBuild;
    checkFreshness?: typeof checkFreshness;
    now?: Date;
  } = {},
): Promise<void> {
  const build = deps.requestBuild ?? requestBuild;
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket) return;
  const check = deps.checkFreshness ?? checkFreshness;
  try {
    for await (const language of publishedLanguages(
      bucket,
      CURRENT_PACK_COMPAT,
    )) {
      await check({
        env,
        ctx,
        compat: CURRENT_PACK_COMPAT,
        language,
        entry: () => readCatalogEntry(bucket, CURRENT_PACK_COMPAT, language),
        now: deps.now,
        requestBuild: build,
        reason: "daily",
      });
    }
  } catch (err) {
    console.error(`[packs] daily freshness sweep stopped:`, err);
  }
}

/** The languages with an entry under `catalog/<compat>/`, page by page (originals.json is not a language). */
async function* publishedLanguages(
  bucket: R2Bucket,
  compat: string,
): AsyncGenerator<string> {
  const prefix = `catalog/${compat}/`;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects) {
      const name = object.key.slice(prefix.length);
      if (!name.endsWith(".json")) continue;
      const language = name.slice(0, -".json".length);
      if (language === "originals" || !LANGUAGE_RE.test(language)) continue;
      yield language;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function readCatalogEntry(
  bucket: R2Bucket,
  compat: string,
  language: string,
): Promise<PackCatalogEntry | null> {
  const object = await bucket.get(`catalog/${compat}/${language}.json`);
  return object ? ((await object.json()) as PackCatalogEntry) : null;
}
