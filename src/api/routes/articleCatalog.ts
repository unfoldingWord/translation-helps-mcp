/**
 * TW/TA catalogs cached once per zip: in-process, then the same KV keys
 * the list and search routes already use, then a build from the zip.
 */

import type { RouteContext } from "../worker.js";
import {
  makeFetcher,
  resolveResourceZip,
  sourceFromCatalog,
  type ResourceSource,
} from "./helpers.js";
import {
  parseTaArticlePathsFromZipEntries,
  parseTwArticlePathsFromZipEntries,
  buildTaArticle,
  buildTwArticle,
} from "@translation-helps/door43";
import type { AcademyArticle, WordArticle } from "@translation-helps/door43";
import { noteLayer } from "../serverTiming.js";

type Env = RouteContext["env"];

export interface ArticleCatalog<T> {
  language: string;
  zipUrl: string;
  articles: T[];
  source: ResourceSource;
}

const memoryTw = new Map<string, ArticleCatalog<WordArticle>>();
const memoryTa = new Map<string, ArticleCatalog<AcademyArticle>>();

/** Drop the in-process catalog so tests can swap zip fixtures. */
export function clearArticleCatalogCacheForTests(): void {
  memoryTw.clear();
  memoryTa.clear();
}

async function readKv(env: Env, key: string): Promise<string | null> {
  if (!env.TRANSLATION_HELPS_CACHE) return null;
  return env.TRANSLATION_HELPS_CACHE.get(key).catch(() => null);
}

function writeKv(env: Env, key: string, value: string): void {
  env.TRANSLATION_HELPS_CACHE?.put(key, value, { expirationTtl: 86400 }).catch(
    () => {},
  );
}

export async function loadTwCatalog(
  requestedLanguage: string,
  env: Env,
  execCtx?: ExecutionContext,
): Promise<ArticleCatalog<WordArticle> | null> {
  const resolved = await resolveResourceZip(
    requestedLanguage,
    "Translation Words",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) return null;
  const { language, zipUrl, entry } = resolved;
  const source = sourceFromCatalog(entry, language);
  const memKey = `tw:${zipUrl}`;
  const cachedMemory = memoryTw.get(memKey);
  if (cachedMemory) {
    noteLayer("memory");
    return cachedMemory;
  }

  const kvKey = `catalog:tw:${language}`;
  const kv = await readKv(env, kvKey);
  if (kv) {
    noteLayer("kv");
    const value = {
      language,
      zipUrl,
      articles: JSON.parse(kv) as WordArticle[],
      source,
    };
    memoryTw.set(memKey, value);
    return value;
  }

  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(zipUrl);
  const paths = parseTwArticlePathsFromZipEntries(fetcher.listZipEntries(zip));
  const articles: WordArticle[] = [];
  for (let i = 0; i < paths.length; i += 50) {
    const batch = paths.slice(i, i + 50);
    const results = await Promise.all(
      batch.map(async ({ slug, cat }) => {
        const content = await fetcher.extractFileFromZip(zip, `${slug}.md`);
        return buildTwArticle(slug, cat, content);
      }),
    );
    articles.push(...results);
  }
  articles.sort((a, b) => a.path.localeCompare(b.path));
  writeKv(env, kvKey, JSON.stringify(articles));
  const value = { language, zipUrl, articles, source };
  memoryTw.set(memKey, value);
  return value;
}

export async function loadTaCatalog(
  requestedLanguage: string,
  env: Env,
  execCtx?: ExecutionContext,
): Promise<ArticleCatalog<AcademyArticle> | null> {
  const resolved = await resolveResourceZip(
    requestedLanguage,
    "Translation Academy",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) return null;
  const { language, zipUrl, entry } = resolved;
  const source = sourceFromCatalog(entry, language);
  const memKey = `ta:${zipUrl}`;
  const cachedMemory = memoryTa.get(memKey);
  if (cachedMemory) {
    noteLayer("memory");
    return cachedMemory;
  }

  const kvKey = `catalog:ta:${language}`;
  const kv = await readKv(env, kvKey);
  if (kv) {
    noteLayer("kv");
    const value = {
      language,
      zipUrl,
      articles: JSON.parse(kv) as AcademyArticle[],
      source,
    };
    memoryTa.set(memKey, value);
    return value;
  }

  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(zipUrl);
  const slugs = parseTaArticlePathsFromZipEntries(fetcher.listZipEntries(zip));
  const articles = await Promise.all(
    slugs.map(async (slug) => {
      const titleMd = await fetcher.extractFileFromZip(zip, `${slug}/title.md`);
      return buildTaArticle(slug, titleMd);
    }),
  );
  articles.sort((a, b) => a.path.localeCompare(b.path));
  writeKv(env, kvKey, JSON.stringify(articles));
  const value = { language, zipUrl, articles, source };
  memoryTa.set(memKey, value);
  return value;
}
