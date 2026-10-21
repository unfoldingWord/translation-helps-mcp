/**
 * Packs follow Door43. Every entry hit may check, at most once an hour per language, whether the tc-ready catalog
 * has a newer release of anything the pack was built from, and asks for a `stale` build when it does. Originals and
 * lexicons are not in a language's catalog search, so they are left to the daily builds of es-419 and en.
 */

import { catalogSearch, type CatalogEntry } from "@translation-helps/door43";
import {
  CURRENT_PACK_COMPAT,
  requestBuild,
  type BuildEnv,
  type BuildOutcome,
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

type Search = (
  language: string,
  env: FreshnessEnv,
  ctx: ExecutionContext,
) => Promise<CatalogEntry[]>;

const CHECK_TTL_S = 3600;
/** bt-synergy's SEARCH_LIMIT (resource-pipeline discover/readCatalogSearch.ts), so both see the same rows. */
const SEARCH_LIMIT = 500;
/** Lexicons are stamped in a build as sha10#commitDate, never a catalog tag#published, so they would always differ. */
const NOT_CATALOG_STAMPED = new Set(["uhl", "ugl"]);
export const DAILY_LANGUAGES = ["es-419", "en"] as const;

/** Only keys both maps have count: a source the catalog no longer lists says nothing about the pack's age. */
export function isStale(
  entry: PackCatalogEntry,
  current: Record<string, string>,
): boolean {
  return Object.entries(entry.build.stamps).some(
    ([key, stamp]) => key in current && current[key] !== stamp,
  );
}

/** Keyed as bt-synergy's catalogIdentity keys a hit: owner/language/repo name after the first `_`. */
export function currentStamps(
  rows: CatalogEntry[],
  language: string,
): Record<string, string> {
  const stamps: Record<string, string> = {};
  for (const row of rows) {
    if (!row.stamp || row.stamp === "nostamp" || !row.name) continue;
    const id = row.name.includes("_")
      ? row.name.split("_").slice(1).join("_")
      : row.name;
    if (NOT_CATALOG_STAMPED.has(id)) continue;
    stamps[`${row.owner}/${row.language || language}/${id}`] = row.stamp;
  }
  return stamps;
}

const defaultSearch: Search = (language, env, ctx) =>
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
    if (!isStale(entry, currentStamps(rows, language))) return;

    const build: BuildOutcome = await (o.requestBuild ?? requestBuild)({
      env,
      compat,
      language,
      reason: "stale",
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

/** The cron's work: es-419 and en are rebuilt daily, which also refreshes the shared originals and lexicons. */
export async function runDailyBuilds(
  env: BuildEnv,
  build: typeof requestBuild = requestBuild,
): Promise<void> {
  for (const language of DAILY_LANGUAGES) {
    const outcome = await build({
      env,
      compat: CURRENT_PACK_COMPAT,
      language,
      reason: "daily",
    });
    console.log(`[packs] daily build of ${language}: ${outcome}`);
  }
}
