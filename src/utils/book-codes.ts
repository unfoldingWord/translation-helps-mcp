/**
 * Valid 3-letter Bible book codes
 * Used for validation and error messages
 */

import { resolveLocalizedBookNameToCode } from "./multilingual-book-names.js";

export const VALID_BOOK_CODES = {
  // Old Testament
  GEN: "Genesis",
  EXO: "Exodus",
  LEV: "Leviticus",
  NUM: "Numbers",
  DEU: "Deuteronomy",
  JOS: "Joshua",
  JDG: "Judges",
  RUT: "Ruth",
  "1SA": "1 Samuel",
  "2SA": "2 Samuel",
  "1KI": "1 Kings",
  "2KI": "2 Kings",
  "1CH": "1 Chronicles",
  "2CH": "2 Chronicles",
  EZR: "Ezra",
  NEH: "Nehemiah",
  EST: "Esther",
  JOB: "Job",
  PSA: "Psalms",
  PRO: "Proverbs",
  ECC: "Ecclesiastes",
  SNG: "Song of Solomon",
  ISA: "Isaiah",
  JER: "Jeremiah",
  LAM: "Lamentations",
  EZK: "Ezekiel",
  DAN: "Daniel",
  HOS: "Hosea",
  JOL: "Joel",
  AMO: "Amos",
  OBA: "Obadiah",
  JON: "Jonah",
  MIC: "Micah",
  NAM: "Nahum",
  HAB: "Habakkuk",
  ZEP: "Zephaniah",
  HAG: "Haggai",
  ZEC: "Zechariah",
  MAL: "Malachi",

  // New Testament
  MAT: "Matthew",
  MRK: "Mark",
  LUK: "Luke",
  JHN: "John",
  ACT: "Acts",
  ROM: "Romans",
  "1CO": "1 Corinthians",
  "2CO": "2 Corinthians",
  GAL: "Galatians",
  EPH: "Ephesians",
  PHP: "Philippians",
  COL: "Colossians",
  "1TH": "1 Thessalonians",
  "2TH": "2 Thessalonians",
  "1TI": "1 Timothy",
  "2TI": "2 Timothy",
  TIT: "Titus",
  PHM: "Philemon",
  HEB: "Hebrews",
  JAS: "James",
  "1PE": "1 Peter",
  "2PE": "2 Peter",
  "1JN": "1 John",
  "2JN": "2 John",
  "3JN": "3 John",
  JUD: "Jude",
  REV: "Revelation",
} as const;

/**
 * Get array of valid book codes
 */
export function getValidBookCodes(): string[] {
  return Object.keys(VALID_BOOK_CODES);
}

/**
 * Check if a book code is valid
 */
export function isValidBookCode(code: string): boolean {
  return code.toUpperCase() in VALID_BOOK_CODES;
}

/**
 * Get book name from code
 */
export function getBookName(code: string): string | undefined {
  return VALID_BOOK_CODES[code.toUpperCase() as keyof typeof VALID_BOOK_CODES];
}

/**
 * Get formatted list of valid book codes for error messages
 */
export function getBookCodesForError(): Array<{ code: string; name: string }> {
  return Object.entries(VALID_BOOK_CODES).map(([code, name]) => ({
    code,
    name,
  }));
}

/**
 * Get book code from name (reverse lookup)
 * English + localized display names (see src/data/book-names-by-language.json).
 * @param bookName - Book name to search for (e.g., "John", "Genesis", "Génesis", "1 John", "Mateo")
 * @param language - optional BCP-47 tag (e.g. `es-419`, `fr`) to prefer that locale's book titles
 * @returns 3-letter book code or undefined if not found
 */
export function getBookCodeFromName(
  bookName: string,
  language?: string,
): string | undefined {
  const normalized = bookName.trim().toLowerCase();

  // Direct English match
  for (const [code, name] of Object.entries(VALID_BOOK_CODES)) {
    if (name.toLowerCase() === normalized) {
      return code;
    }
  }

  // Localized full titles (Génesis → GEN, Mateo → MAT, etc.)
  const fromLocale = resolveLocalizedBookNameToCode(bookName, language);
  if (fromLocale) {
    return fromLocale;
  }

  // Fuzzy match - check if the English name starts with the search term
  for (const [code, name] of Object.entries(VALID_BOOK_CODES)) {
    if (name.toLowerCase().startsWith(normalized)) {
      return code;
    }
  }

  // Check if it's already a valid code
  if (isValidBookCode(bookName)) {
    return bookName.toUpperCase();
  }

  return undefined;
}

/**
 * Normalize a Bible reference to use 3-letter book codes
 * Handles full book names in English and converts them to codes
 * @param reference - Reference like "Tito 3:11-15" or "TIT 3:11-15"
 * @returns Normalized reference with 3-letter code (e.g., "TIT 3:11-15")
 */
export function normalizeReference(
  reference: string,
  language?: string,
): string {
  const match = reference.match(
    /^((?:[1-3]\s+)?[\p{L}][\p{L}0-9\s.'’-]+)\s*(\d.*)$/u,
  );
  if (!match) {
    return reference; // No book name found, return as-is
  }

  const bookPart = match[1].trim();
  const restOfReference = match[2].trim();

  // Try to convert book name to code
  const code = getBookCodeFromName(bookPart, language);
  if (code) {
    return `${code} ${restOfReference}`;
  }

  // If no conversion found, return original
  return reference;
}
