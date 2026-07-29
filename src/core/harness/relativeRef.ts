/**
 * Relative chapter/verse resolution against an active study reference.
 *
 * Used when the user says "chapter 1" or "verse 1" without naming the book —
 * we compose a full USFM ref like "RUT 1" / "RUT 1:1" from study context.
 */

import { extractReferenceInfo, VALID_USFM_BOOKS } from "./intent.js";

export type RelativeRefSignals = {
  extractedBook: string | null;
  extractedChapter: number | null;
  extractedVerse: number | null;
  extractedVerseEnd: number | null;
};

export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0)
    return value;
  if (typeof value === "string" && value !== "null") {
    const n = Number.parseInt(value, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/** Parse a study-session reference like "RUT", "RUT 1", or "RUT 1:1" into parts. */
export function parseStudyRefParts(ref: string | null | undefined): {
  book: string | null;
  chapter: number | null;
} {
  if (!ref?.trim()) return { book: null, chapter: null };
  const m = /^([A-Z0-9]{2,3})(?:\s+(\d+))?/i.exec(ref.trim());
  if (!m) return { book: null, chapter: null };
  const book = m[1].toUpperCase();
  if (!VALID_USFM_BOOKS.has(book)) return { book: null, chapter: null };
  const chapter = m[2] ? Number.parseInt(m[2], 10) : null;
  return { book, chapter: chapter && chapter > 0 ? chapter : null };
}

/**
 * Compose a full USFM reference from relative chapter/verse signals plus the
 * active study context (or a newly resolved book code). Returns null when there
 * is not enough context to compose safely.
 *
 * @param resolveBook - maps free-text book names (e.g. "Ruth") to USFM codes
 */
export function composeRelativeReference(
  ctx: RelativeRefSignals,
  studyRef: string | null,
  resolveBook: (name: string) => string | null,
): {
  reference: string;
  intent: "passage_overview" | "annotated_passage";
} | null {
  const study = parseStudyRefParts(studyRef);
  const bookFromCtx = ctx.extractedBook ? resolveBook(ctx.extractedBook) : null;
  const book = study.book ?? bookFromCtx;
  if (!book) return null;

  if (ctx.extractedChapter != null && ctx.extractedVerse == null) {
    return {
      reference: `${book} ${ctx.extractedChapter}`,
      intent: "passage_overview",
    };
  }

  if (ctx.extractedVerse != null) {
    const chapter = ctx.extractedChapter ?? study.chapter ?? 1;
    const end =
      ctx.extractedVerseEnd != null &&
      ctx.extractedVerseEnd > ctx.extractedVerse
        ? ctx.extractedVerseEnd
        : null;
    const versePart = end
      ? `${ctx.extractedVerse}-${end}`
      : String(ctx.extractedVerse);
    return {
      reference: `${book} ${chapter}:${versePart}`,
      intent: "annotated_passage",
    };
  }

  return null;
}

const ORDINAL_MAP: Record<string, number> = {
  first: 1,
  "1st": 1,
  primer: 1,
  primera: 1,
  primero: 1,
  second: 2,
  "2nd": 2,
  segundo: 2,
  segunda: 2,
  third: 3,
  "3rd": 3,
  tercer: 3,
  tercera: 3,
  tercero: 3,
  fourth: 4,
  "4th": 4,
  cuarto: 4,
  cuarta: 4,
  fifth: 5,
  "5th": 5,
  quinto: 5,
  quinta: 5,
};

const ORDINAL_RE =
  /\b(first|second|third|fourth|fifth|primer[ao]?|segund[ao]|tercer[ao]?|cuart[ao]|quint[ao]|1st|2nd|3rd|4th|5th)\b/i;

function ordinalToNumber(word: string): number | null {
  return ORDINAL_MAP[word.toLowerCase()] ?? null;
}

/** True when text contains a bare C:V / C:V-V ref without a resolvable book name. */
function hasBareChapterVerse(text: string): boolean {
  if (!/\b\d{1,3}:\d{1,3}(?:\s*[-–—]\s*\d{1,3})?\b/.test(text)) return false;
  // Reject "Titus 1:1" / "Juan 3:16" — those are full book references.
  if (extractReferenceInfo(text)) return false;
  return true;
}

/**
 * Client-side routing helper: true when the message names a relative chapter/verse
 * without a full book reference. Does not resolve the number — server does that.
 */
export function mentionsRelativeRef(text: string): boolean {
  if (hasBareChapterVerse(text)) return true;
  const hasUnit =
    /\b(vers[ií]culos?|versos?|verses?|cap[ií]tulos?|chapters?)\b/i.test(
      text,
    ) || /\b(ch|cap)\.?\s*\d+/i.test(text);
  if (!hasUnit) return false;
  const hasNumber = /\d+/.test(text);
  const hasOrdinal = ORDINAL_RE.test(text);
  return hasNumber || hasOrdinal;
}

/** True when the user names a section/part by number or ordinal. */
export function mentionsSectionSelection(text: string): boolean {
  if (!/\b(secci[oó]n(?:es)?|sections?|partes?|parts?)\b/i.test(text)) {
    return false;
  }
  return /\d+/.test(text) || ORDINAL_RE.test(text);
}

function extractSectionIndex(message: string): number | null {
  const num = message.match(
    /\b(?:secci[oó]n(?:es)?|sections?|partes?|parts?)\s+(\d{1,2})\b/i,
  );
  if (num) return Number.parseInt(num[1], 10);

  const ordBefore = message.match(
    new RegExp(
      `${ORDINAL_RE.source}\\s+(?:secci[oó]n(?:es)?|sections?|partes?|parts?)\\b`,
      "i",
    ),
  );
  if (ordBefore?.[1]) return ordinalToNumber(ordBefore[1]);

  const ordAfter = message.match(
    new RegExp(
      `\\b(?:secci[oó]n(?:es)?|sections?|partes?|parts?)\\s+${ORDINAL_RE.source}`,
      "i",
    ),
  );
  if (ordAfter?.[1]) return ordinalToNumber(ordAfter[1]);

  return null;
}

/**
 * Scan an assistant overview for ordered verse-range section headings
 * (e.g. "**Versículos 1-4: Saludo**", "vv. 5–9").
 */
export function extractSectionVerseRanges(assistant: string): Array<{
  extractedChapter: number | null;
  extractedVerse: number;
  extractedVerseEnd: number;
}> {
  if (!assistant?.trim()) return [];

  const results: Array<{
    extractedChapter: number | null;
    extractedVerse: number;
    extractedVerseEnd: number;
  }> = [];
  const seen = new Set<string>();

  // Matches common overview labels:
  //   "versículos 1-4", "vv. 5–9", "v.1–4", "**v.1-4:**"
  const labeled =
    /(?:vers[ií]culos?|versos?|verses?|vv?\.?)\s*(\d{1,3})\s*[–—-]\s*(\d{1,3})/gi;
  let m: RegExpExecArray | null;
  while ((m = labeled.exec(assistant)) !== null) {
    const start = Number.parseInt(m[1], 10);
    const end = Number.parseInt(m[2], 10);
    if (!(start > 0 && end >= start)) continue;
    const key = `v:${start}-${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      extractedChapter: null,
      extractedVerse: start,
      extractedVerseEnd: end,
    });
  }
  if (results.length > 0) return results;

  // Fallback: bare C:V-V headings like "**1:1-4**"
  const cv =
    /(?:^|\n)\s*(?:[-*•]|\d+\.)?\s*\*{0,2}(\d{1,3})\s*:\s*(\d{1,3})\s*[–—-]\s*(\d{1,3})/gi;
  while ((m = cv.exec(assistant)) !== null) {
    const chapter = Number.parseInt(m[1], 10);
    const start = Number.parseInt(m[2], 10);
    const end = Number.parseInt(m[3], 10);
    if (!(chapter > 0 && start > 0 && end >= start)) continue;
    const key = `c:${chapter}:${start}-${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      extractedChapter: chapter,
      extractedVerse: start,
      extractedVerseEnd: end,
    });
  }

  return results;
}

/**
 * Resolve "quiero traducir la sección 1" against the last assistant overview's
 * numbered verse-range sections. Returns null when no match.
 */
export function resolveSectionSelection(
  message: string,
  lastAssistantContent: string,
): {
  extractedChapter: number | null;
  extractedVerse: number | null;
  extractedVerseEnd: number | null;
} | null {
  const index = extractSectionIndex(message);
  if (index == null || index < 1) return null;

  const sections = extractSectionVerseRanges(lastAssistantContent);
  const section = sections[index - 1];
  if (!section) return null;

  return {
    extractedChapter: section.extractedChapter,
    extractedVerse: section.extractedVerse,
    extractedVerseEnd: section.extractedVerseEnd,
  };
}

/**
 * Extract the chapter an assistant turn OFFERED to start with (e.g. the book
 * orientation closer "¿te gustaría comenzar con el capítulo 1?"). Used when
 * the user replies with a bare affirmative that carries no reference of its
 * own — composing "BOOK N" lets the readiness gate and passage pipeline see
 * the chapter advancement instead of routing to open conversation.
 *
 * Prefers the LAST chapter mention (assistant closers end with the question).
 * Returns null when the assistant text mentions no chapter.
 */
export function extractChapterOfferFromAssistant(
  assistantText: string | null | undefined,
): number | null {
  if (!assistantText?.trim()) return null;
  const visible = assistantText.replace(/<!--[\s\S]*?-->/g, "");

  let last: number | null = null;
  const numRe =
    /\b(?:cap[ií]tulos?|chapters?|chapitres?|cap|ch)\.?\s+(\d{1,3})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(visible)) !== null) {
    const n = Number.parseInt(m[1], 10);
    if (n > 0) last = n;
  }
  if (last != null) return last;

  // Ordinal offer: "el primer capítulo", "the first chapter"
  const ordRe = new RegExp(
    `${ORDINAL_RE.source}\\s+(?:cap[ií]tulos?|chapters?)\\b|\\b(?:cap[ií]tulos?|chapters?)\\s+${ORDINAL_RE.source}`,
    "gi",
  );
  while ((m = ordRe.exec(visible)) !== null) {
    const word = m[1] ?? m[2];
    const n = word ? ordinalToNumber(word) : null;
    if (n != null) last = n;
  }
  return last;
}

/**
 * Deterministic fallback when the LLM classifier misses a relative chapter/verse.
 * Parses phrases like "continue to chapter 1", "capítulo 2", "primer capítulo",
 * "verse 3", "versículos 1-5", and bare "1:1-4". Returns null when nothing usable
 * is found.
 *
 * Does not resolve a book — callers compose against study context.
 */
export function extractRelativeRefFallback(text: string): {
  extractedChapter: number | null;
  extractedVerse: number | null;
  extractedVerseEnd: number | null;
} | null {
  if (!text?.trim() || !mentionsRelativeRef(text)) return null;

  let extractedChapter: number | null = null;
  let extractedVerse: number | null = null;
  let extractedVerseEnd: number | null = null;

  // Bare C:V or C:V-V (no book name): "1:1-4", "traduzcamos 1:1-4"
  if (hasBareChapterVerse(text)) {
    const bare = text.match(/\b(\d{1,3}):(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\b/);
    if (bare) {
      extractedChapter = Number.parseInt(bare[1], 10);
      extractedVerse = Number.parseInt(bare[2], 10);
      if (bare[3]) extractedVerseEnd = Number.parseInt(bare[3], 10);
      return { extractedChapter, extractedVerse, extractedVerseEnd };
    }
  }

  // Verse range: "verses 1-5", "versículos 2 al 4", "verso 1-3"
  const verseRange = text.match(
    /\b(?:vers[ií]culos?|versos?|verses?)\s+(\d+)\s*(?:-|–|—|a|al|to|thru|through)\s*(\d+)\b/i,
  );
  if (verseRange) {
    extractedVerse = Number.parseInt(verseRange[1], 10);
    extractedVerseEnd = Number.parseInt(verseRange[2], 10);
  } else {
    // Single verse: "verse 1", "el versículo 3"
    const verseNum = text.match(
      /\b(?:vers[ií]culos?|versos?|verses?)\s+(\d+)\b/i,
    );
    if (verseNum) {
      extractedVerse = Number.parseInt(verseNum[1], 10);
    } else {
      // Ordinal verse: "first verse", "primer versículo"
      const verseOrd = text.match(
        new RegExp(
          `${ORDINAL_RE.source}\\s+(?:vers[ií]culos?|versos?|verses?)\\b|\\b(?:vers[ií]culos?|versos?|verses?)\\s+${ORDINAL_RE.source}`,
          "i",
        ),
      );
      if (verseOrd) {
        const ordWord = verseOrd[1] ?? verseOrd[2];
        if (ordWord) extractedVerse = ordinalToNumber(ordWord);
      }
    }
  }

  // Chapter with number: "chapter 1", "capítulo 2", "cap. 3", "ch 1"
  const chapterNum = text.match(
    /\b(?:cap[ií]tulos?|chapters?|ch|cap)\.?\s+(\d+)\b/i,
  );
  if (chapterNum) {
    extractedChapter = Number.parseInt(chapterNum[1], 10);
  } else {
    // Ordinal chapter: "primer capítulo", "first chapter", "capítulo primero"
    const chapterOrd = text.match(
      new RegExp(
        `${ORDINAL_RE.source}\\s+(?:cap[ií]tulos?|chapters?)\\b|\\b(?:cap[ií]tulos?|chapters?)\\s+${ORDINAL_RE.source}`,
        "i",
      ),
    );
    if (chapterOrd) {
      const ordWord = chapterOrd[1] ?? chapterOrd[2];
      if (ordWord) extractedChapter = ordinalToNumber(ordWord);
    }
  }

  // Optional chapter when only verse was named: "chapter 2 verse 3" already
  // covered above; if nothing was extracted, bail.
  if (extractedChapter == null && extractedVerse == null) return null;

  return { extractedChapter, extractedVerse, extractedVerseEnd };
}
