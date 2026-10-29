/**
 * Door43 Content Service (DCS) API client — v2 with Catalog API.
 *
 * All fetching goes through https://git.door43.org (Gitea + built-in Catalog).
 * The Catalog API lives at /api/v1/catalog/* — NOT at a separate host.
 *
 * Key invariants:
 *   - Catalog requests include topic=tc-ready (centralised in buildCatalogUrl),
 *     except OBS helps. Those search stage=prod, one subject at a time, with
 *     no topic. Open Bible Stories, Bible resources, and listLanguages keep
 *     the topic. When several owners match, one extra search with
 *     topic=tc-ready (same language and subject) marks the overlap. Rows that
 *     already list topics are used as they are. A failed lookup leaves topics
 *     unknown and is not cached; owner order applies for that request only.
 *   - Catalog-first discovery; Gitea tree fallback only when catalog returns nothing.
 *   - Catalog JSON responses are cached in KV (24 h TTL) with 1 h
 *     stale-while-revalidate freshness.
 */

import type { WaitUntilHost } from "../platform.js";

const GITEA_API = "https://git.door43.org/api/v1";
const GITEA_BASE = "https://git.door43.org";

/** Default catalog query params always injected — centralised so no call site can forget. */
const CATALOG_DEFAULTS: Record<string, string> = {
  topic: "tc-ready",
  stage: "prod",
};

/** KV expiration TTL for catalog responses (seconds). */
const CATALOG_CACHE_TTL_S = 24 * 3600;
/** Freshness window — older entries are served immediately and refreshed in background. */
const CATALOG_FRESH_S = 3600;

interface CatalogCacheEnvelope<T> {
  fetchedAt: number;
  data: T;
}

function wrapCatalogCache<T>(data: T): string {
  const envelope: CatalogCacheEnvelope<T> = { fetchedAt: Date.now(), data };
  return JSON.stringify(envelope);
}

/**
 * Parse catalog KV payload. Supports new `{fetchedAt,data}` envelopes and
 * legacy bare JSON (treated as stale so we refresh in the background).
 */
function parseCatalogCache<T>(raw: string): { data: T; stale: boolean } | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "fetchedAt" in parsed &&
      "data" in parsed
    ) {
      const env = parsed as CatalogCacheEnvelope<T>;
      const ageS = (Date.now() - env.fetchedAt) / 1000;
      return { data: env.data, stale: ageS > CATALOG_FRESH_S };
    }
    return { data: parsed as T, stale: true };
  } catch {
    return null;
  }
}

/**
 * In-process cache for catalog search results (survives across tool invocations). Expires after an hour so a
 * long-lived isolate still sees new Door43 releases, which the packs freshness check depends on.
 */
const CATALOG_PROCESS_CACHE = new Map<
  string,
  { at: number; entries: CatalogEntry[] }
>();
const CATALOG_PROCESS_TTL_MS = 3600 * 1000;

function processCacheGet(key: string): CatalogEntry[] | undefined {
  const hit = CATALOG_PROCESS_CACHE.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CATALOG_PROCESS_TTL_MS) {
    CATALOG_PROCESS_CACHE.delete(key);
    return undefined;
  }
  return hit.entries;
}

function processCacheSet(key: string, entries: CatalogEntry[]): void {
  CATALOG_PROCESS_CACHE.set(key, { at: Date.now(), entries });
}

/** Clear the process-level catalog cache. Used in tests to prevent cross-test pollution. */
export function clearCatalogProcessCache(): void {
  CATALOG_PROCESS_CACHE.clear();
  VARIANT_RESOLVE_CACHE.clear();
  VARIANT_RESOLVE_INFLIGHT.clear();
}

// ---------------------------------------------------------------------------
// Language-variant resolution cache (zero-cost on happy path)
// ---------------------------------------------------------------------------

/**
 * Static map of well-known base-language → variant codes.
 * Keep this small — only stable, widely used variants so
 * {@link findLanguageVariants} can skip a listLanguages() round-trip.
 * Includes es → es-419 (Latin American Spanish is the Door43 strategic Spanish).
 */
const KNOWN_VARIANTS: Record<string, string[]> = {
  // Well-known regional variants — avoids a round-trip to listLanguages()
  es: ["es-419"],
  pt: ["pt-br"],
  zh: ["zh-hans", "zh-tw"],
  ar: ["ar-x-strong"],
};

/**
 * ISO 639-2/639-3 bibliographic codes → Door43 BCP-47 catalog codes.
 * MCP clients and Aquifer sometimes pass three-letter codes (e.g. spa for Spanish).
 */
const ISO639_2_TO_BCP47: Record<string, string> = {
  spa: "es",
  eng: "en",
  fra: "fr",
  deu: "de",
  hin: "hi",
  ind: "id",
  por: "pt",
};

/** Normalize a catalog language tag before DCS lookup (spa → es, trim, lowercase). */
export function normalizeCatalogLanguageCode(lang: string): string {
  const code = lang.trim().toLowerCase();
  return ISO639_2_TO_BCP47[code] ?? code;
}

/** In-process memo: `${base}:${subject}` → resolved code (e.g. "es-419"). */
const VARIANT_RESOLVE_CACHE = new Map<string, string>();

/** Single-flight dedup: concurrent calls for the same key share one Promise. */
const VARIANT_RESOLVE_INFLIGHT = new Map<string, Promise<string>>();

/** KV cache TTL for resolved variants (7 days — variants rarely change). */
const VARIANT_CACHE_TTL_S = 7 * 24 * 3600;

// ---------------------------------------------------------------------------
// KV interface (duck-typed subset of CF KVNamespace so tests can pass null)
// ---------------------------------------------------------------------------

export interface CatalogKVCache {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Maps subject/abbreviation → repo suffix
// ---------------------------------------------------------------------------

/** DCS subject strings → repo-name suffix (e.g. "en_tn"). */
const SUBJECT_TO_SUFFIX: Record<string, string> = {
  "Aligned Bible": "ult", // also covers glt
  "Simplified Bible": "ust", // also covers gst — legacy label
  "Translation Notes": "tn",
  "TSV Translation Notes": "tn",
  "Translation Words": "tw",
  "Translation Academy": "ta",
  "Translation Questions": "tq",
  "TSV Translation Questions": "tq",
  "Translation Word Links": "twl",
  "TSV Translation Words Links": "twl",
  "Open Bible Stories": "obs",
  // OBS helps use hyphenated abbreviations; prefer subject match when
  // abbreviation "obs" also hits OBS Theological Formation (en_obs-tf).
  "TSV OBS Translation Notes": "obs-tn",
  "OBS Translation Notes": "obs-tn",
  "TSV OBS Translation Questions": "obs-tq",
  "OBS Translation Questions": "obs-tq",
  "TSV OBS Study Notes": "obs-sn",
  "OBS Study Notes": "obs-sn",
  "TSV OBS Study Questions": "obs-sq",
  "OBS Study Questions": "obs-sq",
  "TSV OBS Translation Words Links": "obs-twl",
  "OBS Translation Words Links": "obs-twl",
};

/**
 * OBS helps searched like tc-study: stage=prod, one subject, no topic.
 * The story text (Open Bible Stories) is not in this set.
 */
const OBS_HELPS_SUBJECTS: ReadonlySet<string> = new Set([
  "TSV OBS Translation Notes",
  "OBS Translation Notes",
  "TSV OBS Translation Questions",
  "OBS Translation Questions",
  "TSV OBS Translation Words Links",
  "OBS Translation Words Links",
  "TSV OBS Study Notes",
  "OBS Study Notes",
  "TSV OBS Study Questions",
  "OBS Study Questions",
]);

function subjectParts(subject: string | undefined): string[] {
  if (!subject) return [];
  return subject
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** True when every label in a comma-joined subject is an OBS help. */
function isObsHelpsSubject(subject: string | undefined): boolean {
  const parts = subjectParts(subject);
  return (
    parts.length > 0 && parts.every((part) => OBS_HELPS_SUBJECTS.has(part))
  );
}

/** All catalog subject labels that map to a given repo-suffix abbreviation. */
export function subjectsForAbbreviation(abbreviation: string): string[] {
  const abbr = abbreviation.trim().toLowerCase();
  if (!abbr) return [];
  return Object.entries(SUBJECT_TO_SUFFIX)
    .filter(([, suffix]) => suffix.toLowerCase() === abbr)
    .map(([subject]) => subject);
}

/**
 * Derive the repo-suffix abbreviation from a subject string.
 * Accepts comma-separated subjects (first mapped part wins).
 */
export function abbreviationFromSubject(subject: string): string | undefined {
  const parts = subject
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const abbr = SUBJECT_TO_SUFFIX[part];
    if (abbr) return abbr;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  owner: string;
  repo: string;
  name: string;
  subject?: string;
  abbreviation?: string;
  ingredients: Array<{
    identifier: string;
    path: string;
    title?: string;
  }>;
  catalog?: {
    prod?: { branch_or_tag_name?: string; zipball_url?: string };
    preprod?: { branch_or_tag_name?: string; zipball_url?: string };
    latest?: { branch_or_tag_name?: string; zipball_url?: string };
  };
  /** The row's language code, e.g. `es-419`. */
  language?: string;
  /** The release's identity in bt-synergy's `resourceContentStamp` format: `tag#published_at`. */
  stamp?: string;
  /**
   * Whether the hit names a release tag (`release.tag_name`). tc-study's discovery leaves a hit without one out, so
   * the packs freshness check does too. Absent on rows cached before it existed.
   */
  hasRelease?: boolean;
  /**
   * Door43 topics, when known. A catalog search that filters on `topic` does not
   * return this list. Absent means unknown; an empty array means the repo has none.
   */
  topics?: string[];
}

export interface LanguageEntry {
  code: string;
  /** The language's own name, often in its own script (catalog `ln`). */
  name: string;
  /** The catalog's English name (`ang`), e.g. "Bengali, Bangla"; absent when the catalog has none. */
  englishName?: string;
  direction?: "ltr" | "rtl";
}

// ---------------------------------------------------------------------------
// Internal Catalog API shapes
// ---------------------------------------------------------------------------

/** Raw CatalogEntry as returned by the DCS Catalog API. */
interface CatalogApiEntry {
  name: string;
  full_name?: string;
  owner: string;
  language?: string;
  language_title?: string;
  direction?: string;
  subject?: string;
  abbreviation?: string;
  stage?: string;
  branch_or_tag_name?: string;
  zipball_url?: string;
  release?: { tag_name?: string; published_at?: string };
  /** Present only when the caller asked for them. Search rows usually omit this. */
  topics?: unknown;
  ingredients?: Array<{
    identifier?: string;
    path?: string;
    title?: string;
    sort?: number;
    size?: number;
    exists?: boolean;
  }>;
}

interface CatalogSearchResponse {
  ok?: boolean;
  data?: CatalogApiEntry[];
}

interface CatalogListResponse {
  ok?: boolean;
  data?: unknown[];
}

// ---------------------------------------------------------------------------
// URL builder — CATALOG_DEFAULTS (topic=tc-ready, stage=prod), unless OBS helps opt out.
// ---------------------------------------------------------------------------

/**
 * Build a catalog API URL, injecting CATALOG_DEFAULTS.
 * Extra params override defaults when provided (e.g. stage can be overridden).
 * `requireTcReady: false` drops topic and leaves stage=prod.
 */
function buildCatalogUrl(
  endpoint: string,
  extra: Record<string, string | undefined> = {},
  options?: { requireTcReady?: boolean },
): string {
  const params = new URLSearchParams({ ...CATALOG_DEFAULTS });
  if (options?.requireTcReady === false) params.delete("topic");
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  return `${GITEA_API}/${endpoint}?${params.toString()}`;
}

/**
 * OBS helps omit topic unless the caller forces it on.
 * Every other subject keeps topic=tc-ready.
 */
function omitTcReadyTopic(opts: CatalogSearchOptions): boolean {
  if (opts.requireTcReady === true) return false;
  if (opts.requireTcReady === false) return true;
  return isObsHelpsSubject(opts.subject);
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "translation-helps-mcp/2.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from DCS: ${url}`);
  }
  return response.json() as Promise<T>;
}

async function kvGet(
  kv: CatalogKVCache | null | undefined,
  key: string,
): Promise<string | null> {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}

async function kvPut(
  kv: CatalogKVCache | null | undefined,
  key: string,
  value: string,
  ttlSeconds = CATALOG_CACHE_TTL_S,
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, value, { expirationTtl: ttlSeconds });
  } catch {
    // Non-fatal
  }
}

/**
 * Fire-and-forget KV write — never blocks the response critical path. With a context the write is handed to
 * `waitUntil`, since a Worker may cancel a bare promise once its response is sent.
 */
function kvPutBackground(
  kv: CatalogKVCache | null | undefined,
  key: string,
  value: string,
  ttlSeconds = CATALOG_CACHE_TTL_S,
  ctx?: WaitUntilHost,
): void {
  background(kvPut(kv, key, value, ttlSeconds), ctx);
}

function background(work: Promise<void>, ctx?: WaitUntilHost): void {
  if (ctx) ctx.waitUntil(work);
  else void work;
}

// ---------------------------------------------------------------------------
// Catalog search
// ---------------------------------------------------------------------------

export interface CatalogSearchOptions {
  lang?: string;
  subject?: string;
  /** Precise disambiguator (ult, ust, tn, tw, ta, tq, twl, obs…). */
  abbreviation?: string;
  owner?: string;
  stage?: "prod" | "preprod" | "latest";
  /** Rows per page; Door43's default applies when omitted. */
  limit?: number;
  /**
   * When false, the search omits topic=tc-ready (stage=prod stays).
   * Default: true, except OBS help subjects, which omit the topic when this
   * is left unset. Pass true to force the topic even for an OBS help.
   */
  requireTcReady?: boolean;
  kv?: CatalogKVCache | null;
  /** Keeps background KV writes and refreshes alive after the response (a Worker's ExecutionContext). */
  ctx?: WaitUntilHost;
  /**
   * Ask Door43 now, past the isolate's and KV's caches, and write no KV (the isolate's cache still takes the answer).
   * For a check that compares what Door43 has now: a cached search may be an hour behind a release.
   */
  fresh?: boolean;
}

/**
 * Search the DCS Catalog.
 * Bible and other subjects include topic=tc-ready. OBS helps (not the story
 * text) are one subject per request, stage=prod, with no topic — Door43 ANDs
 * a comma-joined subject list. Returns zero or more CatalogEntry objects.
 */
export async function catalogSearch(
  opts: CatalogSearchOptions,
): Promise<CatalogEntry[]> {
  if (
    opts.subject &&
    opts.requireTcReady !== true &&
    isObsHelpsSubject(opts.subject)
  ) {
    const parts = subjectParts(opts.subject);
    if (parts.length > 1) {
      const merged: CatalogEntry[] = [];
      const seen = new Set<string>();
      for (const subject of parts) {
        const rows = await catalogSearch({
          ...opts,
          subject,
          requireTcReady: false,
        });
        for (const row of rows) {
          const key = `${row.owner}/${row.repo}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(row);
        }
      }
      // Each subject may return a single different owner. Rank those together.
      if (merged.length > 1) await markMergedOwners(merged, opts);
      return merged;
    }
  }

  const extra: Record<string, string | undefined> = {
    showIngredients: "true",
  };
  if (opts.lang) extra.lang = opts.lang;
  if (opts.subject) extra.subject = opts.subject;
  if (opts.abbreviation) extra.abbreviation = opts.abbreviation;
  if (opts.owner) extra.owner = opts.owner;
  if (opts.stage) extra.stage = opts.stage;
  if (opts.limit !== undefined) extra.limit = String(opts.limit);

  const url = buildCatalogUrl("catalog/search", extra, {
    requireTcReady: !omitTcReadyTopic(opts),
  });
  const cacheKey = `catalog:search:${url}`;
  if (opts.fresh) return fetchAndStoreCatalogSearch(url, cacheKey, null);

  // L0: in-process cache
  const processHit = processCacheGet(cacheKey);
  if (processHit) return processHit;

  // L1: KV cache (stale-while-revalidate)
  const cached = await kvGet(opts.kv, cacheKey);
  if (cached) {
    const parsed = parseCatalogCache<CatalogEntry[]>(cached);
    if (parsed) {
      processCacheSet(cacheKey, parsed.data);
      if (parsed.stale) {
        background(
          refreshCatalogSearch(url, cacheKey, opts.kv, opts.ctx),
          opts.ctx,
        );
      }
      return parsed.data;
    }
  }

  return fetchAndStoreCatalogSearch(url, cacheKey, opts.kv, opts.ctx);
}

async function fetchAndStoreCatalogSearch(
  url: string,
  cacheKey: string,
  kv: CatalogKVCache | null | undefined,
  ctx?: WaitUntilHost,
): Promise<CatalogEntry[]> {
  let resp: CatalogSearchResponse;
  try {
    resp = await apiFetch<CatalogSearchResponse>(url);
  } catch (err) {
    // Re-throw server errors so callers can distinguish DCS outages from empty results.
    // Only swallow client-side / network errors (non-HTTP failures).
    if (err instanceof Error && err.message.startsWith("HTTP 5")) {
      throw err;
    }
    return [];
  }

  const entries = (resp.data ?? []).map(mapApiEntry);
  if (!new URL(url).searchParams.has("topic") && entries.length > 1) {
    const known = await markTcReadyByCatalogSearch(entries, url);
    if (!known) {
      // Do not cache a choice made while the tc-ready lookup was down.
      rememberFailedTopicLookup(entries);
      return entries;
    }
  }
  processCacheSet(cacheKey, entries);
  kvPutBackground(kv, cacheKey, wrapCatalogCache(entries), undefined, ctx);
  return entries;
}

async function refreshCatalogSearch(
  url: string,
  cacheKey: string,
  kv: CatalogKVCache | null | undefined,
  ctx?: WaitUntilHost,
): Promise<void> {
  try {
    await fetchAndStoreCatalogSearch(url, cacheKey, kv, ctx);
  } catch {
    // Background refresh — ignore failures
  }
}

function sanitizeStampPart(value: string): string {
  return value.replace(/[:|@]/g, "_");
}

/**
 * bt-synergy's `resourceContentStamp` for a catalog hit, whose release is the hit's `release` and whose version is
 * its tag: packs record their sources this way, so the freshness check can compare the two as strings.
 */
function catalogStamp(raw: {
  release?: { tag_name?: string; published_at?: string };
  branch_or_tag_name?: string;
}): string {
  const tag =
    raw.release?.tag_name?.trim() || raw.branch_or_tag_name?.trim() || "";
  const published = raw.release?.published_at?.trim() || "";
  if (tag && published) {
    return `${sanitizeStampPart(tag)}#${sanitizeStampPart(published)}`;
  }
  if (tag) return sanitizeStampPart(tag);
  if (published) return sanitizeStampPart(published);
  return "nostamp";
}

function topicsFromApi(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((topic): topic is string => typeof topic === "string");
}

/**
 * Rows whose tc-ready lookup failed and were not cached. A later merge of the
 * same objects must not probe them again. Cached rows are never added: a
 * failure on those stays unknown so the next request can try again.
 */
const topicLookupFailed = new WeakSet<CatalogEntry>();

function repoIdentity(owner: string, repo: string): string {
  return `${owner.toLowerCase()}\0${repo.toLowerCase()}`;
}

/**
 * Door43's catalog search can filter on topic but does not return the list
 * (Oct 2026). When several owners match, one extra search for the same
 * language and subject with topic=tc-ready marks the rows that appear in
 * both. Rows that already carry `topics` stay. Returns false when that
 * lookup fails: topics stay unset (unknown, not "no tc-ready").
 */
async function markTcReadyByCatalogSearch(
  entries: CatalogEntry[],
  unfilteredUrl: string,
): Promise<boolean> {
  const unmarked = entries.filter(
    (entry) => entry.topics === undefined && !topicLookupFailed.has(entry),
  );
  if (unmarked.length === 0) return true;

  const readyUrl = new URL(unfilteredUrl);
  readyUrl.searchParams.set("topic", "tc-ready");
  try {
    const resp = await apiFetch<CatalogSearchResponse>(readyUrl.toString());
    if (resp.ok === false || !Array.isArray(resp.data)) return false;
    const ready = new Set(
      resp.data.map((raw) => repoIdentity(raw.owner ?? "", raw.name ?? "")),
    );
    for (const entry of unmarked) {
      const id = repoIdentity(entry.owner, entry.repo || entry.name);
      entry.topics = ready.has(id) ? ["tc-ready"] : [];
    }
    return true;
  } catch {
    return false;
  }
}

function rememberFailedTopicLookup(entries: CatalogEntry[]): void {
  for (const entry of entries) {
    if (entry.topics === undefined) topicLookupFailed.add(entry);
  }
}

/**
 * One tc-ready search per subject for rows that a single-owner search left
 * unmarked. Does not record a failure on those rows: they may already sit in
 * the process cache, and the next request should try the lookup again.
 */
async function markMergedOwners(
  entries: CatalogEntry[],
  opts: CatalogSearchOptions,
): Promise<void> {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    if (entry.topics !== undefined || topicLookupFailed.has(entry)) continue;
    const subject = entry.subject?.trim();
    if (!subject) continue;
    const group = groups.get(subject);
    if (group) group.push(entry);
    else groups.set(subject, [entry]);
  }
  for (const [subject, group] of groups) {
    const url = buildCatalogUrl(
      "catalog/search",
      {
        showIngredients: "true",
        lang: opts.lang,
        subject,
        abbreviation: opts.abbreviation,
        owner: opts.owner,
        stage: opts.stage,
        limit: opts.limit !== undefined ? String(opts.limit) : undefined,
      },
      { requireTcReady: false },
    );
    await markTcReadyByCatalogSearch(group, url);
  }
}

/** Map a raw CatalogApiEntry to our CatalogEntry shape. */
function mapApiEntry(raw: CatalogApiEntry): CatalogEntry {
  const ingredients = (raw.ingredients ?? []).map((ing) => ({
    identifier: (ing.identifier ?? "").toUpperCase(),
    path: (ing.path ?? "").replace(/^\.\//, ""),
    title: ing.title,
  }));

  return {
    owner: raw.owner ?? "",
    repo: raw.name ?? "",
    name: raw.name ?? "",
    subject: raw.subject,
    abbreviation: raw.abbreviation,
    ingredients,
    catalog: {
      prod: raw.branch_or_tag_name
        ? {
            branch_or_tag_name: raw.branch_or_tag_name,
            zipball_url: raw.zipball_url,
          }
        : undefined,
    },
    language: raw.language,
    stamp: catalogStamp(raw),
    hasRelease: Boolean(raw.release?.tag_name),
    topics: topicsFromApi(raw.topics),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List languages that have tc-ready resources.
 * Uses /catalog/list/languages?topic=tc-ready.
 */
export async function listLanguages(
  kv?: CatalogKVCache | null,
): Promise<LanguageEntry[]> {
  const url = buildCatalogUrl("catalog/list/languages");
  const cacheKey = `catalog:list:languages:${url}`;

  const cached = await kvGet(kv, cacheKey);
  if (cached) {
    const parsed = parseCatalogCache<LanguageEntry[]>(cached);
    if (parsed) {
      if (parsed.stale) {
        void refreshListLanguages(url, cacheKey, kv);
      }
      return parsed.data;
    }
  }

  return fetchAndStoreListLanguages(url, cacheKey, kv);
}

async function fetchAndStoreListLanguages(
  url: string,
  cacheKey: string,
  kv?: CatalogKVCache | null,
): Promise<LanguageEntry[]> {
  try {
    const resp = await apiFetch<CatalogListResponse>(url);
    const raw = (resp.data ?? []) as Array<Record<string, unknown>>;
    const entries: LanguageEntry[] = raw
      .map((item) => ({
        code: String(item["lang"] ?? item["lc"] ?? ""),
        name: String(
          item["language_title"] ?? item["ln"] ?? item["lang"] ?? "",
        ),
        englishName: item["ang"] ? String(item["ang"]) : undefined,
        direction:
          (item["ld"] ?? item["direction"]) === "rtl"
            ? "rtl"
            : ("ltr" as "ltr" | "rtl"),
      }))
      .filter((e) => e.code);
    kvPutBackground(kv, cacheKey, wrapCatalogCache(entries));
    return entries;
  } catch {
    return [];
  }
}

async function refreshListLanguages(
  url: string,
  cacheKey: string,
  kv?: CatalogKVCache | null,
): Promise<void> {
  try {
    await fetchAndStoreListLanguages(url, cacheKey, kv);
  } catch {
    // ignore
  }
}

/** List known resource subjects (tc-ready only). */
export async function listSubjects(
  kv?: CatalogKVCache | null,
): Promise<string[]> {
  const url = buildCatalogUrl("catalog/list/subjects");
  const cacheKey = `catalog:list:subjects:${url}`;

  const cached = await kvGet(kv, cacheKey);
  if (cached) {
    const parsed = parseCatalogCache<string[]>(cached);
    if (parsed) {
      if (parsed.stale) {
        void refreshListSubjects(url, cacheKey, kv);
      }
      return parsed.data;
    }
  }

  return fetchAndStoreListSubjects(url, cacheKey, kv);
}

async function fetchAndStoreListSubjects(
  url: string,
  cacheKey: string,
  kv?: CatalogKVCache | null,
): Promise<string[]> {
  try {
    const resp = await apiFetch<CatalogListResponse>(url);
    const raw = (resp.data ?? []) as Array<Record<string, unknown>>;
    const subjects = raw
      .map((item) => String(item["subject"] ?? ""))
      .filter(Boolean);
    const result =
      subjects.length > 0 ? subjects : Object.keys(SUBJECT_TO_SUFFIX);
    kvPutBackground(kv, cacheKey, wrapCatalogCache(result));
    return result;
  } catch {
    return Object.keys(SUBJECT_TO_SUFFIX);
  }
}

async function refreshListSubjects(
  url: string,
  cacheKey: string,
  kv?: CatalogKVCache | null,
): Promise<void> {
  try {
    await fetchAndStoreListSubjects(url, cacheKey, kv);
  } catch {
    // ignore
  }
}

/** List all tc-ready resources for a given language. */
export async function listResourcesForLanguage(
  languageCode: string,
  opts?: {
    subject?: string;
    /** @deprecated owner filtering is no longer applied; pass undefined or omit */
    organization?: string;
    stage?: "prod" | "preprod" | "latest";
    kv?: CatalogKVCache | null;
  },
): Promise<CatalogEntry[]> {
  return catalogSearch({
    lang: languageCode,
    subject: opts?.subject,
    stage: opts?.stage ?? "prod",
    kv: opts?.kv,
  });
}

/**
 * Find all language variant codes for a base language code.
 *
 * Performance notes:
 * - If base already contains a hyphen (e.g. "es-419") returns [] immediately.
 * - Checks KNOWN_VARIANTS first (synchronous, no network).
 * - Otherwise filters the cached `listLanguages()` result — usually a KV hit
 *   since the language gate fetched it earlier in the conversation.
 *
 * @example findLanguageVariants("es") → ["es-419"]
 * @example findLanguageVariants("es-419") → []  (already a variant)
 */
export async function findLanguageVariants(
  base: string,
  kv?: CatalogKVCache | null,
): Promise<string[]> {
  if (base.includes("-")) return [];

  const known = KNOWN_VARIANTS[base];
  if (known) return known;

  const all = await listLanguages(kv);
  const prefix = base + "-";
  return all
    .map((e) => e.code)
    .filter((c) => c.startsWith(prefix))
    .sort();
}

/**
 * Resolve an effective catalog language code, falling back to a variant when
 * the exact code yields no resources.
 *
 * Guarantees:
 * - Happy path (exact code has resources): zero added overhead — the first
 *   `catalogSearch` is already L0 in-process + L1 KV cached.
 * - Miss path: variant discovery and per-variant catalog searches are all
 *   individually cached; parallel fan-out calls share a single in-flight
 *   resolution via single-flight dedup; the result is memoized for 7 days.
 *
 * Returns `{ language, entries }` where `language` may differ from the input
 * (e.g. "es" → "es-419").
 */
export async function resolveCatalogLanguage(
  lang: string,
  opts: { subject?: string; kv?: CatalogKVCache | null } = {},
): Promise<{ language: string; entries: CatalogEntry[] }> {
  const { subject, kv } = opts;
  lang = normalizeCatalogLanguageCode(lang);

  // Fast path: exact match already in catalog
  const exact = await catalogSearch({ lang, subject, kv });
  if (exact.length > 0) return { language: lang, entries: exact };

  // Skip variant discovery for codes that already have a region (e.g. es-419
  // has no resources — no point looking for es-419-*).
  if (lang.includes("-")) return { language: lang, entries: [] };

  // --- Miss path with memoization + single-flight dedup ---
  const memoKey = `${lang}:${subject ?? ""}`;

  // L0: in-process memo
  const memo = VARIANT_RESOLVE_CACHE.get(memoKey);
  if (memo) {
    const variantEntries = await catalogSearch({ lang: memo, subject, kv });
    return { language: memo, entries: variantEntries };
  }

  // L1: KV memo
  const kvKey = `langvariant:${memoKey}`;
  const kvMemo = await kvGet(kv, kvKey);
  if (kvMemo) {
    VARIANT_RESOLVE_CACHE.set(memoKey, kvMemo);
    const variantEntries = await catalogSearch({ lang: kvMemo, subject, kv });
    return { language: kvMemo, entries: variantEntries };
  }

  // Single-flight: share one discovery among concurrent callers for the same key
  const inflight = VARIANT_INFLIGHT(
    memoKey,
    async () => {
      const variants = await findLanguageVariants(lang, kv);
      for (const v of variants) {
        const vEntries = await catalogSearch({ lang: v, subject, kv });
        if (vEntries.length > 0) return v;
      }
      return lang; // no variant found — callers will receive empty entries
    },
    kv,
    kvKey,
  );

  const resolved = await inflight;
  const resolvedEntries =
    resolved !== lang
      ? await catalogSearch({ lang: resolved, subject, kv })
      : [];
  return { language: resolved, entries: resolvedEntries };
}

/** Single-flight helper — ensures concurrent callers for the same key share one Promise. */
function VARIANT_INFLIGHT(
  memoKey: string,
  factory: () => Promise<string>,
  kv: CatalogKVCache | null | undefined,
  kvKey: string,
): Promise<string> {
  const existing = VARIANT_RESOLVE_INFLIGHT.get(memoKey);
  if (existing) return existing;

  const p = factory()
    .then((resolved) => {
      VARIANT_RESOLVE_CACHE.set(memoKey, resolved);
      VARIANT_RESOLVE_INFLIGHT.delete(memoKey);
      // Best-effort KV persist (don't await — never block the response)
      void kvPut(kv, kvKey, resolved, VARIANT_CACHE_TTL_S);
      return resolved;
    })
    .catch(() => {
      VARIANT_RESOLVE_INFLIGHT.delete(memoKey);
      return memoKey.split(":")[0]; // return original base on error
    });

  VARIANT_RESOLVE_INFLIGHT.set(memoKey, p);
  return p;
}

/**
 * Prefer a hit that also has the tc-ready topic, when any row carries topics.
 * Then entries matching `preferredSubject` (when set), then `preferredOwner`.
 * Many gateway languages publish TW/TA under community orgs
 * (e.g. es-419_gl, translationCore-Create-BCS) rather than unfoldingWord.
 * Abbreviation "obs" can match both Open Bible Stories and OBS Theological
 * Formation — subject preference avoids wiring the wrong zip.
 *
 * Rows from a topic=tc-ready search usually omit `topics`. They keep the
 * subject-then-owner order. OBS helps omit the topic filter, so several
 * owners can match; a row marked tc-ready (from the row itself, or from one
 * extra catalog search) wins before that order. Unknown topics do not.
 */
export function pickPreferredCatalogEntry(
  results: CatalogEntry[],
  preferredOwner = "unfoldingWord",
  preferredSubject?: string,
): CatalogEntry | undefined {
  if (results.length === 0) return undefined;

  const ready = results.filter((r) => r.topics?.includes("tc-ready"));
  const candidates = ready.length > 0 ? ready : results;

  const subjectNorm = preferredSubject?.trim().toLowerCase();
  const subjectPool = subjectNorm
    ? candidates.filter((r) => (r.subject ?? "").toLowerCase() === subjectNorm)
    : [];
  const pool = subjectPool.length > 0 ? subjectPool : candidates;

  if (!preferredOwner) return pool[0];
  return (
    pool.find((r) => r.owner.toLowerCase() === preferredOwner.toLowerCase()) ??
    pool[0]
  );
}

/**
 * Resolve a specific resource's ZIP URL.
 *
 * Strategy:
 *   1. Try Catalog API with lang + abbreviation (precise).
 *   2. Fall back to Catalog API with lang + subject.
 *   3. Language-variant fallback (e.g. "es" → "es-419").
 *
 * Catalog queries use lang/subject/abbreviation only — never an owner filter.
 * `organization`, when provided, is a ranking preference among hits via
 * {@link pickPreferredCatalogEntry}; when omitted, UW is still preferred among
 * results without excluding other owners.
 *
 * @param abbreviation - preferred: exact repo suffix (ult, ust, tn, tw, ta, tq, twl)
 */
export async function getResourceZipUrl(
  languageCode: string,
  subject: string,
  organization?: string,
  _stage: "prod" | "preprod" | "latest" = "prod",
  kv?: CatalogKVCache | null,
): Promise<{ zipUrl: string; entry: CatalogEntry } | null> {
  // Derive abbreviation from subject for precise disambiguation
  const abbreviation = abbreviationFromSubject(subject);
  const preferredSubject = subject.includes(",")
    ? subject.split(",")[0]?.trim()
    : subject;
  // Abbreviation search sends topic=tc-ready and no subject. OBS helps must
  // be one subject at a time, with no topic, so that search is skipped.
  const obsHelps = isObsHelpsSubject(subject);

  const zipFromEntry = (
    entry: CatalogEntry,
  ): { zipUrl: string; entry: CatalogEntry } => ({
    zipUrl:
      entry.catalog?.prod?.zipball_url ??
      `${GITEA_BASE}/${entry.owner}/${entry.repo}/archive/${entry.catalog?.prod?.branch_or_tag_name ?? "master"}.zip`,
    entry,
  });

  // 1. Try Catalog by abbreviation (most precise — avoids ULT/UST confusion).
  //    Still pass subject so "obs" prefers Open Bible Stories over obs-tf.
  if (abbreviation && !obsHelps) {
    const results = await catalogSearch({
      lang: languageCode,
      abbreviation,
      kv,
    });
    const entry = pickPreferredCatalogEntry(
      results,
      organization,
      preferredSubject,
    );
    if (entry) return zipFromEntry(entry);
    // NOTE: do NOT early-return here when empty — fall through to subject /
    // language-variant fallback (e.g. "es" → "es-419").
  }

  // 2. Try Catalog by subject (broader match). Include subject aliases that
  //    map to the same abbreviation (e.g. "TSV OBS Translation Questions" and
  //    "OBS Translation Questions" both → obs-tq) so gateway languages that
  //    omit the "TSV " prefix still resolve.
  if (subject) {
    const subjectQuery = abbreviation
      ? subjectsForAbbreviation(abbreviation).join(",") || subject
      : subject;
    const results = await catalogSearch({
      lang: languageCode,
      subject: subjectQuery,
      kv,
      ...(obsHelps ? { requireTcReady: false } : {}),
    });
    const entry = pickPreferredCatalogEntry(
      results,
      organization,
      preferredSubject,
    );
    if (entry) return zipFromEntry(entry);
    // NOTE: do NOT early-return here — fall through to language-variant fallback.
  }

  // 3. Language-variant fallback (e.g. "es" → "es-419").
  //    Only attempted for base codes (no hyphen) to avoid infinite loops.
  //    All underlying calls are already memoized so the overhead is paid once.
  if (!languageCode.includes("-")) {
    const variants = await findLanguageVariants(languageCode, kv);
    for (const v of variants) {
      const variantResult = await getResourceZipUrl(
        v,
        subject,
        organization,
        "prod",
        kv,
      );
      if (variantResult) return variantResult;
    }
  }

  return null;
}

/**
 * Resolve by explicit abbreviation (ult, ust, tn, etc.) — preferred over subject.
 * Used by tests and callers that already know the repo suffix (ult vs ust).
 *
 * Strategy mirrors {@link getResourceZipUrl}:
 *   1. Catalog by lang + abbreviation (no owner filter).
 *   2. Language-variant fallback (e.g. "es" → "es-419").
 *
 * Optional `organization` ranks among hits via {@link pickPreferredCatalogEntry}.
 */
export async function getResourceZipUrlByAbbreviation(
  languageCode: string,
  abbreviation: string,
  organization?: string,
  kv?: CatalogKVCache | null,
): Promise<{ zipUrl: string; entry: CatalogEntry } | null> {
  const results = await catalogSearch({ lang: languageCode, abbreviation, kv });
  const entry = pickPreferredCatalogEntry(results, organization);
  if (entry) {
    const zipUrl =
      entry.catalog?.prod?.zipball_url ??
      `${GITEA_BASE}/${entry.owner}/${entry.repo}/archive/${entry.catalog?.prod?.branch_or_tag_name ?? "master"}.zip`;
    return { zipUrl, entry };
  }

  // Language-variant fallback (e.g. "es" → "es-419"), same as getResourceZipUrl.
  if (!languageCode.includes("-")) {
    const variants = await findLanguageVariants(languageCode, kv);
    for (const v of variants) {
      const variantResult = await getResourceZipUrlByAbbreviation(
        v,
        abbreviation,
        organization,
        kv,
      );
      if (variantResult) return variantResult;
    }
  }

  return null;
}
