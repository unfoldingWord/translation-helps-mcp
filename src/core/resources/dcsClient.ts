/**
 * Door43 Content Service (DCS) API client — v2 with Catalog API.
 *
 * All fetching goes through https://git.door43.org (Gitea + built-in Catalog).
 * The Catalog API lives at /api/v1/catalog/* — NOT at a separate host.
 *
 * Key invariants:
 *   - Every catalog request includes topic=tc-ready (centralised in buildCatalogUrl).
 *   - Catalog-first discovery; Gitea tree fallback only when catalog returns nothing.
 *   - Catalog JSON responses are cached in KV (1 h TTL).
 */

const GITEA_API = "https://git.door43.org/api/v1";
const GITEA_BASE = "https://git.door43.org";

/** Default catalog query params always injected — centralised so no call site can forget. */
const CATALOG_DEFAULTS: Record<string, string> = {
  topic: "tc-ready",
  stage: "prod",
};

/** KV cache TTL for catalog responses (seconds). */
const CATALOG_CACHE_TTL_S = 3600;

/** In-process cache for catalog search results (survives across tool invocations). */
const CATALOG_PROCESS_CACHE = new Map<string, CatalogEntry[]>();

// ---------------------------------------------------------------------------
// Language-variant resolution cache (zero-cost on happy path)
// ---------------------------------------------------------------------------

/**
 * Static map of well-known base-language → variant codes.
 * Keep this small. Do NOT add es → es-419 here; it exists in the DCS catalog
 * and is discovered + cached dynamically to avoid org-specific retry problems.
 */
const KNOWN_VARIANTS: Record<string, string[]> = {
  pt: ["pt-br"],
  zh: ["zh-tw"],
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
  "Aligned Bible": "ult",           // also covers glt
  "Simplified Bible": "ust",        // also covers gst — legacy label
  "Translation Notes": "tn",
  "TSV Translation Notes": "tn",
  "Translation Words": "tw",
  "Translation Academy": "ta",
  "Translation Questions": "tq",
  "TSV Translation Questions": "tq",
  "Translation Word Links": "twl",
  "TSV Translation Words Links": "twl",
  "Open Bible Stories": "obs",
};

/** Abbreviation → subject string (for catalog searches that need subject). */
const ABBREV_TO_SUBJECT: Record<string, string> = {
  ult: "Aligned Bible",
  glt: "Aligned Bible",
  ust: "Simplified Bible",
  gst: "Simplified Bible",
  tn: "TSV Translation Notes",
  tw: "Translation Words",
  ta: "Translation Academy",
  tq: "TSV Translation Questions",
  twl: "TSV Translation Words Links",
  obs: "Open Bible Stories",
};

/** Standard USFM book codes → two-digit prefix (fallback only). */
const BOOK_FILE_NUMBERS: Record<string, string> = {
  GEN:"01",EXO:"02",LEV:"03",NUM:"04",DEU:"05",JOS:"06",JDG:"07",RUT:"08",
  "1SA":"09","2SA":"10","1KI":"11","2KI":"12","1CH":"13","2CH":"14",
  EZR:"15",NEH:"16",EST:"17",JOB:"18",PSA:"19",PRO:"20",ECC:"21",
  SNG:"22",ISA:"23",JER:"24",LAM:"25",EZK:"26",DAN:"27",HOS:"28",
  JOL:"29",AMO:"30",OBA:"31",JON:"32",MIC:"33",NAM:"34",HAB:"35",
  ZEP:"36",HAG:"37",ZEC:"38",MAL:"39",
  MAT:"41",MRK:"42",LUK:"43",JHN:"44",ACT:"45",ROM:"46",
  "1CO":"47","2CO":"48",GAL:"49",EPH:"50",PHP:"51",COL:"52",
  "1TH":"53","2TH":"54","1TI":"55","2TI":"56",TIT:"57",PHM:"58",
  HEB:"59",JAS:"60","1PE":"61","2PE":"62","1JN":"63","2JN":"64",
  "3JN":"65",JUD:"66",REV:"67",
};

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
// Internal Gitea / Catalog API shapes
// ---------------------------------------------------------------------------

interface GiteaRepo {
  name: string;
  default_branch: string;
  owner: { login: string };
  description?: string;
}

interface GiteaTreeEntry {
  path: string;
  type: "blob" | "tree";
}

interface GiteaOrgSearchResult {
  data: GiteaRepo[];
}

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

  // L1: KV cache
  const cached = await kvGet(opts.kv, cacheKey);
  if (cached) {
    try {
      const entries = JSON.parse(cached) as CatalogEntry[];
      CATALOG_PROCESS_CACHE.set(cacheKey, entries);
      return entries;
    } catch {
      // corrupted — re-fetch
    }
  }

  let resp: CatalogSearchResponse;
  try {
    resp = await apiFetch<CatalogSearchResponse>(url);
  } catch {
    return [];
  }

  const entries = (resp.data ?? []).map(mapApiEntry);
  CATALOG_PROCESS_CACHE.set(cacheKey, entries);
  await kvPut(opts.kv, cacheKey, JSON.stringify(entries));
  return entries;
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
// Gitea fallback (used when catalog returns nothing)
// ---------------------------------------------------------------------------

async function buildEntryViaGitea(
  organization: string,
  repoName: string,
  subject: string,
): Promise<{ zipUrl: string; entry: CatalogEntry } | null> {
  let repo: GiteaRepo;
  try {
    const res = await fetch(
      `${GITEA_API}/repos/${organization}/${repoName}`,
      {
        headers: {
          "User-Agent": "translation-helps-mcp/2.0",
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) return null;
    repo = (await res.json()) as GiteaRepo;
  } catch {
    return null;
  }

  const branch = repo.default_branch || "master";
  const zipUrl = `${GITEA_BASE}/${organization}/${repoName}/archive/${branch}.zip`;

  const ingredients: CatalogEntry["ingredients"] = [];
  try {
    const treeRes = await fetch(
      `${GITEA_API}/repos/${organization}/${repoName}/git/trees/${branch}?recursive=false`,
      {
        headers: {
          "User-Agent": "translation-helps-mcp/2.0",
          Accept: "application/json",
        },
      },
    );
    if (treeRes.ok) {
      const tree = (await treeRes.json()) as { tree?: GiteaTreeEntry[] };
      for (const item of tree.tree ?? []) {
        if (item.type !== "blob") continue;
        const usfmMatch = item.path.match(/^(\d+)-([A-Z0-9]+)\.usfm$/i);
        if (usfmMatch) {
          ingredients.push({
            identifier: usfmMatch[2].toUpperCase(),
            path: item.path,
          });
          continue;
        }
        const tsvMatch = item.path.match(/^(?:tn|tq|twl)_([A-Z0-9]+)\.tsv$/i);
        if (tsvMatch) {
          ingredients.push({
            identifier: tsvMatch[1].toUpperCase(),
            path: item.path,
          });
        }
      }
    }
  } catch {
    // Continue with empty ingredients.
  }

  if (ingredients.length === 0) {
    for (const [book, num] of Object.entries(BOOK_FILE_NUMBERS)) {
      ingredients.push({ identifier: book, path: `${num}-${book}.usfm` });
    }
  }

  return {
    zipUrl,
    entry: {
      owner: organization,
      repo: repoName,
      name: repoName,
      subject,
      ingredients,
      catalog: {
        prod: { zipball_url: zipUrl, branch_or_tag_name: branch },
      },
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
    try {
      return JSON.parse(cached) as LanguageEntry[];
    } catch {
      // re-fetch
    }
  }

  try {
    const resp = await apiFetch<CatalogListResponse>(url);
    const raw = (resp.data ?? []) as Array<Record<string, unknown>>;
    const entries: LanguageEntry[] = raw.map((item) => ({
      code: String(item["lang"] ?? item["lc"] ?? ""),
      name: String(item["language_title"] ?? item["ln"] ?? item["lang"] ?? ""),
      direction: (item["ld"] ?? item["direction"]) === "rtl" ? "rtl" : ("ltr" as "ltr" | "rtl"),
    })).filter((e) => e.code);
    await kvPut(kv, cacheKey, JSON.stringify(entries));
    return entries;
  } catch {
    return [];
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
    try {
      return JSON.parse(cached) as string[];
    } catch {
      // re-fetch
    }
  }

  try {
    const resp = await apiFetch<CatalogListResponse>(url);
    const raw = (resp.data ?? []) as Array<Record<string, unknown>>;
    const subjects = raw
      .map((item) => String(item["subject"] ?? ""))
      .filter(Boolean);
    const result = subjects.length > 0 ? subjects : Object.keys(SUBJECT_TO_SUFFIX);
    await kvPut(kv, cacheKey, JSON.stringify(result));
    return result;
  } catch {
    return Object.keys(SUBJECT_TO_SUFFIX);
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
  const inflight = VARIANT_INFLIGHT(memoKey, async () => {
    const variants = await findLanguageVariants(lang, kv);
    for (const v of variants) {
      const vEntries = await catalogSearch({ lang: v, subject, kv });
      if (vEntries.length > 0) return v;
    }
    return lang; // no variant found — callers will receive empty entries
  }, kv, kvKey);

  const resolved = await inflight;
  const resolvedEntries = resolved !== lang
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

  const p = factory().then((resolved) => {
    VARIANT_RESOLVE_CACHE.set(memoKey, resolved);
    VARIANT_RESOLVE_INFLIGHT.delete(memoKey);
    // Best-effort KV persist (don't await — never block the response)
    void kvPut(kv, kvKey, resolved, VARIANT_CACHE_TTL_S);
    return resolved;
  }).catch(() => {
    VARIANT_RESOLVE_INFLIGHT.delete(memoKey);
    return memoKey.split(":")[0]; // return original base on error
  });

  VARIANT_RESOLVE_INFLIGHT.set(memoKey, p);
  return p;
}

/**
 * Resolve a specific resource's ZIP URL.
 *
 * Strategy:
 *   1. Try Catalog API with lang + abbreviation (precise).
 *   2. Fall back to Catalog API with lang + subject.
 *   3. Fall back to Gitea tree walk.
 *
 * @param abbreviation - preferred: exact repo suffix (ult, ust, tn, tw, ta, tq, twl)
 */
export async function getResourceZipUrl(
  languageCode: string,
  subject: string,
  _organization = "unfoldingWord",
  _stage: "prod" | "preprod" | "latest" = "prod",
  kv?: CatalogKVCache | null,
): Promise<{ zipUrl: string; entry: CatalogEntry } | null> {
  // Derive abbreviation from subject for precise disambiguation
  const abbreviation = SUBJECT_TO_SUFFIX[subject];

  // 1. Try Catalog by abbreviation (most precise — avoids ULT/UST confusion)
  if (abbreviation) {
    const results = await catalogSearch({ lang: languageCode, abbreviation, kv });
    const entry = results[0];
    if (entry) {
      const zipUrl =
        entry.catalog?.prod?.zipball_url ??
        `${GITEA_BASE}/${entry.owner}/${entry.repo}/archive/${entry.catalog?.prod?.branch_or_tag_name ?? "master"}.zip`;
      return { zipUrl, entry };
    }
  }

  // 2. Try Catalog by subject (broader match)
  if (subject) {
    const results = await catalogSearch({ lang: languageCode, subject, kv });
    const entry = results[0];
    if (entry) {
      const zipUrl =
        entry.catalog?.prod?.zipball_url ??
        `${GITEA_BASE}/${entry.owner}/${entry.repo}/archive/${entry.catalog?.prod?.branch_or_tag_name ?? "master"}.zip`;
      return { zipUrl, entry };
    }
  }

  // 3. Language-variant fallback (e.g. "es" → "es-419").
  //    Only attempted for base codes (no hyphen) to avoid infinite loops.
  //    All underlying calls are already memoized so the overhead is paid once.
  if (!languageCode.includes("-")) {
    const variants = await findLanguageVariants(languageCode, kv);
    for (const v of variants) {
      const variantResult = await getResourceZipUrl(v, subject, _organization, "prod", kv);
      if (variantResult) return variantResult;
    }
  }

  return null;
}

/**
 * Resolve by explicit abbreviation (ult, ust, tn, etc.) — preferred over subject.
 * Used by fetch_scripture to distinguish ULT from UST precisely.
 */
export async function getResourceZipUrlByAbbreviation(
  languageCode: string,
  abbreviation: string,
  _organization = "unfoldingWord",
  kv?: CatalogKVCache | null,
): Promise<{ zipUrl: string; entry: CatalogEntry } | null> {
  const results = await catalogSearch({ lang: languageCode, abbreviation, kv });
  const entry = results[0];
  if (entry) {
    const zipUrl =
      entry.catalog?.prod?.zipball_url ??
      `${GITEA_BASE}/${entry.owner}/${entry.repo}/archive/${entry.catalog?.prod?.branch_or_tag_name ?? "master"}.zip`;
    return { zipUrl, entry };
  }
  return null;
}
