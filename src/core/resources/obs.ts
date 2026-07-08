/**
 * Open Bible Stories (OBS) support — core parsing and fetch utilities.
 *
 * OBS uses a story:frame reference scheme (e.g. "1:1") instead of the
 * standard Bible book:chapter:verse scheme. This module keeps OBS logic
 * completely separate from the Bible reference parser so neither gains
 * regression risk from the other.
 *
 * Resources on DCS:
 *   OBS text     — repo {lang}_obs          content/NN.md (01.md … 50.md)
 *   OBS tN       — repo {lang}_obs-tn       tn_OBS.tsv (single file)
 *   OBS tQ       — repo {lang}_obs-tq       tq_OBS.tsv (single file)
 *
 * Reference: upstream issue unfoldingWord/translation-helps-mcp #32
 */

// ---------------------------------------------------------------------------
// OBS reference type
// ---------------------------------------------------------------------------

export interface ObsReference {
  /** Story number, 1–50. null for "front" (front matter). */
  story: number | null;
  /**
   * Frame number within the story (1-based).
   * 0 = story title/header.
   * null = all frames (whole story requested).
   */
  frame: number | null;
  /** True if this is the "front" / intro reference. */
  isFront: boolean;
  /** Canonical string form: "1:1", "1:0", "front". */
  canonical: string;
}

// ---------------------------------------------------------------------------
// OBS reference parser
// ---------------------------------------------------------------------------

/**
 * Parse an OBS reference string into an ObsReference.
 *
 * Accepted formats:
 *   "front"        — front matter / intro
 *   "1:0"          — story 1 title
 *   "1:1"          — story 1, frame 1
 *   "1:1-8"        — story 1, frames 1–8 (range; frame = first frame)
 *   "obs 1:1"      — prefix is ignored
 *   "OBS 1:1"      — same
 *
 * Returns null if the string is not a valid OBS reference.
 */
export function parseObsReference(input: string): ObsReference | null {
  if (!input || typeof input !== "string") return null;

  let s = input.trim().toLowerCase();

  // Strip optional "obs" prefix
  if (s.startsWith("obs ") || s.startsWith("obs:")) {
    s = s.slice(4).trim();
  } else if (s === "obs") {
    return null; // bare "obs" is not a reference
  }

  // Front matter
  if (s === "front" || s === "front:intro") {
    return { story: null, frame: null, isFront: true, canonical: "front" };
  }

  // story:frame or story:frame-endFrame
  const match = s.match(/^(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;

  const story = parseInt(match[1], 10);
  const frame = parseInt(match[2], 10);

  if (story < 1 || story > 50) return null;

  return {
    story,
    frame,
    isFront: false,
    canonical: `${story}:${frame}`,
  };
}

// ---------------------------------------------------------------------------
// OBS story text parser
// ---------------------------------------------------------------------------

export interface ObsFrame {
  /** 1-based frame index within the story. 0 = story title pseudo-frame. */
  index: number;
  /** Image URL extracted from the markdown image tag. */
  imageUrl: string | null;
  /** Story text for this frame (paragraph following the image). */
  text: string;
}

export interface ObsStory {
  story: number;
  title: string;
  frames: ObsFrame[];
  /** Trailing "A Bible story from: …" attribution line. */
  attribution: string | null;
}

/**
 * Parse an OBS story markdown file into structured frames.
 *
 * OBS markdown format (per upstream prototype findings):
 *   # Story Title
 *   [Image: image | url]
 *   Frame paragraph.
 *   [Image: image | url]
 *   Frame paragraph.
 *   …
 *   _A Bible story from: Genesis 1–2_
 */
export function parseObsStoryMarkdown(
  storyNumber: number,
  markdown: string,
): ObsStory {
  const lines = markdown.split("\n").map((l) => l.trim());

  let title = `Story ${storyNumber}`;
  let attribution: string | null = null;
  const frames: ObsFrame[] = [];

  let i = 0;

  // Extract title from first heading
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      i++;
      break;
    }
    if (line) break; // Non-empty non-heading line — skip header search
  }

  // Walk image + paragraph pairs
  let frameIndex = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    // Image line: ![image](url) or [Image: image | url] style
    const imgMatch =
      line.match(/!\[.*?\]\((.*?)\)/) || line.match(/\[image:.*?\|\s*(.*?)\]/i);

    if (imgMatch) {
      const imageUrl = imgMatch[1]?.trim() ?? null;
      i++;
      // Collect the frame paragraph: skip blank lines, stop at the next image or attribution.
      const textLines: string[] = [];
      while (i < lines.length) {
        const next = lines[i];
        // Stop at next image line
        if (next.match(/!\[.*?\]\(/) || next.match(/\[image:/i)) break;
        // Stop at attribution line
        if (next.match(/^_.*_$/) || next.toLowerCase().startsWith("_a bible"))
          break;
        // Collect non-empty lines; skip blank ones between image and text
        if (next) textLines.push(next);
        i++;
        // Stop after collecting text if we hit a blank line AFTER at least one text line
        if (!next && textLines.length > 0) break;
      }
      if (textLines.length > 0) {
        frames.push({
          index: frameIndex++,
          imageUrl,
          text: textLines.join(" ").trim(),
        });
      }
    } else if (
      line.match(/^_.*_$/) ||
      line.toLowerCase().startsWith("_a bible story")
    ) {
      // Attribution line
      attribution = line.replace(/^_|_$/g, "").trim();
      i++;
    } else {
      i++;
    }
  }

  return { story: storyNumber, title, frames, attribution };
}

// ---------------------------------------------------------------------------
// OBS TSV parsers
// ---------------------------------------------------------------------------

export interface ObsNoteRow {
  reference: string;
  id: string;
  supportReference: string;
  quote: string;
  occurrence: string;
  note: string;
}

export interface ObsQuestionRow {
  reference: string;
  id: string;
  question: string;
  response: string;
}

/**
 * Parse the unified OBS Translation Notes TSV (tn_OBS.tsv).
 *
 * Columns: Reference  ID  Tags  SupportReference  Quote  Occurrence  Note
 * Reference format: "story:frame" (e.g. "1:1", "1:0", "front:intro")
 *
 * Filtering:
 *   - Pass story + frame to get notes for a specific frame.
 *   - Pass story + frame = null to get all notes for a story.
 *   - Pass story = null (front) to get front-matter notes.
 */
export function parseObsNotesTsv(tsv: string, ref: ObsReference): ObsNoteRow[] {
  const lines = tsv.split("\n");
  const results: ObsNoteRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < 7) continue;

    const [rowRef, id, , supRef, quote, occurrence, ...noteParts] = cols;
    if (!rowRef) continue;

    if (!matchesObsRef(rowRef, ref)) continue;

    results.push({
      reference: rowRef,
      id: id ?? "",
      supportReference: supRef ?? "",
      quote: quote ?? "",
      occurrence: occurrence ?? "",
      note: noteParts.join("\t").trim(),
    });
  }
  return results;
}

/**
 * Parse the unified OBS Translation Questions TSV (tq_OBS.tsv).
 *
 * Columns: Reference  ID  Tags  Quote  Occurrence  Question  Response
 */
export function parseObsQuestionsTsv(
  tsv: string,
  ref: ObsReference,
): ObsQuestionRow[] {
  const lines = tsv.split("\n");
  const results: ObsQuestionRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < 6) continue;

    const [rowRef, id, , , , question, ...responseParts] = cols;
    if (!rowRef) continue;

    if (!matchesObsRef(rowRef, ref)) continue;

    results.push({
      reference: rowRef,
      id: id ?? "",
      question: question?.trim() ?? "",
      response: responseParts.join("\t").trim(),
    });
  }
  return results;
}

/**
 * Check whether a TSV row's reference matches the requested ObsReference.
 *
 * Supports:
 *   - Exact match: "1:1" matches ref {story:1, frame:1}
 *   - Range match: "1:1-8" matches any frame 1–8 of story 1
 *   - Whole-story: ref.frame = null → match all frames of that story
 *   - Front: ref.isFront → match "front" and "front:intro" rows
 */
function matchesObsRef(rowRef: string, ref: ObsReference): boolean {
  const r = rowRef.trim().toLowerCase();

  if (ref.isFront) {
    return r === "front" || r === "front:intro" || r.startsWith("front:");
  }

  if (ref.story === null) return false;

  // Parse row reference: "story:frame" or "story:frameStart-frameEnd"
  const m = r.match(/^(\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return false;

  const rowStory = parseInt(m[1], 10);
  if (rowStory !== ref.story) return false;

  if (ref.frame === null) return true; // match all frames of this story

  const rowFrameStart = parseInt(m[2], 10);
  const rowFrameEnd = m[3] ? parseInt(m[3], 10) : rowFrameStart;

  return ref.frame >= rowFrameStart && ref.frame <= rowFrameEnd;
}

// ---------------------------------------------------------------------------
// DCS catalog helpers for OBS resources
// ---------------------------------------------------------------------------

/**
 * Zero-pad a story number to two digits (1 → "01", 50 → "50").
 */
export function storyFilename(story: number): string {
  return `${story}`.padStart(2, "0") + ".md";
}

/**
 * Get the content path for an OBS story file.
 * DCS repo `{lang}_obs`, file `content/NN.md`.
 */
export function obsStoryPath(story: number): string {
  return `content/${storyFilename(story)}`;
}
