/**
 * OBS Story Markdown Parser (issue #32)
 *
 * An OBS story file (en_obs `content/NN.md`) has NO frame headings — frames
 * are implicit. The structure is:
 *
 *   # 1. The Creation                     ← story title (numbered)
 *   ![OBS Image](https://…/obs-en-01-01.jpg)
 *   This is how God made everything …    ← frame 1 = image + paragraph pair
 *   ![OBS Image](https://…/obs-en-01-02.jpg)
 *   Then God said, …                      ← frame 2
 *   …
 *   _A Bible story from: Genesis 1-2_     ← trailing source reference
 *
 * So the parser walks image/paragraph pairs rather than looking for `##`
 * headings. Story 1 has 16 such frames.
 */

import type { ParsedOBSReference } from "./obs-reference-parser.js";

export interface OBSFrame {
  /** 1-based frame number within the story. */
  frame: number;
  /** The frame's illustration URL (cdn.door43.org). */
  imageUrl: string;
  /** The frame's paragraph text. */
  text: string;
}

export interface ParsedOBSStory {
  story: number;
  /** Story title with the leading "NN." numbering stripped (e.g. "The Creation"). */
  title: string;
  frames: OBSFrame[];
  /** The trailing "_A Bible story from: …_" line, underscores stripped. */
  bibleReference?: string;
}

const IMAGE_LINE = /^!\[[^\]]*\]\(([^)\s]+)[^)]*\)\s*$/;
/** A line fully wrapped in underscores (the trailing source-reference line). */
const ITALIC_LINE = /^_(.+)_$/;

/**
 * Parse one OBS story markdown file into title + implicit frames.
 * `story` is the story number the file was fetched for (files carry it only
 * in the title text, which is translated, so it cannot be derived reliably).
 */
export function parseOBSStoryMarkdown(
  markdown: string,
  story: number,
): ParsedOBSStory {
  const lines = markdown.split(/\r?\n/);

  let title = "";
  const frames: OBSFrame[] = [];
  let bibleReference: string | undefined;
  let current: OBSFrame | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") continue;

    const heading = line.match(/^#\s+(.+)$/);
    if (heading && !title) {
      // Strip the "NN." numbering so the title matches how the OBS helps
      // TSVs quote it (tn_OBS.tsv row 1:0 quotes "The Creation").
      title = heading[1].replace(/^\d+\.\s*/, "").trim();
      continue;
    }

    const image = line.match(IMAGE_LINE);
    if (image) {
      current = { frame: frames.length + 1, imageUrl: image[1], text: "" };
      frames.push(current);
      continue;
    }

    const italic = line.match(ITALIC_LINE);
    if (italic) {
      // Trailing source line ("A Bible story from: …" in English; translated
      // in other languages) — matched structurally, not by its English text.
      bibleReference = italic[1].trim();
      continue;
    }

    if (current) {
      current.text = current.text ? `${current.text}\n${line}` : line;
    }
    // Text before the first image (other than the heading) is not frame
    // content; ignore it.
  }

  return { story, title, frames, ...(bibleReference && { bibleReference }) };
}

/**
 * Select the frames a parsed OBS reference asks for.
 *  - frame 0 ("1:0")   → title only, no frames
 *  - single frame      → that frame
 *  - range ("1:1-8")   → those frames
 *  - whole story ("1") → all frames
 * Front-matter references never reach here (the service fetches the front
 * matter file instead of a story file).
 */
export function selectOBSFrames(
  parsedStory: ParsedOBSStory,
  ref: ParsedOBSReference,
): OBSFrame[] {
  if (ref.frame === undefined) return parsedStory.frames;
  if (ref.frame === 0) return [];
  const end = ref.endFrame ?? ref.frame;
  return parsedStory.frames.filter(
    (f) => f.frame >= ref.frame! && f.frame <= end,
  );
}
