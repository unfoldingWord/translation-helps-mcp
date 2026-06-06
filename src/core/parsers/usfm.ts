/**
 * src/core/parsers/usfm.ts
 *
 * Pure USFM parsing helpers extracted from fetchScripture.ts.
 * No DOM, no network, no environment dependencies.
 */

// ---------------------------------------------------------------------------
// stripUsfm
// ---------------------------------------------------------------------------

/**
 * Remove USFM markup from a USFM string and return clean prose.
 *
 * Handles:
 * - Alignment markers (\zaln-s … \zaln-e)
 * - Word markers with pipes (\w word|... \w*)
 * - Milestones and backslash markers
 * - Alignment markup that leaves one token per line (joins with spaces)
 */
export function stripUsfm(usfm: string): string {
  return usfm
    // 1. Remove alignment milestone wrappers (\zaln-s ... \* and \zaln-e\*)
    .replace(/\\zaln-[se][^\\]*\\\*/g, "")
    // 2. \w word|attributes\w* → keep word
    .replace(/\\w\s+([^|\\]+)\|[^\\]*\\w\*/g, "$1")
    // 3. \w word\w* (no attributes) → keep word
    .replace(/\\w\s+([^\\]+)\\w\*/g, "$1")
    // 4. Remaining pipe-separated attributes
    .replace(/\|[^\s\n\\]*/g, "")
    // 5. All remaining backslash markers (e.g. \p, \v 1, \c 3, \q1)
    .replace(/\\[a-z]+\d*\*?\s*/g, "")
    // 6. Orphaned \*
    .replace(/\\\*/g, "")
    // 7. Collapse single newlines → space (alignment markup leaves one word per line)
    .replace(/\n(?!\n)/g, " ")
    // 8. Collapse multiple spaces / blank lines
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// extractVerses
// ---------------------------------------------------------------------------

/**
 * Extract the text of a chapter and optionally a verse range from a USFM string.
 *
 * @param usfm        Raw USFM text
 * @param chapter     Chapter number as string ("3")
 * @param verseStart  Optional first verse ("1")
 * @param verseEnd    Optional last verse (same as verseStart if omitted)
 * @param format      "text" (default) strips markup; "usfm" returns raw
 */
export function extractVerses(
  usfm: string,
  chapter: string,
  verseStart?: string,
  verseEnd?: string,
  format: "usfm" | "text" = "text",
): string {
  const chapterRe = new RegExp(`\\\\c\\s+${chapter}\\b`);
  const chapterIdx = usfm.search(chapterRe);
  if (chapterIdx < 0) return format === "usfm" ? usfm : stripUsfm(usfm);

  const nextChapterRe = /\\c\s+\d+/g;
  nextChapterRe.lastIndex = chapterIdx + 1;
  const nextChapter = nextChapterRe.exec(usfm);
  const chapterText = nextChapter
    ? usfm.slice(chapterIdx, nextChapter.index)
    : usfm.slice(chapterIdx);

  if (!verseStart) {
    return format === "usfm" ? chapterText : stripUsfm(chapterText);
  }

  const start = parseInt(verseStart, 10);
  const end = verseEnd ? parseInt(verseEnd, 10) : start;

  const lines = chapterText.split("\n");
  const out: string[] = [];
  let inRange = false;

  for (const line of lines) {
    const vMatch = line.match(/^\\v\s+(\d+)/);
    if (vMatch) {
      const vNum = parseInt(vMatch[1], 10);
      if (vNum >= start && vNum <= end) {
        inRange = true;
      } else if (vNum > end) {
        break;
      } else {
        inRange = false;
      }
    }
    if (inRange) out.push(line);
  }

  const extracted = out.join("\n").trim() || chapterText;
  return format === "usfm" ? extracted : stripUsfm(extracted);
}
