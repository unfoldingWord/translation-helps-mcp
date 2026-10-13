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
  return (
    usfm
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
      .trim()
  );
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
): string | null {
  const chapterRe = new RegExp(`\\\\c\\s+${chapter}\\b`);
  const chapterIdx = usfm.search(chapterRe);
  if (chapterIdx < 0) return null;

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

  // A verse runs from its marker to the next verse's. The marker need not
  // start its line: poetry is written "\q1 \v 4 …", and then the markers that
  // open the line belong to the verse. A bridge ("\v 13-14") is both verses.
  const markers = [...chapterText.matchAll(/\\v\s+(\d+)(?:-(\d+))?/g)];
  const startOf = markers.map((marker) => {
    const at = marker.index ?? 0;
    const lineStart = chapterText.lastIndexOf("\n", at) + 1;
    const lead = chapterText.slice(lineStart, at);
    return /^(?:\\[a-z]+\d*\s*)*$/.test(lead) ? lineStart : at;
  });

  const out: string[] = [];
  markers.forEach((marker, i) => {
    const first = parseInt(marker[1], 10);
    const last = marker[2] ? parseInt(marker[2], 10) : first;
    if (first > end || last < start) return;
    out.push(chapterText.slice(startOf[i], startOf[i + 1]).trimEnd());
  });

  const extracted = out.join("\n").trim();
  if (!extracted) return null;
  return format === "usfm" ? extracted : stripUsfm(extracted);
}

// ---------------------------------------------------------------------------
// usfmExtent
// ---------------------------------------------------------------------------

/**
 * How far a book goes: its last chapter and, when `chapter` exists in it, the
 * last verse of that chapter. Lets a caller say why `extractVerses` found
 * nothing ("John has 21 chapters") instead of only that it found nothing.
 *
 * @param usfm     Raw USFM text of one book
 * @param chapter  Chapter number as string ("3")
 */
export function usfmExtent(
  usfm: string,
  chapter: string,
): { chapters: number; lastVerse: number | null } {
  const numbers = (text: string, re: RegExp): number[] =>
    [...text.matchAll(re)].map((m) => parseInt(m[1], 10));

  const chapters = Math.max(0, ...numbers(usfm, /\\c\s+(\d+)/g));

  const chapterIdx = usfm.search(new RegExp(`\\\\c\\s+${chapter}\\b`));
  if (chapterIdx < 0) return { chapters, lastVerse: null };
  const rest = usfm.slice(chapterIdx + 1);
  const nextIdx = rest.search(/\\c\s+\d+/);
  const chapterText = nextIdx < 0 ? rest : rest.slice(0, nextIdx);

  // A verse bridge ("\v 3-4") ends at its second number.
  const verses = numbers(chapterText, /\\v\s+(?:\d+-)?(\d+)/g);
  return { chapters, lastVerse: verses.length ? Math.max(...verses) : null };
}
