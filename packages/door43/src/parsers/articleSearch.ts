/**
 * src/core/parsers/articleSearch.ts
 *
 * Term-frequency scoring for article search.
 * Extracted from searchArticles.ts so the REST API can own this logic.
 * No network I/O — pure, synchronous, testable.
 */

import type { ArticleSearchResult } from "../contracts/index.js";

/**
 * How closely a title or slug matches a query.
 * 4 exact title or comma-separated alternate name,
 * 3 title (or alternate name) starts with the query,
 * 2 title, alternate name, or slug contains it,
 * 0 none of those.
 */
export function articleMatchTier(
  query: string,
  path: string,
  title: string,
): 0 | 2 | 3 | 4 {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const titleNorm = title.trim().toLowerCase();
  const alts = title
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const names = [titleNorm, ...alts];
  if (names.some((name) => name === q)) return 4;
  if (names.some((name) => name.startsWith(q))) return 3;
  const slug = path.toLowerCase();
  if (names.some((name) => name.includes(q)) || slug.includes(q)) return 2;
  return 0;
}

const TIER_SCORE: Record<number, number> = {
  4: 1,
  3: 0.75,
  2: 0.5,
  1: 0.25,
};

/**
 * Score a query against a single article's searchable text fields.
 * Returns a number in [0, 1] where 1 = perfect term coverage.
 *
 * @param query    The user's search query
 * @param path     The article slug path (e.g. "translate/figs-metaphor")
 * @param title    The article human-readable title
 * @param category The article category (e.g. "translate", "kt")
 */
export function scoreArticle(
  query: string,
  path: string,
  title: string,
  category: string,
): number {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 2);

  if (terms.length === 0) return 0;

  const haystack = `${title} ${path} ${category}`.toLowerCase();
  const slugWords = path.split(/[-/]/).filter(Boolean);
  const slugHaystack = slugWords.join(" ").toLowerCase();

  let hits = 0;
  let exactBonus = 0;

  for (const term of terms) {
    if (haystack.includes(term)) {
      hits++;
      if (title.toLowerCase().includes(term) || slugHaystack.includes(term)) {
        exactBonus += 0.3;
      }
    }
  }

  const base = hits / terms.length;
  return Math.min(1, base + exactBonus / terms.length);
}

/**
 * Score and rank a list of article candidates against a query.
 *
 * @param candidates  List of articles with path/title/category/resourceType
 * @param query       Search query
 * @param topK        Maximum results to return
 * @param minScore    Minimum score threshold (default 0 = include all matches)
 */
export function rankArticles(
  candidates: Array<{
    path: string;
    title: string;
    category: string;
    resourceType: "ta" | "tw";
  }>,
  query: string,
  topK: number,
  minScore = 0,
): ArticleSearchResult[] {
  return candidates
    .map((c) => {
      const tier =
        articleMatchTier(query, c.path, c.title) ||
        (scoreArticle(query, c.path, c.title, c.category) > 0 ? 1 : 0);
      return {
        path: c.path,
        title: c.title,
        resourceType: c.resourceType,
        score: TIER_SCORE[tier] ?? 0,
      };
    })
    .filter((r) => r.score > minScore)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, topK);
}
