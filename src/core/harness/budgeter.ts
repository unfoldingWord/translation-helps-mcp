/**
 * Context budgeter — enforces per-resource-type caps on assembled bundles.
 *
 * Prevents context bloat ("lost in the middle" degradation) by:
 *   1. Capping TN notes, TW entries, TA articles, TQ questions.
 *   2. Dropping low-signal rows (empty notes, duplicate ids).
 *   3. Trimming long article text to a max character budget.
 *
 * Caps (defaults, overridable):
 *   notes:    12  (verse-level translation notes)
 *   tw:        6  (translation word entries per verse)
 *   ta:        4  (translation academy articles)
 *   tq:        8  (comprehension questions)
 *   articleMaxChars: 1200 per TA/TW article (enough for key strategies)
 */

import type { Bundle } from "../rag/BundleCache.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single fetched scripture text (ULT, UST, GLT, GST, …). */
export interface ScriptureText {
  /** Abbreviation identifying the translation (e.g. "ult", "ust", "glt"). */
  resourceType: string;
  /** Human-readable label shown in prompts (e.g. "ULT — Literal Text"). */
  label: string;
  text: string;
  format: "usfm" | "plain";
}

/** Enriched bundle used by the harness (adds optional article content + multiple scriptures). */
export interface EnrichedBundle extends Bundle {
  /**
   * All fetched scripture translations for this reference (ULT, UST, etc.).
   * The legacy `scripture` field is kept for backward-compat and holds the
   * first available text.
   */
  scriptures: ScriptureText[];
  /** Override base Bundle.notes to include phrase-annotation fields. */
  notes: Array<{
    id: string;
    text: string;
    /** Original-language phrase this note is about (from TN `quote` field). */
    quote?: string;
    /** Verse number string, e.g. "3". */
    verse?: string;
    externalReference?: { path: string };
    supportReference?: string;
  }>;
  tw: Array<{
    id: string;
    title: string;
    path: string;
    article?: string;
    /** Original-language words this TW entry is about (from TWL `origWords`). */
    origWords?: string;
    wordPath?: string;
    /** Verse number string, e.g. "3". */
    verse?: string;
  }>;
  ta: Array<{
    id: string;
    title: string;
    path: string;
    article?: string;
  }>;
  tq?: Array<{
    id: string;
    question: string;
    response?: string;
    verse: string;
  }>;
  /**
   * Optional warning surfaced to the user when resources are degraded
   * (e.g. only original-language text available, no translation found).
   */
  dataWarning?: string;
}

export interface BudgetCaps {
  notes?: number;
  tw?: number;
  ta?: number;
  tq?: number;
  articleMaxChars?: number;
}

const DEFAULT_CAPS: Required<BudgetCaps> = {
  notes: 12,
  tw: 6,
  ta: 4,
  tq: 8,
  articleMaxChars: 1200,
};

// ---------------------------------------------------------------------------
// Budget function
// ---------------------------------------------------------------------------

/**
 * Apply budget caps to an EnrichedBundle, returning a trimmed copy.
 */
export function applyBudget(
  bundle: EnrichedBundle,
  caps: BudgetCaps = {},
): EnrichedBundle {
  const c = { ...DEFAULT_CAPS, ...caps };

  // Notes: dedupe by id, cap, drop empty
  const seenNoteIds = new Set<string>();
  const notes = bundle.notes
    .filter((n) => {
      if (!n.text?.trim()) return false;
      if (seenNoteIds.has(n.id)) return false;
      seenNoteIds.add(n.id);
      return true;
    })
    .slice(0, c.notes);

  // TW: dedupe by path, cap, trim article
  const seenTwPaths = new Set<string>();
  const tw = bundle.tw
    .filter((t) => {
      if (seenTwPaths.has(t.path)) return false;
      seenTwPaths.add(t.path);
      return true;
    })
    .slice(0, c.tw)
    .map((t) => ({
      ...t,
      article: t.article ? trimText(t.article, c.articleMaxChars) : undefined,
    }));

  // TA: dedupe by path, cap, trim article
  const seenTaPaths = new Set<string>();
  const ta = bundle.ta
    .filter((a) => {
      if (seenTaPaths.has(a.path)) return false;
      seenTaPaths.add(a.path);
      return true;
    })
    .slice(0, c.ta)
    .map((a) => ({
      ...a,
      article: a.article ? trimText(a.article, c.articleMaxChars) : undefined,
    }));

  // TQ: cap
  const tq = bundle.tq?.slice(0, c.tq);

  return {
    ...bundle,
    scriptures: bundle.scriptures ?? [],
    notes,
    tw,
    ta,
    tq,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // Try to trim at a sentence boundary
  const trimmed = text.slice(0, maxChars);
  const lastPeriod = trimmed.lastIndexOf(". ");
  return lastPeriod > maxChars * 0.7
    ? trimmed.slice(0, lastPeriod + 1) + " …"
    : trimmed + " …";
}
