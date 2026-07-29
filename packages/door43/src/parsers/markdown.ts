/**
 * src/core/parsers/markdown.ts
 *
 * Helpers for extracting information from Markdown article files.
 * Used by Translation Academy and Translation Words fetchers.
 */

/**
 * Extract the title from the first heading (`# Title`) in a Markdown string.
 * Falls back to an empty string if no heading is found.
 */
export function extractTitleFromMarkdown(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const m = line.match(/^#+\s+(.+)/);
    if (m) return m[1].trim();
  }
  return "";
}

/**
 * Build a list of candidate file paths to try when fetching a
 * Translation Academy article from a zip.
 *
 * @param articlePath  The slug or path passed by the caller (e.g. "translate/figs-metaphor")
 */
export function buildTaPathCandidates(articlePath: string): string[] {
  const clean = articlePath.replace(/^\//, "").replace(/\.md$/, "");
  return [
    `${clean}/01.md`,
    `${clean}.md`,
    clean,
    `content/${clean}/01.md`,
    `content/${clean}.md`,
  ];
}

/**
 * Build a list of candidate file paths for a Translation Words article.
 *
 * @param wordPath  The slug (e.g. "bible/kt/grace")
 */
export function buildTwPathCandidates(wordPath: string): string[] {
  const clean = wordPath.replace(/^\//, "").replace(/\.md$/, "");
  return [`${clean}.md`, clean, `${clean.toLowerCase()}.md`];
}
