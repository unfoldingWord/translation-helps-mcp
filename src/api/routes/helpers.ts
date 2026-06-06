/**
 * src/api/routes/helpers.ts
 *
 * Common utilities for REST route handlers.
 */
import type { RouteContext, Env } from "../worker.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import {
  catalogSearch,
  getResourceZipUrl,
  resolveCatalogLanguage,
} from "../../core/resources/dcsClient.js";
import type { CatalogEntry, CatalogKVCache } from "../../core/resources/dcsClient.js";
import { parseReferenceForTool } from "../../core/resources/referenceParser.js";

export { ZipResourceFetcher2, catalogSearch, getResourceZipUrl, resolveCatalogLanguage, parseReferenceForTool };
export type { CatalogEntry, CatalogKVCache };

/**
 * Resolve the effective catalog language + its matching entries for a given subject.
 *
 * Thin wrapper over `resolveCatalogLanguage` that accepts a Cloudflare Env object
 * (which carries `TRANSLATION_HELPS_CACHE`) so every route handler can resolve
 * in one line without knowing about the KV binding.
 *
 * Returns `{ language, entries }` where `language` may be a variant of the
 * input (e.g. "es" → "es-419") when the exact code has no resources.
 */
export async function resolveLanguageVariant(
  language: string,
  subject: string,
  kv: CatalogKVCache | null | undefined,
): Promise<{ language: string; entries: CatalogEntry[] }> {
  return resolveCatalogLanguage(language, { subject, kv });
}

/**
 * Parse required `reference` and `language` query params and return a
 * pre-parsed reference. Throws with a 400-style message if either is missing
 * or the reference cannot be parsed.
 */
export function requireReferenceAndLanguage(url: URL): {
  reference: string;
  language: string;
  book: string;
  chapter: string;
  verseStart?: string;
  verseEnd?: string;
} {
  const reference = url.searchParams.get("reference");
  const language = url.searchParams.get("language");
  if (!reference) throw new Error("Missing required param: reference");
  if (!language) throw new Error("Missing required param: language");

  const parsed = parseReferenceForTool(reference);
  if (!parsed) throw new Error(`Invalid reference: "${reference}"`);

  return { reference, language, ...parsed };
}

/**
 * Build the canonical zip URL from a CatalogEntry.
 */
export function zipUrlFromEntry(entry: CatalogEntry): string {
  return (
    entry.catalog?.prod?.zipball_url ??
    `https://git.door43.org/${entry.owner}/${entry.repo}/archive/${entry.catalog?.prod?.branch_or_tag_name ?? "master"}.zip`
  );
}

/**
 * Find the first matching ingredient path for a book code, then fallback to
 * common file name patterns.
 */
export function buildBookPaths(
  entry: CatalogEntry,
  book: string,
  prefix = "",
  extension = ".tsv",
): string[] {
  const paths: string[] = [];
  // Ingredients first (most accurate)
  for (const ing of entry.ingredients) {
    if (
      ing.identifier?.toUpperCase() === book ||
      ing.path?.toUpperCase().includes(book)
    ) {
      paths.unshift(ing.path.replace(/^\.\//, ""));
    }
  }
  // Generic fallbacks
  paths.push(`${prefix}${book}${extension}`);
  paths.push(`${prefix}${book.toLowerCase()}${extension}`);
  return paths;
}

/**
 * Create a ZipResourceFetcher2 with env bindings.
 */
export function makeFetcher(env: Env): ZipResourceFetcher2 {
  return new ZipResourceFetcher2({
    KV: env.TRANSLATION_HELPS_CACHE,
    R2: env.ZIP_FILES,
  });
}

/**
 * Try each path candidate in order; return the first match.
 */
export async function tryPaths(
  fetcher: ZipResourceFetcher2,
  zip: Uint8Array,
  paths: string[],
): Promise<string | null> {
  for (const p of paths) {
    const content = await fetcher.extractFileFromZip(zip, p);
    if (content) return content;
  }
  return null;
}
