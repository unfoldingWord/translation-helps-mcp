/**
 * src/core/resources/articleToc.ts
 *
 * Build and cache per-language slug→title maps for Translation Academy (TA)
 * and Translation Words (TW).
 *
 * Mirrors tc-study's `useEntryTitles` / `findTitleInIngredients` pattern but
 * runs server-side with a KV-backed cache so every request after the first
 * warm-up gets O(1) title resolution.
 *
 * Cache hierarchy for `getArticleTitleMap`:
 *   1. In-process Map (per Worker invocation — avoids repeat KV reads in the
 *      same request).
 *   2. KV key `toc:ta:{lang}` / `toc:tw:{lang}` (JSON-serialised slug→title,
 *      24h TTL — same lifetime as the article-list caches).
 *   3. Build from the already-cached article list in KV (`catalog:ta:{lang}` /
 *      `catalog:tw:{lang}`) if present.
 *   4. Full build from the resource ZIP (downloads if needed, same path as
 *      /api/v1/academy and /api/v1/words).
 *
 * `resolveTitleFromToc(map, pathOrRc)`: normalise an rc:// URI or bare slug,
 * then probe the map with several matching strategies (exact, last-segment for
 * TA, category/term for TW).  Returns null on miss.
 */

import { getResourceZipUrl } from "./dcsClient.js";
import {
  parseTaArticlePathsFromZipEntries,
  buildTaArticle,
  parseTwArticlePathsFromZipEntries,
  buildTwArticle,
} from "../parsers/catalogParsers.js";
import { ZipResourceFetcher2 } from "./ZipResourceFetcher2.js";

// ---------------------------------------------------------------------------
// Env subset (only the bindings we need)
// ---------------------------------------------------------------------------

export interface TocEnv {
  TRANSLATION_HELPS_CACHE?: KVNamespace;
  ZIP_FILES?: R2Bucket;
}

// ---------------------------------------------------------------------------
// In-process cache (cleared between Workers isolate lifetimes)
// ---------------------------------------------------------------------------

const PROCESS_CACHE = new Map<string, Map<string, string>>();

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

const TOC_TTL_S = 86400; // 24 h — same as article-list caches

async function kvGet(kv: KVNamespace | undefined, key: string): Promise<string | null> {
  if (!kv) return null;
  try { return await kv.get(key); }
  catch { return null; }
}

async function kvPut(kv: KVNamespace | undefined, key: string, value: string): Promise<void> {
  if (!kv) return;
  try { await kv.put(key, value, { expirationTtl: TOC_TTL_S }); }
  catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

function buildFetcher(env: TocEnv): ZipResourceFetcher2 {
  return new ZipResourceFetcher2({
    KV: env.TRANSLATION_HELPS_CACHE,
    R2: env.ZIP_FILES,
  });
}

async function buildTaMap(language: string, env: TocEnv): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const kv = env.TRANSLATION_HELPS_CACHE;

  // L1: existing article-list cache (built by /api/v1/academy)
  const listCached = await kvGet(kv, `catalog:ta:${language}`);
  if (listCached) {
    try {
      const articles = JSON.parse(listCached) as Array<{ path: string; title: string }>;
      for (const a of articles) {
        if (a.path && a.title) map.set(a.path, a.title);
      }
      return map;
    } catch { /* fall through to full build */ }
  }

  // L2: full build from ZIP
  const resolved = await getResourceZipUrl(language, "Translation Academy", "unfoldingWord", "prod", kv);
  if (!resolved) return map;

  const fetcher = buildFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
  const entries = fetcher.listZipEntries(zip);
  const slugs = parseTaArticlePathsFromZipEntries(entries);

  await Promise.all(
    slugs.map(async (slug) => {
      const titleMd = await fetcher.extractFileFromZip(zip, `${slug}/title.md`);
      const article = buildTaArticle(slug, titleMd);
      if (article.title) map.set(article.path, article.title);
    }),
  );

  return map;
}

async function buildTwMap(language: string, env: TocEnv): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const kv = env.TRANSLATION_HELPS_CACHE;

  // L1: existing article-list cache (built by /api/v1/words)
  const listCached = await kvGet(kv, `catalog:tw:${language}`);
  if (listCached) {
    try {
      const articles = JSON.parse(listCached) as Array<{ path: string; title: string }>;
      for (const a of articles) {
        if (a.path && a.title) map.set(a.path, a.title);
      }
      return map;
    } catch { /* fall through to full build */ }
  }

  // L2: full build from ZIP
  const resolved = await getResourceZipUrl(language, "Translation Words", "unfoldingWord", "prod", kv);
  if (!resolved) return map;

  const fetcher = buildFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
  const entries = fetcher.listZipEntries(zip);
  const paths = parseTwArticlePathsFromZipEntries(entries);

  const BATCH = 50;
  for (let i = 0; i < paths.length; i += BATCH) {
    await Promise.all(
      paths.slice(i, i + BATCH).map(async ({ slug, cat }) => {
        const content = await fetcher.extractFileFromZip(zip, `${slug}.md`);
        const article = buildTwArticle(slug, cat, content);
        if (article.title) map.set(article.path, article.title);
      }),
    );
  }

  return map;
}

// ---------------------------------------------------------------------------
// Public: getArticleTitleMap
// ---------------------------------------------------------------------------

/**
 * Return (and cache) a slug→title map for all TA or TW articles in a language.
 *
 * The map key is the normalised slug (e.g. `"translate/figs-metaphor"`,
 * `"bible/kt/grace"`).
 */
export async function getArticleTitleMap(
  resourceType: "ta" | "tw",
  language: string,
  env: TocEnv,
): Promise<Map<string, string>> {
  const processKey = `${resourceType}:${language}`;
  const hit = PROCESS_CACHE.get(processKey);
  if (hit) return hit;

  const kvKey = `toc:${resourceType}:${language}`;
  const kv = env.TRANSLATION_HELPS_CACHE;

  // L2: KV-serialised map
  const kvRaw = await kvGet(kv, kvKey);
  if (kvRaw) {
    try {
      const obj = JSON.parse(kvRaw) as Record<string, string>;
      const map = new Map<string, string>(Object.entries(obj));
      PROCESS_CACHE.set(processKey, map);
      return map;
    } catch { /* re-build */ }
  }

  // L3/L4: build from article-list cache or full ZIP
  const map = resourceType === "ta"
    ? await buildTaMap(language, env)
    : await buildTwMap(language, env);

  // Persist the derived map under its own KV key so future requests skip the
  // article-list parse step too.
  if (map.size > 0) {
    await kvPut(kv, kvKey, JSON.stringify(Object.fromEntries(map)));
  }

  PROCESS_CACHE.set(processKey, map);
  return map;
}

// ---------------------------------------------------------------------------
// Public: resolveTitleFromToc
// ---------------------------------------------------------------------------

/**
 * Normalise an rc:// URI or bare slug, then probe the TOC map.
 *
 * Matching strategies (in order):
 *   1. Exact slug key (e.g. `"translate/figs-metaphor"` or `"bible/kt/grace"`)
 *   2. For TA: last slug segment (e.g. slug ends with `/figs-metaphor` matching `"figs-metaphor"`)
 *   3. For TW: `category/term` tail (last two segments, e.g. `"kt/grace"`)
 *
 * Returns null on miss so callers can fall back to `resolveTitleFromPath`.
 */
export function resolveTitleFromToc(
  map: Map<string, string>,
  pathOrRc: string,
  resourceType: "ta" | "tw",
): string | null {
  if (!pathOrRc || map.size === 0) return null;

  // Normalise rc:// links to a bare slug
  const slug = normaliseSlug(pathOrRc);
  if (!slug) return null;

  // 1. Exact match
  const exact = map.get(slug);
  if (exact) return exact;

  // 2. TA: match by last segment
  if (resourceType === "ta") {
    const last = slug.split("/").pop();
    if (last) {
      for (const [key, title] of map) {
        if (key.split("/").pop() === last) return title;
      }
    }
  }

  // 3. TW: match by category/term tail
  if (resourceType === "tw") {
    const parts = slug.split("/");
    if (parts.length >= 2) {
      const tail = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
      for (const [key, title] of map) {
        const kParts = key.split("/");
        if (kParts.length >= 2) {
          const kTail = `${kParts[kParts.length - 2]}/${kParts[kParts.length - 1]}`;
          if (kTail === tail) return title;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function normaliseSlug(pathOrRc: string): string {
  return pathOrRc
    .replace(/^rc:\/\/[^/]+\//, "")   // strip rc://*/  or rc://lang/
    .replace(/^ta\/man\//, "")         // strip ta/man/ segment
    .replace(/^tw\/dict\//, "")        // strip tw/dict/ segment
    .replace(/\.md$/, "")              // strip trailing .md
    .trim();
}
