/**
 * OBS Reference Parser (issue #32)
 *
 * Open Bible Stories content is keyed by a `story:frame` scheme, NOT the Bible
 * `book chapter:verse` scheme:
 *
 *   - "1:1"     → story 1, frame 1
 *   - "1:0"     → story 1 title
 *   - "front"   → front matter (also "front:intro", "intro")
 *   - "1:1-8"   → story 1, frames 1 through 8 (ranges appear in Study Questions)
 *   - "1"       → whole story 1
 *   - Story numbers run 1–50; frame 0 is the story title.
 *
 * This parser is deliberately ISOLATED from the Bible reference parsers
 * (src/functions/reference-parser.ts, src/parsers/referenceParser.ts) so OBS
 * support carries zero regression risk for Bible-reference behavior.
 *
 * Tolerated prefixes (LLM-generated input, Postel's law — same spirit as
 * issue #24): a leading "obs" and/or "story" token is accepted and ignored,
 * so "OBS 1:1", "obs 1:1" and "story 1 frame 1" style inputs resolve.
 */

/** Highest published OBS story number (stories are 01.md … 50.md). */
export const OBS_MAX_STORY = 50;

export interface ParsedOBSReference {
  /** Story number 1–50. Absent when isFront is true. */
  story?: number;
  /** Frame number; 0 = story title. Absent = whole story. */
  frame?: number;
  /** Inclusive end frame for a range (e.g. "1:1-8"). */
  endFrame?: number;
  /** True for front matter ("front", "front:intro", "intro"). */
  isFront: boolean;
}

/** Error message shown for unparseable OBS references (kept in one place). */
const INVALID_HINT =
  'Expected an OBS story:frame reference. Valid examples: "1:1" (story 1, frame 1), ' +
  '"OBS 1:1", "1:0" (story title), "1" (whole story), "1:1-8" (frame range), "front" (front matter). ' +
  `Story numbers run 1-${OBS_MAX_STORY}; this is NOT a Bible book chapter:verse reference.`;

function invalidOBSReference(input: string, detail?: string): Error {
  const suffix = detail ? ` (${detail})` : "";
  return new Error(
    `Invalid OBS reference: "${input}"${suffix}. ${INVALID_HINT}`,
  );
}

/**
 * Parse an OBS reference string. Throws a plain Error (→ HTTP 400 at the
 * endpoint layer, mirroring invalid Bible references) when the input cannot
 * be understood as an OBS reference.
 */
export function parseOBSReference(input: string): ParsedOBSReference {
  if (typeof input !== "string" || input.trim() === "") {
    throw invalidOBSReference(String(input), "empty reference");
  }

  // Normalize: trim, collapse whitespace, lowercase for token matching.
  let ref = input.trim().replace(/\s+/g, " ").toLowerCase();

  // Strip tolerated leading tokens: "obs", "story" (optionally both).
  ref = ref.replace(/^obs\b[\s:.,-]*/, "");
  ref = ref.replace(/^story\b[\s:.,-]*/, "");

  // Front matter: "front", "front:intro", "front intro", "intro".
  if (/^(front([\s:]+intro)?|intro)$/.test(ref)) {
    return { isFront: true };
  }

  // "1 frame 1" / "1 1" → "1:1" (decomposed spoken forms).
  ref = ref.replace(/^(\d{1,2})[\s]*(?:frame|f)?[\s:]+(\d{1,3})/, "$1:$2");

  // story[:frame[-endFrame]]
  const m = ref.match(/^(\d{1,2})(?::(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?$/);
  if (!m) {
    throw invalidOBSReference(input);
  }

  const story = parseInt(m[1], 10);
  if (story < 1 || story > OBS_MAX_STORY) {
    throw invalidOBSReference(
      input,
      `story ${story} out of range 1-${OBS_MAX_STORY}`,
    );
  }

  const parsed: ParsedOBSReference = { story, isFront: false };
  if (m[2] !== undefined) {
    parsed.frame = parseInt(m[2], 10);
    if (m[3] !== undefined) {
      const endFrame = parseInt(m[3], 10);
      if (endFrame < parsed.frame) {
        throw invalidOBSReference(
          input,
          `end frame ${endFrame} is before start frame ${parsed.frame}`,
        );
      }
      if (endFrame > parsed.frame) parsed.endFrame = endFrame;
    }
  }
  return parsed;
}

/**
 * Resolve the OBS reference from tool-call arguments, honoring the decomposed
 * `story`/`frame`/`endFrame` fallback fields the MCP schemas advertise
 * (issue #24 convention). Shared by BOTH transports: the stdio handlers call
 * this directly, and it mirrors the HTTP path's UnifiedMCPHandler assembly —
 * so a schema-compliant `{story: 1, frame: 2}` call works everywhere.
 * Returns undefined when neither `reference` nor `story` is present.
 */
export function resolveOBSReferenceArg(
  args: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const present = (v: unknown): boolean =>
    v !== undefined && v !== null && String(v).trim() !== "";

  if (present(args.reference)) return String(args.reference);
  if (!present(args.story)) return undefined;

  let ref = String(args.story).trim();
  if (present(args.frame)) {
    ref += `:${String(args.frame).trim()}`;
    if (present(args.endFrame)) ref += `-${String(args.endFrame).trim()}`;
  }
  return ref;
}

/** Canonical string form of a parsed OBS reference (e.g. "1:1", "1:1-8", "front", "12"). */
export function formatOBSReference(ref: ParsedOBSReference): string {
  if (ref.isFront) return "front";
  if (ref.frame === undefined) return String(ref.story);
  const base = `${ref.story}:${ref.frame}`;
  return ref.endFrame !== undefined ? `${base}-${ref.endFrame}` : base;
}

/** Zero-padded story markdown filename inside the en_obs repo (e.g. 1 → "01.md"). */
export function obsStoryFileName(story: number): string {
  return `${String(story).padStart(2, "0")}.md`;
}
