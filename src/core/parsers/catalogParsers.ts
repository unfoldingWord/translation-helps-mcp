/**
 * src/core/parsers/catalogParsers.ts
 *
 * Helpers that derive article metadata from zip entry lists and zip content,
 * for Translation Academy and Translation Words catalogs.
 * No network I/O — accepts pre-fetched strings and arrays.
 */

import type { AcademyArticle, WordArticle } from "../contracts/index.js";

const VALID_TW_CATEGORIES = new Set(["kt", "other", "names"]);

// ---------------------------------------------------------------------------
// Translation Academy
// ---------------------------------------------------------------------------

/**
 * Derive article slug paths from a list of zip entry names.
 * TA zip layout: <repo>/<category>/<slug>/01.md
 * Example: "en_ta-v10/translate/figs-metonymy/01.md" → "translate/figs-metonymy"
 */
export function parseTaArticlePathsFromZipEntries(entries: string[]): string[] {
  const articlePaths = new Set<string>();
  for (const entry of entries) {
    if (!entry.endsWith("/01.md")) continue;
    const parts = entry.split("/");
    if (parts.length < 3) continue;
    // strip leading repo dir and trailing "/01.md"
    const slug = parts.slice(1, -1).join("/");
    articlePaths.add(slug);
  }
  return Array.from(articlePaths);
}

/**
 * Build an {@link AcademyArticle} given the slug and optional title.md content.
 * Falls back to deriving a display name from the slug.
 */
export function buildTaArticle(slug: string, titleMd: string | null): AcademyArticle {
  const title = titleMd
    ? titleMd.trim().replace(/^#+\s*/, "")
    : slug.split("/").pop() ?? slug;
  const category = taCategoryFromPath(slug);
  return { path: slug, title, category };
}

/**
 * Return the top-level category from a TA slug (first path segment).
 * "translate/figs-metonymy" → "translate"
 */
export function taCategoryFromPath(slug: string): string {
  return slug.split("/")[0] ?? slug;
}

// ---------------------------------------------------------------------------
// Translation Words
// ---------------------------------------------------------------------------

/**
 * Derive `{ slug, cat }` pairs from zip entry names.
 * TW zip layout: <repo>/bible/<category>/<term>.md
 * Example: "en_tw/bible/kt/grace.md" → { slug: "bible/kt/grace", cat: "kt" }
 *
 * @param entries        All entry paths from the zip
 * @param categoryFilter Optional: keep only this category (kt/other/names)
 */
export function parseTwArticlePathsFromZipEntries(
  entries: string[],
  categoryFilter?: "kt" | "other" | "names",
): Array<{ slug: string; cat: string }> {
  const results: Array<{ slug: string; cat: string }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const parts = entry.split("/");
    const bibleIdx = parts.indexOf("bible");
    if (bibleIdx === -1 || bibleIdx + 2 >= parts.length) continue;
    const cat = parts[bibleIdx + 1];
    if (!cat || !VALID_TW_CATEGORIES.has(cat)) continue;
    if (categoryFilter && cat !== categoryFilter) continue;
    const term = parts[parts.length - 1].replace(/\.md$/, "");
    if (!term) continue;
    results.push({ slug: `bible/${cat}/${term}`, cat });
  }
  return results;
}

/**
 * Build a {@link WordArticle} given the slug, category, and article content.
 */
export function buildTwArticle(
  slug: string,
  cat: string,
  content: string | null,
): WordArticle {
  let title = "";
  if (content) {
    for (const line of content.split("\n")) {
      const m = line.match(/^#+\s+(.+)/);
      if (m) { title = m[1].trim(); break; }
    }
  }
  return {
    path: slug,
    title: title || (slug.split("/").pop() ?? slug),
    category: cat as "kt" | "other" | "names",
  };
}
