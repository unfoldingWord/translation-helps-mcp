/**
 * Passage-index row references and Translation Words categories.
 *
 * Notes and word links from the new TSV layout have an empty `book` cell.
 * The row reference uses the book the caller already passed, which is the
 * form get_note accepts.
 */

import { parseReference, usfmToBookName } from "@translation-helps/door43";

/** Category segment of a TW path: bible/kt/god → kt. */
export function twCategoryFromPath(path: string): "kt" | "names" | "other" {
  const segment = path.match(/^bible\/(kt|names|other)\//i)?.[1]?.toLowerCase();
  if (segment === "kt" || segment === "names" || segment === "other") {
    return segment;
  }
  return "other";
}

function cell(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? String(parseInt(text, 10)) : text;
}

/**
 * "Genesis 9:9" for a note or word row. `inputReference` is what the tool
 * was called with, so the book name stays in that form.
 */
export function passageRowReference(
  inputReference: string,
  bookUsfm: string,
  chapter: unknown,
  verse: unknown,
): string {
  const parsed = parseReference(inputReference);
  const name = (parsed.book || usfmToBookName(bookUsfm || "")).trim();
  const ch = cell(chapter);
  const vs = cell(verse);
  if (!name) return `${ch}:${vs}`.trim();
  if (!vs) return `${name} ${ch}`.trim();
  return `${name} ${ch}:${vs}`;
}
