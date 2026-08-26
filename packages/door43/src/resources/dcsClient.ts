/**
 * Door43 Content Service (DCS) API client — v2 with Catalog API.
 *
 * All fetching goes through https://git.door43.org (Gitea + built-in Catalog).
 * The Catalog API lives at /api/v1/catalog/* — NOT at a separate host.
 *
 * Key invariants:
 *   - Every catalog request includes topic=tc-ready (centralised in buildCatalogUrl).
 *   - Catalog-first discovery; Gitea tree fallback only when catalog returns nothing.
 *   - Catalog JSON responses are cached in KV (24 h TTL) with 1 h
 *     stale-while-revalidate freshness.
 */

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

/** In-process cache for catalog search results (survives across tool invocations). */
const CATALOG_PROCESS_CACHE = new Map<string, CatalogEntry[]>();

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
};

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
}

export interface LanguageEntry {
  code: string;
  name: string;
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
// URL builder — always includes CATALOG_DEFAULTS (topic=tc-ready etc.)
// ---------------------------------------------------------------------------

/**
 * Build a catalog API URL, always injecting CATALOG_DEFAULTS.
 * Extra params override defaults when provided (e.g. stage can be overridden).
 */
function buildCatalogUrl(
  endpoint: string,
  extra: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams({ ...CATALOG_DEFAULTS });
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  return `${GITEA_API}/${endpoint}?${params.toString()}`;
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

/** Fire-and-forget KV write — never blocks the response critical path. */
function kvPutBackground(
  kv: CatalogKVCache | null | undefined,
  key: string,
  value: string,
  ttlSeconds = CATALOG_CACHE_TTL_S,
): void {
  void kvPut(kv, key, value, ttlSeconds);
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
  /** Pass false only in exceptional cases (tests). Default true = tc-ready applied. */
  kv?: CatalogKVCache | null;
}

/**
 * Search the DCS Catalog. Always applies topic=tc-ready.
 * Returns zero or more CatalogEntry objects mapped from the API response.
 */
export async function catalogSearch(
  opts: CatalogSearchOptions,
): Promise<CatalogEntry[]> {
  const extra: Record<string, string | undefined> = {
    showIngredients: "true",
  };
  if (opts.lang) extra.lang = opts.lang;
  if (opts.subject) extra.subject = opts.subject;
  if (opts.abbreviation) extra.abbreviation = opts.abbreviation;
  if (opts.owner) extra.owner = opts.owner;
  if (opts.stage) extra.stage = opts.stage;

  const url = buildCatalogUrl("catalog/search", extra);
  const cacheKey = `catalog:search:${url}`;

  // L0: in-process cache
  const processHit = CATALOG_PROCESS_CACHE.get(cacheKey);
  if (processHit) return processHit;

  // L1: KV cache (stale-while-revalidate)
  const cached = await kvGet(opts.kv, cacheKey);
  if (cached) {
    const parsed = parseCatalogCache<CatalogEntry[]>(cached);
    if (parsed) {
      CATALOG_PROCESS_CACHE.set(cacheKey, parsed.data);
      if (parsed.stale) {
        void refreshCatalogSearch(url, cacheKey, opts.kv);
      }
      return parsed.data;
    }
  }

  return fetchAndStoreCatalogSearch(url, cacheKey, opts.kv);
}

async function fetchAndStoreCatalogSearch(
  url: string,
  cacheKey: string,
  kv: CatalogKVCache | null | undefined,
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
  CATALOG_PROCESS_CACHE.set(cacheKey, entries);
  kvPutBackground(kv, cacheKey, wrapCatalogCache(entries));
  return entries;
}

async function refreshCatalogSearch(
  url: string,
  cacheKey: string,
  kv: CatalogKVCache | null | undefined,
): Promise<void> {
  try {
    await fetchAndStoreCatalogSearch(url, cacheKey, kv);
  } catch {
    // Background refresh — ignore failures
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
 * Prefer entries matching `preferredSubject` (when set), then `preferredOwner`.
 * Many gateway languages publish TW/TA under community orgs
 * (e.g. es-419_gl, translationCore-Create-BCS) rather than unfoldingWord.
 * Abbreviation "obs" can match both Open Bible Stories and OBS Theological
 * Formation — subject preference avoids wiring the wrong zip.
 */
export function pickPreferredCatalogEntry(
  results: CatalogEntry[],
  preferredOwner = "unfoldingWord",
  preferredSubject?: string,
): CatalogEntry | undefined {
  if (results.length === 0) return undefined;

  const subjectNorm = preferredSubject?.trim().toLowerCase();
  const subjectPool = subjectNorm
    ? results.filter((r) => (r.subject ?? "").toLowerCase() === subjectNorm)
    : [];
  const pool = subjectPool.length > 0 ? subjectPool : results;

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
  if (abbreviation) {
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
