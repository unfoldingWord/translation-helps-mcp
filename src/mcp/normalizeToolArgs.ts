/**
 * LLM argument normalization for MCP tool calls.
 *
 * Applied BEFORE Zod schema validation so that common LLM-generated argument
 * patterns are accepted rather than rejected with strict-validation errors.
 *
 * Ported from upstream unfoldingWord/translation-helps-mcp issues #24 and #28:
 *   Class H: null / array / primitive args → {}
 *   Class B: path synonyms (word, term, word_id, article_id, …) → path
 *   Class C: decomposed {book, chapter, verse} → single reference string
 *   Class D: language_code / lang → language
 *   Class O: decomposed {story, frame} → OBS reference (OBS tools only)
 */

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

/** Tools whose Zod schemas require a `path` parameter. */
const PATH_TOOLS = new Set(["get_academy_article", "get_word_article"]);

/** Tools whose Zod schemas require a `reference` parameter. */
const REFERENCE_TOOLS = new Set([
  "get_passage",
  "get_passage_context",
  "get_passage_index",
  "get_note",
  "get_questions",
  "get_obs_story",
  "get_obs_notes",
  "get_obs_questions",
  "get_obs_study_notes",
  "get_obs_study_questions",
]);

/**
 * OBS tools. Class C must not turn book/chapter/verse into a Bible reference
 * for these; Class O assembles story/frame instead.
 */
const OBS_REFERENCE_TOOLS = new Set([
  "get_obs_story",
  "get_obs_notes",
  "get_obs_questions",
  "get_obs_study_notes",
  "get_obs_study_questions",
  "get_obs_index",
]);

// ---------------------------------------------------------------------------
// Path-synonym resolution (Class B)
// ---------------------------------------------------------------------------

/**
 * Canonical bare synonyms for `path` (excludes `topic`, which is a real
 * filter parameter on list tools and used as a path only as a last resort).
 *
 * Structural matching: a key is a path synonym if:
 *   (a) its normalized form is in this set, OR
 *   (b) it ends with "id" and its stem is in this set (e.g. word_id → word,
 *       article_id → article, termId → term).
 */
const PATH_SYNONYMS = new Set([
  "term",
  "word",
  "name",
  "article",
  "module",
  "moduleid",
  "identifier",
]);

/** Priority order for selecting the winning synonym (most specific first). */
const PATH_PRIORITY = [
  "term",
  "word",
  "name",
  "article",
  "module",
  "moduleid",
  "identifier",
  "id",
] as const;

/** Normalize a key for structural comparison: strip separators, lowercase. */
export function normKey(k: string): string {
  return k.replace(/[_\s-]/g, "").toLowerCase();
}

/**
 * Classify an arg key as a `path` synonym structurally.
 * Returns the canonical synonym base if the key is a synonym, or null.
 * Prevents consuming unrelated keys (e.g. "uuid" → null).
 */
function classifyPathSynonym(nk: string): string | null {
  if (nk === "id") return "id";
  if (PATH_SYNONYMS.has(nk)) return nk;
  // word_id → word, article_id → article, wordId → word, articleId → article, etc.
  if (nk.endsWith("id")) {
    const stem = nk.slice(0, -2);
    if (PATH_SYNONYMS.has(stem)) return stem;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Decomposed reference assembly (Class C)
// ---------------------------------------------------------------------------

/** Returns true if a normalized key looks like a book identifier. */
function isBookKey(nk: string): boolean {
  return nk === "book" || nk.startsWith("book");
}

// ---------------------------------------------------------------------------
// OBS reference assembly (Class O)
// ---------------------------------------------------------------------------

/** Story keys after `normKey`: story, story_number, story_id, obs_story, obs. */
const OBS_STORY_KEYS = new Set([
  "story",
  "storynumber",
  "storyid",
  "obsstory",
  "obs",
]);

/** Frame keys after `normKey`: frame, frame_number, frame_start, start_frame. */
const OBS_FRAME_KEYS = new Set([
  "frame",
  "framenumber",
  "framestart",
  "startframe",
]);

/** End-frame keys after `normKey`: end_frame, frame_end, last_frame. */
const OBS_END_FRAME_KEYS = new Set(["endframe", "frameend", "lastframe"]);

/**
 * Integer from a number or a numeric string. Anything else is not a token
 * we can place in an OBS reference — the caller leaves the args for Zod.
 */
function integerToken(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
    const n = Number(trimmed);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Build "{story}", "{story}:{frame}", or "{story}:{frame}-{endFrame}" and
 * remove the keys that were used. No-op when the story is not an integer
 * 1–50, when a frame is present without a story, when an end frame is
 * present without a start frame, or when a present frame is not an integer.
 * A non-integer end frame is appended as text, the same way Class C appends
 * a bad endVerse ("3:5-8x"), so the OBS parser rejects the range instead of
 * the call failing for a missing reference. Those no-op cases leave the args
 * for Zod.
 */
function assembleObsReference(args: Record<string, unknown>): void {
  let storyKey: string | undefined;
  let storyVal: number | undefined;
  let frameKey: string | undefined;
  let frameVal: number | undefined;
  let frameInvalid = false;
  let endKey: string | undefined;
  let endVal: number | undefined;
  let endInvalid = false;

  for (const k of Object.keys(args)) {
    const nk = normKey(k);
    if (OBS_STORY_KEYS.has(nk) && storyKey === undefined) {
      storyKey = k;
      storyVal = integerToken(args[k]);
    } else if (OBS_FRAME_KEYS.has(nk) && frameKey === undefined) {
      frameKey = k;
      const n = integerToken(args[k]);
      if (n === undefined) frameInvalid = true;
      else frameVal = n;
    } else if (OBS_END_FRAME_KEYS.has(nk) && endKey === undefined) {
      endKey = k;
      const n = integerToken(args[k]);
      if (n === undefined) endInvalid = true;
      else endVal = n;
    }
  }

  if (
    storyKey === undefined ||
    storyVal === undefined ||
    storyVal < 1 ||
    storyVal > 50
  ) {
    return;
  }
  if (frameKey !== undefined && frameInvalid) return;
  // An end frame with no start frame is not one of the three reference
  // shapes. Leave the args so Zod reports the missing reference.
  if (endKey !== undefined && frameKey === undefined) return;

  let ref = String(storyVal);
  const frameUsed = frameKey !== undefined && frameVal !== undefined;
  if (frameUsed) {
    ref += `:${String(frameVal)}`;
  }
  // Class C stringifies endVerse and appends it whenever a verse is present,
  // including a non-integer such as "8x". Do the same for end frame, and
  // still drop the key so strict schemas do not see an extra field.
  const endUsed = frameUsed && endKey !== undefined;
  if (endUsed && endKey !== undefined) {
    const endText = endInvalid ? String(args[endKey]) : String(endVal);
    if (endText !== "") ref += `-${endText}`;
  }

  args.reference = ref;
  delete args[storyKey];
  if (frameUsed && frameKey !== undefined) delete args[frameKey];
  if (endUsed && endKey !== undefined) delete args[endKey];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Normalize raw LLM-generated arguments before Zod schema validation.
 *
 * @param toolName - The MCP tool name (snake_case), used for tool-specific rules.
 * @param rawArgs  - The raw argument payload from the LLM or client.
 * @returns A normalized plain object suitable for Zod parsing.
 */
export function normalizeToolArgs(
  toolName: string,
  rawArgs: unknown,
): Record<string, unknown> {
  // Class H: null / array / primitive → {}
  if (
    rawArgs === null ||
    rawArgs === undefined ||
    Array.isArray(rawArgs) ||
    typeof rawArgs !== "object"
  ) {
    return {};
  }

  // Shallow copy so we don't mutate the caller's object.
  const args: Record<string, unknown> = {
    ...(rawArgs as Record<string, unknown>),
  };

  // ── Class D: language alias ────────────────────────────────────────────────
  // Handle language_code / lang → language before anything else, because other
  // normalizations may produce a `language` key that overrides this.
  if (
    args.language === undefined ||
    args.language === null ||
    args.language === ""
  ) {
    for (const k of Object.keys(args)) {
      const nk = normKey(k);
      if (nk === "languagecode" || nk === "lang") {
        args.language = args[k];
        delete args[k];
        break;
      }
    }
  }

  // ── Class B: structural path-synonym resolution ────────────────────────────
  if (
    PATH_TOOLS.has(toolName) &&
    (args.path === undefined || args.path === null || args.path === "")
  ) {
    // Collect all synonym candidates keyed by canonical synonym name.
    const bySyn = new Map<string, string>(); // canonical → original key
    for (const k of Object.keys(args)) {
      if (k === "path") continue;
      const nk = normKey(k);
      const syn = classifyPathSynonym(nk);
      if (
        syn &&
        args[k] !== undefined &&
        args[k] !== null &&
        args[k] !== "" &&
        !bySyn.has(syn)
      ) {
        bySyn.set(syn, k);
      }
    }

    // Apply in canonical priority order.
    for (const syn of PATH_PRIORITY) {
      const origKey = bySyn.get(syn);
      if (origKey) {
        args.path = String(args[origKey]).trim();
        break;
      }
    }

    // `topic` is a real filter param on list tools — use only as last resort.
    if ((args.path === undefined || args.path === "") && args.topic) {
      args.path = String(args.topic).trim();
      delete args.topic;
    }

    // Strip all consumed synonym keys so they don't trigger Zod "unrecognized_keys".
    for (const k of Object.keys(args)) {
      if (k !== "path" && classifyPathSynonym(normKey(k)) !== null) {
        delete args[k];
      }
    }
  }

  const referenceMissing =
    args.reference === undefined ||
    args.reference === null ||
    (typeof args.reference === "string" && args.reference.trim() === "");

  // ── Class C: decomposed reference assembly (Bible tools only) ─────────────
  if (
    REFERENCE_TOOLS.has(toolName) &&
    !OBS_REFERENCE_TOOLS.has(toolName) &&
    referenceMissing
  ) {
    let bookVal: string | undefined;
    let bookKey: string | undefined;
    let chapterVal: string | undefined;
    let chapterKey: string | undefined;
    let verseVal: string | undefined;
    let verseKey: string | undefined;
    let endVerseVal: string | undefined;
    let endVerseKey: string | undefined;

    for (const k of Object.keys(args)) {
      const nk = normKey(k);
      if (isBookKey(nk) && !bookVal) {
        bookVal = String(args[k]);
        bookKey = k;
      } else if ((nk === "chapter" || nk === "chapternumber") && !chapterVal) {
        chapterVal = String(args[k]);
        chapterKey = k;
      } else if (
        (nk === "verse" ||
          nk === "versenumber" ||
          nk === "versestart" ||
          nk === "startverse") &&
        !verseVal
      ) {
        verseVal = String(args[k]);
        verseKey = k;
      } else if ((nk === "endverse" || nk === "verseend") && !endVerseVal) {
        endVerseVal = String(args[k]);
        endVerseKey = k;
      }
    }

    if (bookVal && chapterVal) {
      let ref = `${bookVal} ${chapterVal}`;
      if (verseVal) {
        ref += `:${verseVal}`;
        if (endVerseVal) ref += `-${endVerseVal}`;
      }
      args.reference = ref;
      // Remove the decomposed keys to avoid Zod failures.
      if (bookKey) delete args[bookKey];
      if (chapterKey) delete args[chapterKey];
      if (verseKey) delete args[verseKey];
      if (endVerseKey) delete args[endVerseKey];
    }
  }

  // ── Class O: OBS story + frame → reference ────────────────────────────────
  if (OBS_REFERENCE_TOOLS.has(toolName) && referenceMissing) {
    assembleObsReference(args);
  }

  return args;
}
