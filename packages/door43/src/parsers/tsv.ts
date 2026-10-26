/**
 * src/core/parsers/tsv.ts
 *
 * Pure TSV parse functions for Translation Notes, Translation Word Links, and
 * Translation Questions. Extracted from the MCP tool files so the REST data
 * layer can import them without depending on anything in src/mcp/.
 *
 * Both TN and TWL support two layouts:
 *   Old (8-col): Book  Chapter  Verse  ID  SupportReference  Quote  Occurrence  Note/TWLink
 *   New (7/6-col): Reference  ID  Tags  SupportReference/OrigWords  Occurrence  Note/TWLink
 * Detected by checking whether the header starts with "reference".
 */

import type {
  TranslationNoteRow,
  TranslationWordLinkRow,
  TranslationQuestionRow,
} from "../contracts/index.js";

/**
 * TN/TQ TSV cells encode newlines as the two-character sequence `\n` (and
 * sometimes `<br>`). Convert those to real line breaks so markdown renderers
 * can parse headings and lists.
 */
function unescapeTsvText(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/<br\s*\/?>/gi, "\n");
}

// ---------------------------------------------------------------------------
// Translation Notes
// ---------------------------------------------------------------------------

/**
 * Parse a full TN TSV string, returning rows matching chapter (and optionally
 * verse or an inclusive verse range). Accepts both old (Book/Ch/Vs) and
 * new (Reference) layouts.
 *
 * Context notes are ALWAYS included alongside verse-level notes:
 *   - front:intro  → book-level introduction (chapter = "front", verse = "intro")
 *   - {chapter}:intro → chapter introduction for every chapter in the query
 * These are returned regardless of any verse filter so that callers can access
 * introductory context for every passage query.
 *
 * `verseEnd` is the last verse when the query stays in `chapter`. `endChapter`
 * is set for a cross-chapter reference ("23:50-24:12"): verses run from
 * `verse` to the end of `chapter`, through any chapter in between, and from
 * verse 1 through `verseEnd` of `endChapter`.
 */
export function parseTranslationNotesTsv(
  tsv: string,
  chapter: string,
  verse?: string,
  verseEnd?: string,
  endChapter?: string,
): TranslationNoteRow[] {
  const lines = tsv.split("\n");
  const results: TranslationNoteRow[] = [];

  const header = lines[0]?.toLowerCase() ?? "";
  const isNewFormat = header.startsWith("reference");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split("\t");

    if (isNewFormat) {
      // New format: Reference  ID  Tags  SupportReference  Quote  Occurrence  Note
      if (cols.length < 7) continue;
      const [ref, id, , supRef, quote, occurrence, ...noteParts] = cols;
      // ref examples: "3:16", "front:intro", "3:intro"
      const colonIdx = (ref ?? "").indexOf(":");
      if (colonIdx === -1) continue;
      const ch = ref.slice(0, colonIdx);
      const vs = ref.slice(colonIdx + 1);

      if (!noteIntroInQuery(ch, vs, chapter, endChapter)) {
        if (!rowInQuery(ch, vs, chapter, verse, verseEnd, endChapter)) continue;
      }

      results.push({
        book: "",
        chapter: ch,
        verse: vs,
        id: id ?? "",
        supportReference: supRef ?? "",
        quote: quote ?? "",
        occurrence: occurrence ?? "",
        note: unescapeTsvText(noteParts.join("\t").trim()),
      });
    } else {
      // Old format: Book  Chapter  Verse  ID  SupportReference  Quote  Occurrence  Note
      if (cols.length < 8) continue;
      const [book, ch, vs, id, supRef, quote, occurrence, ...noteParts] = cols;

      if (!noteIntroInQuery(ch ?? "", vs ?? "", chapter, endChapter)) {
        if (
          !rowInQuery(ch ?? "", vs ?? "", chapter, verse, verseEnd, endChapter)
        )
          continue;
      }

      results.push({
        book: book ?? "",
        chapter: ch,
        verse: vs,
        id: id ?? "",
        supportReference: supRef ?? "",
        quote: quote ?? "",
        occurrence: occurrence ?? "",
        note: unescapeTsvText(noteParts.join("\t").trim()),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Translation Word Links
// ---------------------------------------------------------------------------

/**
 * Parse a full TWL TSV string, returning rows in the chapter and optional
 * verse range. `verseEnd` and `endChapter` mean the same as in
 * parseTranslationNotesTsv. Accepts both old and new layouts.
 */
export function parseTranslationWordLinksTsv(
  tsv: string,
  chapter: string,
  verse?: string,
  verseEnd?: string,
  endChapter?: string,
): TranslationWordLinkRow[] {
  const lines = tsv.split("\n");
  const header = lines[0]?.toLowerCase() ?? "";
  // New format: Reference  ID  Tags  OrigWords  Occurrence  TWLink
  // Old format: Book  Chapter  Verse  ID  SupportReference  OrigWords  Occurrence  TWLink
  const isNewFormat = header.startsWith("reference");

  const results: TranslationWordLinkRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split("\t");

    let book = "",
      ch = "",
      vs = "",
      twId = "",
      supportReference = "",
      origWords = "",
      occurrence = "",
      twLink = "";

    if (isNewFormat) {
      // Reference  ID  Tags  OrigWords  Occurrence  TWLink
      if (cols.length < 6) continue;
      const refParts = (cols[0] ?? "").split(":");
      if (refParts.length < 2) continue;
      ch = refParts[0];
      vs = refParts[1];
      twId = cols[1] ?? "";
      // cols[2] = Tags (skip)
      origWords = (cols[3] ?? "").trim();
      occurrence = cols[4] ?? "";
      twLink = (cols[5] ?? "").trim();
    } else {
      // Book  Chapter  Verse  ID  SupportReference  OrigWords  Occurrence  TWLink
      if (cols.length < 8) continue;
      [book, ch, vs, twId, supportReference, origWords, occurrence, twLink] =
        cols;
      origWords = origWords?.trim() ?? "";
      twLink = twLink?.trim() ?? "";
    }

    if (!rowInQuery(ch, vs, chapter, verse, verseEnd, endChapter)) continue;

    // Derive the clean article path from the rc:// URI
    const wordPath = twLink
      .replace(/^rc:\/\/\*\/tw\/dict\//, "")
      .replace(/^rc:\/\/[^/]+\/tw\/dict\//, "");

    results.push({
      book,
      chapter: ch,
      verse: vs,
      twId,
      supportReference: supportReference?.trim() ?? "",
      origWords,
      occurrence,
      twLink,
      wordPath,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Verse ranges
// ---------------------------------------------------------------------------

/**
 * True when a note's intro cell belongs with this query: the book intro
 * always, and the chapter intro of every chapter the query covers.
 */
function noteIntroInQuery(
  rowChapter: string,
  rowVerse: string,
  chapter: string,
  endChapter?: string,
): boolean {
  if (rowVerse !== "intro") return false;
  if (rowChapter === "front") return true;
  return chapterInQuery(rowChapter, chapter, endChapter);
}

function chapterInQuery(
  rowChapter: string,
  chapter: string,
  endChapter?: string,
): boolean {
  const cross = Boolean(endChapter) && endChapter !== chapter;
  if (!cross) return rowChapter === chapter;
  const rowCh = Number.parseInt(rowChapter, 10);
  const startCh = Number.parseInt(chapter, 10);
  const endCh = Number.parseInt(endChapter!, 10);
  if (Number.isNaN(rowCh) || Number.isNaN(startCh) || Number.isNaN(endCh)) {
    return false;
  }
  return rowCh >= startCh && rowCh <= endCh;
}

/**
 * Whether a verse cell belongs to the query. Same-chapter ranges reuse
 * verseOverlapsQueryRange, so a bridge is kept when it overlaps. A
 * cross-chapter query keeps the start chapter from its first verse on,
 * the end chapter through verseEnd, and every verse in between.
 */
function rowInQuery(
  rowChapter: string,
  rowVerse: string,
  chapter: string,
  verseStart?: string,
  verseEnd?: string,
  endChapter?: string,
): boolean {
  if (!chapterInQuery(rowChapter, chapter, endChapter)) return false;
  const cross = Boolean(endChapter) && endChapter !== chapter;
  if (!cross) {
    if (!verseStart) return true;
    return verseOverlapsQueryRange(rowVerse, verseStart, verseEnd);
  }
  if (!verseStart && !verseEnd) return true;
  const rowCh = Number.parseInt(rowChapter, 10);
  const startCh = Number.parseInt(chapter, 10);
  const endCh = Number.parseInt(endChapter!, 10);
  // Past any chapter's last verse, so the open side of the range still overlaps.
  const throughChapter = "999";
  if (rowCh === startCh) {
    return verseOverlapsQueryRange(rowVerse, verseStart ?? "1", throughChapter);
  }
  if (rowCh === endCh) {
    return verseOverlapsQueryRange(rowVerse, "1", verseEnd ?? throughChapter);
  }
  return verseOverlapsQueryRange(rowVerse, "1", throughChapter);
}

/**
 * True when a TSV verse cell overlaps an inclusive query range.
 *
 * TSV cells may be a single verse (`"2"`), a bridge (`"1-3"`), or non-numeric
 * (`"intro"`). Non-numeric cells never match a verse filter. Bridges match when
 * they overlap the query range (not only when equal).
 */

export function verseOverlapsQueryRange(
  tsvVerse: string,
  verseStart: string,
  verseEnd?: string,
): boolean {
  const rowMatch = tsvVerse.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?/);
  if (!rowMatch) return false;

  const rowStart = Number.parseInt(rowMatch[1]!, 10);
  const rowEnd = rowMatch[2] ? Number.parseInt(rowMatch[2], 10) : rowStart;
  const qStart = Number.parseInt(verseStart, 10);
  if (Number.isNaN(rowStart) || Number.isNaN(qStart)) return false;
  const qEnd = verseEnd ? Number.parseInt(verseEnd, 10) : qStart;
  if (Number.isNaN(qEnd)) return false;

  return rowStart <= qEnd && rowEnd >= qStart;
}

/**
 * Parse a TQ TSV string. Accepts both the new format (Reference, ID, Tags, Quote, Occurrence, Question, Response)
 * and the old format (Book, Chapter, Verse, ID, Question, Response).
 *
 * When `verse` is set, returns questions whose verse (or verse bridge) overlaps
 * the inclusive range `[verse, verseEnd ?? verse]`. Chapter-only queries
 * (no `verse`) return every question in that chapter.
 */
export function parseTranslationQuestionsTsv(
  tsv: string,
  chapter: string,
  verse?: string,
  verseEnd?: string,
): TranslationQuestionRow[] {
  const lines = tsv.split("\n");
  const results: TranslationQuestionRow[] = [];

  const header = lines[0]?.toLowerCase() ?? "";
  const isNewFormat = header.startsWith("reference");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split("\t");

    if (isNewFormat) {
      // New format: Reference  ID  Tags  Quote  Occurrence  Question  Response
      if (cols.length < 6) continue;
      const [ref, id, , , , question, ...responseParts] = cols;
      // ref examples: "3:16", "1:1-3", "1:intro", "front:intro"
      const colonIdx = ref.indexOf(":");
      if (colonIdx === -1) continue;
      const ch = ref.slice(0, colonIdx);
      const vs = ref.slice(colonIdx + 1);
      if (ch !== chapter) continue;
      if (verse && !verseOverlapsQueryRange(vs, verse, verseEnd)) continue;
      results.push({
        book: "",
        chapter: ch,
        verse: vs,
        id: id ?? "",
        question: unescapeTsvText(question?.trim() ?? ""),
        response: unescapeTsvText(responseParts.join("\t").trim()),
      });
    } else {
      // Old format: Book  Chapter  Verse  ID  Question  Response
      if (cols.length < 5) continue;
      const [book, ch, vs, id, question, ...responseParts] = cols;
      if (ch !== chapter) continue;
      if (verse && !verseOverlapsQueryRange(vs ?? "", verse, verseEnd))
        continue;
      results.push({
        book: book ?? "",
        chapter: ch,
        verse: vs,
        id: id ?? "",
        question: unescapeTsvText(question?.trim() ?? ""),
        response: unescapeTsvText(responseParts.join("\t").trim()),
      });
    }
  }

  return results;
}
