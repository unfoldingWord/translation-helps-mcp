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

// ---------------------------------------------------------------------------
// Translation Notes
// ---------------------------------------------------------------------------

/**
 * Parse a full TN TSV string, returning rows matching chapter (and optionally
 * verse). Accepts both old (Book/Ch/Vs) and new (Reference) layouts.
 *
 * Context notes are ALWAYS included alongside verse-level notes:
 *   - front:intro  → book-level introduction (chapter = "front", verse = "intro")
 *   - {chapter}:intro → chapter-level introduction (verse = "intro")
 * These are returned regardless of any `verse` filter so that callers can access
 * introductory context for every passage query.
 */
export function parseTranslationNotesTsv(
  tsv: string,
  chapter: string,
  verse?: string,
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

      // Always include book-intro and chapter-intro, regardless of verse filter
      const isBookIntro = ch === "front" && vs === "intro";
      const isChapterIntro = ch === chapter && vs === "intro";
      if (!isBookIntro && !isChapterIntro) {
        if (ch !== chapter) continue;
        if (verse && vs !== verse) continue;
      }

      results.push({
        book: "",
        chapter: ch,
        verse: vs,
        id: id ?? "",
        supportReference: supRef ?? "",
        quote: quote ?? "",
        occurrence: occurrence ?? "",
        note: noteParts.join("\t").trim(),
      });
    } else {
      // Old format: Book  Chapter  Verse  ID  SupportReference  Quote  Occurrence  Note
      if (cols.length < 8) continue;
      const [book, ch, vs, id, supRef, quote, occurrence, ...noteParts] = cols;

      const isBookIntro = ch === "front" && vs === "intro";
      const isChapterIntro = ch === chapter && vs === "intro";
      if (!isBookIntro && !isChapterIntro) {
        if (ch !== chapter) continue;
        if (verse && vs !== verse) continue;
      }

      results.push({
        book: book ?? "",
        chapter: ch,
        verse: vs,
        id: id ?? "",
        supportReference: supRef ?? "",
        quote: quote ?? "",
        occurrence: occurrence ?? "",
        note: noteParts.join("\t").trim(),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Translation Word Links
// ---------------------------------------------------------------------------

/**
 * Parse a full TWL TSV string, returning only rows matching chapter (and
 * optionally verse). Accepts both old and new layouts.
 */
export function parseTranslationWordLinksTsv(
  tsv: string,
  chapter: string,
  verse?: string,
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
      [book, ch, vs, twId, supportReference, origWords, occurrence, twLink] = cols;
      origWords = origWords?.trim() ?? "";
      twLink = twLink?.trim() ?? "";
    }

    if (ch !== chapter) continue;
    if (verse && vs !== verse) continue;

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
// Translation Questions
// ---------------------------------------------------------------------------

/**
 * Parse a TQ TSV string. Accepts both the new format (Reference, ID, Tags, Quote, Occurrence, Question, Response)
 * and the old format (Book, Chapter, Verse, ID, Question, Response).
 */
export function parseTranslationQuestionsTsv(
  tsv: string,
  chapter: string,
  verse?: string,
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
      // ref examples: "3:16", "1:intro", "front:intro"
      const colonIdx = ref.indexOf(":");
      if (colonIdx === -1) continue;
      const ch = ref.slice(0, colonIdx);
      const vs = ref.slice(colonIdx + 1);
      if (ch !== chapter) continue;
      if (verse && vs !== verse) continue;
      results.push({
        book: "",
        chapter: ch,
        verse: vs,
        id: id ?? "",
        question: question?.trim() ?? "",
        response: responseParts.join("\t").trim(),
      });
    } else {
      // Old format: Book  Chapter  Verse  ID  Question  Response
      if (cols.length < 5) continue;
      const [book, ch, vs, id, question, ...responseParts] = cols;
      if (ch !== chapter) continue;
      if (verse && vs !== verse) continue;
      results.push({
        book: book ?? "",
        chapter: ch,
        verse: vs,
        id: id ?? "",
        question: question?.trim() ?? "",
        response: responseParts.join("\t").trim(),
      });
    }
  }

  return results;
}
