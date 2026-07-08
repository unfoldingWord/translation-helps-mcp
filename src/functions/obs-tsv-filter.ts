/**
 * OBS TSV Row Filter (issue #32)
 *
 * Unlike the per-book Bible TSVs, each OBS help is ONE TSV per language
 * (tn_OBS.tsv / tq_OBS.tsv / sn_OBS.tsv / sq_OBS.tsv) covering all 50
 * stories. Rows are keyed by a Reference column in the story:frame scheme:
 *
 *   1:1       story 1, frame 1
 *   1:0       story 1 title
 *   front     front matter (Study Questions carry a usage guide here)
 *   1:1-8     a frame RANGE (Study Questions group frames)
 *
 * So fetching OBS helps means filtering the whole file's rows by
 * frame-set OVERLAP with the requested reference — a range row like 1:1-8
 * must match a request for 1:3, and a range request must pick up every row
 * it touches.
 */

import type { ParsedOBSReference } from "./obs-reference-parser.js";

/** A row's Reference parsed to a frame interval (or front matter). */
interface RowRef {
  front: boolean;
  story?: number;
  startFrame?: number;
  endFrame?: number;
}

/**
 * Leniently parse a TSV row's Reference cell. Returns null for anything
 * unrecognized so malformed rows simply never match (they are data, not
 * caller input — not worth an error).
 */
function parseRowReference(raw: string): RowRef | null {
  const ref = (raw || "").trim().toLowerCase();
  if (ref === "") return null;
  if (ref.startsWith("front") || ref === "intro") return { front: true };

  const m = ref.match(/^(\d{1,2})(?::(\d{1,3})(?:-(\d{1,3}))?)?$/);
  if (!m) return null;

  const story = parseInt(m[1], 10);
  if (m[2] === undefined) return { front: false, story }; // whole-story row
  const startFrame = parseInt(m[2], 10);
  const endFrame = m[3] !== undefined ? parseInt(m[3], 10) : startFrame;
  return { front: false, story, startFrame, endFrame };
}

/** Does a row's frame interval overlap the requested reference? */
function matches(row: RowRef, ref: ParsedOBSReference): boolean {
  if (ref.isFront) return row.front;
  if (row.front) return false;
  if (row.story !== ref.story) return false;

  // Whole-story request → every row of the story (title row included).
  if (ref.frame === undefined) return true;
  // Whole-story row → matches any frame of the story.
  if (row.startFrame === undefined) return true;

  const reqStart = ref.frame;
  const reqEnd = ref.endFrame ?? ref.frame;
  return (
    row.startFrame <= reqEnd && (row.endFrame ?? row.startFrame) >= reqStart
  );
}

/**
 * Filter OBS TSV rows (as parsed by parseTSV — header-keyed records with a
 * Reference column) down to those matching the requested reference.
 */
export function filterOBSTSVRows<T extends Record<string, string>>(
  rows: T[],
  ref: ParsedOBSReference,
): T[] {
  return rows.filter((row) => {
    const rowRef = parseRowReference(row.Reference ?? row.reference ?? "");
    return rowRef !== null && matches(rowRef, ref);
  });
}
