/**
 * src/core/parsers/articleSearch.ts
 *
 * Term-frequency scoring for article search.
 * Extracted from searchArticles.ts so the REST API can own this logic.
 * No network I/O — pure, synchronous, testable.
 */

import type { ArticleSearchResult } from "../contracts/index.js";

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
    .map((c) => ({
      path: c.path,
      title: c.title,
      resourceType: c.resourceType,
      score: scoreArticle(query, c.path, c.title, c.category),
    }))
    .filter((r) => r.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
