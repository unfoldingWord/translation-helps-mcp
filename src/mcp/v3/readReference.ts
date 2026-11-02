/**
 * One reader for what a model sends as a Bible or OBS reference.
 *
 * It does not parse book names or story:frame itself. Bible strings go through
 * `parseReference` / `parseReferenceForTool`. OBS strings go through
 * `parseObsReference`. Decomposed OBS arguments go through the same Class O
 * assembly as the v2 OBS tools (`normalizeToolArgs` for `get_obs_story`,
 * the unprefixed name, not `th_get_passage`).
 * Decomposed Bible arguments use that Class C assembly, plus the intro and
 * cross-chapter shapes Class C does not build.
 */

import {
  bookNameToUsfm,
  formatObsReferenceLabel,
  isCanonicalUsfmBook,
  parseObsReference,
  parseReference,
  parseReferenceForTool,
  type ObsReference,
} from "@translation-helps/door43";
import { normKey, normalizeToolArgs } from "../normalizeToolArgs.js";

const ACCEPTED_FORMS =
  'Accepted forms: a Bible reference such as "JHN 3:16", "John 3:16-18", "GEN 1", "JHN front:intro" or "JHN 1:intro"; a book alone such as "JON" or "Jonah"; an OBS reference such as "OBS 3:5", "OBS 3:1-3", "OBS 3" or "3:5". Decomposed {book, chapter, verse} and {story, frame, endFrame} (or story_number / frame_number) are accepted too.';

/** Same story keys as Class O in normalizeToolArgs. */
const OBS_STORY_KEYS = new Set([
  "story",
  "storynumber",
  "storyid",
  "obsstory",
  "obs",
]);
const OBS_FRAME_KEYS = new Set([
  "frame",
  "framenumber",
  "framestart",
  "startframe",
]);
const OBS_END_FRAME_KEYS = new Set(["endframe", "frameend", "lastframe"]);

export type BibleReferenceRead = {
  kind: "bible";
  /** USFM code. Empty when the string is a bare intro (`front:intro`, `1:intro`). */
  book: string;
  chapter?: string;
  verse?: string;
  endChapter?: string;
  endVerse?: string;
  /** Stable form to send back to a tool or a REST route. */
  reference: string;
};

export type ObsReferenceRead = {
  kind: "obs";
  /** null for front matter (`front`, `OBS front`). */
  story: number | null;
  frame?: number;
  endFrame?: number;
  reference: string;
};

export type BookReferenceRead = {
  kind: "book";
  book: string;
  reference: string;
};

export type ReferenceRead =
  | BibleReferenceRead
  | ObsReferenceRead
  | BookReferenceRead;

export type ReadReferenceResult =
  | { ok: true; value: ReferenceRead }
  | { ok: false; message: string };

/**
 * Read a string reference or a decomposed argument object.
 * `language` is the caller's resource language (also read from the object).
 * The book-name table already includes the localized names v2 accepts; the
 * language is named in the error when a name does not resolve.
 */
export function readReference(
  input: unknown,
  language?: string,
): ReadReferenceResult {
  // Internal channel: the v3 arg normalizer stores a reader error in the
  // reference string so Zod still sees a string and the handler can repeat it.
  if (typeof input === "string" && input.startsWith("\u0000")) {
    return { ok: false, message: input.slice(1) };
  }

  if (typeof input === "string") {
    return classifyString(input, language);
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    return classifyObject(input as Record<string, unknown>, language);
  }

  return fail("Give a reference string or a decomposed reference.", language);
}

function fail(detail: string, language?: string): ReadReferenceResult {
  const where = language ? ` Language: "${language}".` : "";
  return { ok: false, message: `${detail}${where} ${ACCEPTED_FORMS}` };
}

function classifyObject(
  obj: Record<string, unknown>,
  language: string | undefined,
): ReadReferenceResult {
  const lang = pickLanguage(obj) ?? language;
  const explicit = explicitReference(obj);
  const obs = hasKey(obj, isObsKey);
  const bible = hasKey(obj, isBibleKey);

  if (!explicit && obs && bible) {
    return fail(
      "Give either a Bible reference or an OBS reference, not both.",
      lang,
    );
  }
  if (explicit) return classifyString(explicit, lang);
  if (obs) {
    const normalized = normalizeToolArgs("get_obs_story", obj);
    const text =
      typeof normalized.reference === "string"
        ? normalized.reference.trim()
        : "";
    if (!text) {
      return fail(
        "An OBS reference needs a story from 1 to 50, for example {story: 3, frame: 5}.",
        lang,
      );
    }
    return classifyString(text, lang);
  }
  if (bible) {
    const built = bibleStringFromParts(obj);
    if (built) return classifyString(built, lang);
    const normalized = normalizeToolArgs("get_passage", obj);
    const text =
      typeof normalized.reference === "string"
        ? normalized.reference.trim()
        : "";
    if (!text) {
      return fail(
        'A decomposed Bible reference needs a book, for example {book: "JHN", chapter: 3, verse: 16}.',
        lang,
      );
    }
    return classifyString(text, lang);
  }
  return fail("Give a reference.", lang);
}

function classifyString(
  input: string,
  language: string | undefined,
): ReadReferenceResult {
  // The normalizer puts the reader error in `reference` and Zod then hands
  // the handler an object. Repeat that message as-is; do not wrap it again.
  if (input.startsWith("\u0000")) {
    return { ok: false, message: input.slice(1) };
  }

  const trimmed = input.trim();
  if (!trimmed) return fail("The reference is empty.", language);

  const bookIntro = trimmed.match(/^(?:(.+?)\s+)?front:intro$/i);
  if (bookIntro) {
    return bibleIntro(bookIntro[1], "front", language);
  }

  const chapterIntro = trimmed.match(/^(?:(.+?)\s+)?(\d+):intro$/i);
  if (chapterIntro) {
    return bibleIntro(chapterIntro[1], chapterIntro[2] ?? "", language);
  }

  if (/^obs\b/i.test(trimmed)) {
    return fromObsParser(trimmed, language);
  }

  if (/^\d+:\d+(?:-\d+)?$/.test(trimmed) || /^\d+$/.test(trimmed)) {
    return fromObsParser(trimmed, language);
  }

  const bible = fromBibleParser(trimmed, language);
  if (bible.ok) return bible;

  const obs = parseObsReference(trimmed);
  if (obs) return { ok: true, value: obsValue(obs) };

  return bible;
}

function bibleIntro(
  bookPart: string | undefined,
  chapter: string,
  language: string | undefined,
): ReadReferenceResult {
  if (bookPart && /^obs$/i.test(bookPart.trim())) {
    return fail(
      `"${bookPart} ${chapter === "front" ? "front:intro" : `${chapter}:intro`}" is not an OBS story:frame.`,
      language,
    );
  }
  if (!bookPart) {
    const reference = chapter === "front" ? "front:intro" : `${chapter}:intro`;
    return {
      ok: true,
      value: {
        kind: "bible",
        book: "",
        chapter,
        verse: "intro",
        reference,
      },
    };
  }
  const book = canonicalBook(bookPart);
  if (!book) {
    return fail(`No Bible book named "${bookPart.trim()}".`, language);
  }
  const reference =
    chapter === "front" ? `${book} front:intro` : `${book} ${chapter}:intro`;
  return {
    ok: true,
    value: {
      kind: "bible",
      book,
      chapter,
      verse: "intro",
      reference,
    },
  };
}

function fromObsParser(
  input: string,
  language: string | undefined,
): ReadReferenceResult {
  const parsed = parseObsReference(input);
  if (!parsed) {
    return fail(
      `"${input.trim()}" is not an OBS reference. Stories are 1 to 50, and a frame range must run forward ("OBS 3:1-3").`,
      language,
    );
  }
  return { ok: true, value: obsValue(parsed) };
}

function obsValue(ref: ObsReference): ObsReferenceRead {
  const value: ObsReferenceRead = {
    kind: "obs",
    story: ref.isFront ? null : ref.story,
    reference: formatObsReferenceLabel(ref.isFront ? "front" : ref.canonical),
  };
  if (!ref.isFront && ref.frame !== null) value.frame = ref.frame;
  if (ref.frameEnd !== undefined) value.endFrame = ref.frameEnd;
  return value;
}

function fromBibleParser(
  input: string,
  language: string | undefined,
): ReadReferenceResult {
  const parsed = parseReference(input);
  if (!parsed.isValid || !parsed.book) {
    return fail(`"${input}" is not a Bible reference.`, language);
  }
  const book = bookNameToUsfm(parsed.book);
  if (!isCanonicalUsfmBook(book)) {
    return fail(`No Bible book named "${parsed.book}".`, language);
  }
  if (parsed.chapter === undefined) {
    return { ok: true, value: { kind: "book", book, reference: book } };
  }

  const tool = parseReferenceForTool(input);
  if (!tool) {
    return fail(`"${input}" is not a Bible reference.`, language);
  }
  const value: BibleReferenceRead = {
    kind: "bible",
    book: tool.book,
    chapter: tool.chapter,
    reference: formatBible(
      tool.book,
      tool.chapter,
      tool.verseStart,
      tool.endChapter,
      tool.verseEnd,
    ),
  };
  if (tool.verseStart !== undefined) value.verse = tool.verseStart;
  if (tool.endChapter !== undefined) value.endChapter = tool.endChapter;
  if (tool.verseEnd !== undefined) value.endVerse = tool.verseEnd;
  return { ok: true, value };
}

function formatBible(
  book: string,
  chapter: string,
  verse?: string,
  endChapter?: string,
  endVerse?: string,
): string {
  if (verse && endChapter && endChapter !== chapter) {
    return `${book} ${chapter}:${verse}-${endChapter}:${endVerse ?? verse}`;
  }
  if (!verse && endChapter && endChapter !== chapter) {
    return `${book} ${chapter}-${endChapter}`;
  }
  if (!verse) return `${book} ${chapter}`;
  if (endVerse && endVerse !== verse) {
    return `${book} ${chapter}:${verse}-${endVerse}`;
  }
  return `${book} ${chapter}:${verse}`;
}

function canonicalBook(name: string): string | null {
  const parsed = parseReference(name.trim());
  if (!parsed.isValid || !parsed.book || parsed.chapter !== undefined) {
    return null;
  }
  const code = bookNameToUsfm(parsed.book);
  return isCanonicalUsfmBook(code) ? code : null;
}

function explicitReference(obj: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(obj)) {
    if (normKey(key) !== "reference") continue;
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function pickLanguage(obj: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(obj)) {
    const nk = normKey(key);
    if (nk !== "language" && nk !== "languagecode" && nk !== "lang") continue;
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function hasKey(
  obj: Record<string, unknown>,
  pred: (normalizedKey: string) => boolean,
): boolean {
  return Object.keys(obj).some((key) => pred(normKey(key)));
}

function isObsKey(nk: string): boolean {
  return (
    OBS_STORY_KEYS.has(nk) ||
    OBS_FRAME_KEYS.has(nk) ||
    OBS_END_FRAME_KEYS.has(nk)
  );
}

function isBibleKey(nk: string): boolean {
  return (
    isBookKey(nk) ||
    nk === "chapter" ||
    nk === "chapternumber" ||
    nk === "endchapter" ||
    nk === "chapterend" ||
    nk === "verse" ||
    nk === "versenumber" ||
    nk === "versestart" ||
    nk === "startverse" ||
    nk === "endverse" ||
    nk === "verseend"
  );
}

function isBookKey(nk: string): boolean {
  return nk === "book" || nk.startsWith("book");
}

/**
 * Introductions and cross-chapter ranges, which Class C does not assemble.
 * Returns undefined when Class C should build the string instead.
 */
function bibleStringFromParts(
  obj: Record<string, unknown>,
): string | undefined {
  const book = partText(firstValue(obj, isBookKey));
  const chapter = partText(
    firstValue(obj, (nk) => nk === "chapter" || nk === "chapternumber"),
  );
  const verse = partText(
    firstValue(
      obj,
      (nk) =>
        nk === "verse" ||
        nk === "versenumber" ||
        nk === "versestart" ||
        nk === "startverse",
    ),
  );
  const endChapter = partText(
    firstValue(obj, (nk) => nk === "endchapter" || nk === "chapterend"),
  );
  const endVerse = partText(
    firstValue(obj, (nk) => nk === "endverse" || nk === "verseend"),
  );

  if (!book) return undefined;
  if (chapter && /^front$/i.test(chapter)) return `${book} front:intro`;
  if (chapter && verse && /^intro$/i.test(verse)) {
    return `${book} ${chapter}:intro`;
  }
  if (chapter && endChapter && verse) {
    return `${book} ${chapter}:${verse}-${endChapter}:${endVerse ?? verse}`;
  }
  if (chapter && endChapter && !verse)
    return `${book} ${chapter}-${endChapter}`;
  if (!chapter && !verse && !endChapter && !endVerse) return book;
  return undefined;
}

function firstValue(
  obj: Record<string, unknown>,
  pred: (normalizedKey: string) => boolean,
): unknown {
  for (const key of Object.keys(obj)) {
    if (pred(normKey(key))) return obj[key];
  }
  return undefined;
}

function partText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}
