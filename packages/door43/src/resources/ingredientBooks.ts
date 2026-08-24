/**
 * Extract USFM book codes from catalog ingredient identifiers.
 *
 * Catalog ingredients for scripture / TN / TQ / TWL typically use 3-letter
 * (or digit+2-letter) USFM codes. TW/TA ingredients are article paths and
 * are intentionally excluded.
 */

/** USFM book-code shape: GEN, TIT, 1SA, 2TI, 3JN, … */
const USFM_BOOK_RE = /^[1-3]?[A-Z]{2,3}$/;

/** Identifiers that look like book codes but are not. */
const NON_BOOK_IDENTIFIERS = new Set([
  "OBS",
  "FRONT",
  "INTRO",
  "BACK",
  "TA",
  "TW",
  "TQ",
  "TN",
  "TWL",
  "ULT",
  "UST",
  "GLT",
  "GST",
  "TPL",
  "UGNT",
  "UHB",
]);

/**
 * Return sorted unique USFM book codes present in catalog ingredients.
 * Empty when the resource is not book-scoped (or ingredients omit books).
 */
export function bookCodesFromIngredients(
  ingredients: Array<{ identifier?: string } | undefined> | undefined,
): string[] {
  if (!ingredients?.length) return [];
  const books = new Set<string>();
  for (const ing of ingredients) {
    const id = (ing?.identifier ?? "").trim().toUpperCase();
    if (!id || NON_BOOK_IDENTIFIERS.has(id)) continue;
    if (!USFM_BOOK_RE.test(id)) continue;
    // Prefer canonical 3-char USFM (or 3 with leading digit): drop 2-letter noise
    if (id.length === 2) continue;
    books.add(id);
  }
  return [...books].sort();
}

/**
 * Whether a book-scoped resource covers `book`.
 * Returns `null` when coverage is unknown (no book ingredients listed).
 */
export function ingredientCoversBook(
  ingredients: Array<{ identifier?: string } | undefined> | undefined,
  book: string,
): boolean | null {
  const books = bookCodesFromIngredients(ingredients);
  if (books.length === 0) return null;
  return books.includes(book.trim().toUpperCase());
}
