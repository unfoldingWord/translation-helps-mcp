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
 */

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

/** Tools whose Zod schemas require a `path` parameter. */
const PATH_TOOLS = new Set([
  "get_academy_article",
  "get_word_article",
  // OBS tools
  "get_obs_notes",
  "get_obs_questions",
]);

/** Tools whose Zod schemas require a `reference` parameter. */
const REFERENCE_TOOLS = new Set([
  "get_passage",
  "get_passage_context",
  "get_passage_index",
  "get_note",
  "get_questions",
  "get_obs_story",
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

  // ── Class C: decomposed reference assembly ─────────────────────────────────
  if (
    REFERENCE_TOOLS.has(toolName) &&
    (args.reference === undefined ||
      args.reference === null ||
      args.reference === "")
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

  return args;
}
