/**
 * UIComponent — typed component data the server can embed in SSE `ui` events.
 *
 * The frontend reads these events and renders rich interactive components
 * in place of (or alongside) the markdown text.
 *
 * Each variant carries exactly the data the corresponding Svelte component needs.
 */

import type { Challenge } from "./PassageAnnotator.js";

/**
 * A challenge entry as transmitted over the wire.
 * Re-uses the full Challenge type from PassageAnnotator.
 */
export type ChallengeEntry = Challenge;

export type UIComponent =
  | {
      type: "challenge_cards";
      challenges: ChallengeEntry[];
    }
  | {
      type: "scripture_panel";
      verses: { label: string; text: string }[];
      highlightPhrase?: string;
    }
  | {
      /** Richer scripture component for the workbench right panel. */
      type: "scripture_text";
      reference: string;
      versions: Array<{
        label: string;
        text: string;
        direction?: "ltr" | "rtl";
        resourceType?: string;
      }>;
      highlightPhrase?: string;
    }
  | {
      /** Structured translation notes from TN resources. */
      type: "translation_notes";
      reference: string;
      notes: Array<{
        id: string;
        quote?: string;
        /**
         * Alignment-resolved quote: `aligned` holds the gateway-language
         * (GLT/ULT) words matching the original quote; `original` is a
         * display copy of the Greek/Hebrew (`&` → `…`). Either may be absent.
         */
        gatewayQuote?: { original?: string; aligned?: string };
        noteText: string;
        supportReference?: string;
        /** e.g. "figs-metaphor", "grammar", "key-term" */
        category?: string;
        verse?: string;
      }>;
    }
  | {
      /** Translation word definitions from TW resources. */
      type: "translation_words";
      reference: string;
      words: Array<{
        id: string;
        term: string;
        /** Markdown excerpt of the TW article */
        definition?: string;
        verse?: string;
        /** Original-language words this entry covers */
        origWords?: string;
        /** Clean slug path, e.g. "bible/kt/grace" */
        wordPath?: string;
      }>;
    }
  | {
      /** Translation questions for checking comprehension. */
      type: "translation_questions";
      reference: string;
      questions: Array<{
        id: string;
        question: string;
        response?: string;
        verse?: string;
      }>;
    }
  | {
      type: "phrase_drill";
      challenge: ChallengeEntry;
      noteText: string;
      atSuggestion?: string;
    }
  | {
      type: "progress_tracker";
      total: number;
      explored: number[];
    }
  | {
      type: "ta_article_preview";
      reference: string;
      title: string;
      excerpt: string;
    }
  | {
      /** Full Translation Academy article loaded via get_academy_article. */
      type: "academy_article";
      /** Clean path, e.g. "translate/figs-exclusive" */
      path: string;
      title?: string;
      /** Full article markdown body */
      markdown: string;
      /** Language actually served (may be English after fallback) */
      language?: string;
    }
  | {
      /**
       * Book / chapter intro notes from get_passage_context.
       * Distinct from verse-scoped `translation_notes` so panel aggregation
       * can retain orientation while the user drills into a range.
       */
      type: "passage_context";
      /** Reference used for the fetch (book, chapter, or range). */
      reference: string;
      /** Granularity of the fetch that produced these notes. */
      scope: "book" | "chapter" | "range";
      notes: Array<{
        id: string;
        scope: "book" | "chapter";
        title?: string;
        noteText: string;
      }>;
      /** Optional resource-availability summary from get_passage_context. */
      availability?: Array<{
        type: string;
        abbreviation?: string;
        subject?: string;
        role?: string;
      }>;
    }
  | {
      /**
       * Interactive context quiz rendered in the resources panel.
       * Questions are multiple choice; the answer key stays server-side in
       * the hidden QUIZ history marker (grading happens on submit).
       */
      type: "context_quiz";
      /** Passage the quiz covers (book or chapter ref, e.g. "TIT" / "TIT 1"). */
      reference: string;
      /** Readiness scope a passing quiz marks (book vs chapter). */
      scope?: { level: "book" | "chapter"; book: string; chapter?: string };
      /** `active` = awaiting answers; `completed` = graded results shown. */
      status: "active" | "completed";
      questions: Array<{
        id: string;
        q: string;
        options: string[];
        /** Present on completed quizzes. */
        chosen?: string;
        correct?: boolean;
        expected?: string;
      }>;
      /** Present on completed quizzes. */
      correctCount?: number;
      passed?: boolean;
    };

/** Narrow helper for the context_quiz variant. */
export type ContextQuizComponent = Extract<
  UIComponent,
  { type: "context_quiz" }
>;

/** Narrow helper for the passage_context variant. */
export type PassageContextComponent = Extract<
  UIComponent,
  { type: "passage_context" }
>;

/** Infer fetch granularity from a scripture reference string. */
export function inferPassageContextScope(
  reference: string,
): PassageContextComponent["scope"] {
  const t = reference.trim();
  if (!t) return "book";
  // Verse or verse-range (e.g. "TIT 1:1", "TIT 1:1-4")
  if (/:\d/.test(t)) return "range";
  // Bare book code / name with no digits (e.g. "TIT", "Titus")
  if (!/\d/.test(t)) return "book";
  // Chapter-level (e.g. "TIT 1", "JHN 3")
  return "chapter";
}

/** USFM-ish book code from a reference ("TIT 1:1-4" → "TIT"). */
export function bookCodeFromReference(reference: string): string | null {
  const m = reference.trim().match(/^([1-3]?\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/);
  if (!m?.[1]) return null;
  return m[1].replace(/\s+/g, "").toUpperCase();
}

/**
 * Merge two passage_context components by note scope.
 * Newer notes win per scope (book / chapter); reference/scope follow `newer`.
 */
export function mergePassageContextComponents(
  older: PassageContextComponent | undefined,
  newer: PassageContextComponent | undefined,
): PassageContextComponent | undefined {
  if (!older) return newer;
  if (!newer) return older;
  const byScope = new Map<
    "book" | "chapter",
    PassageContextComponent["notes"][number]
  >();
  for (const n of older.notes) byScope.set(n.scope, n);
  for (const n of newer.notes) byScope.set(n.scope, n);
  const notes = [...byScope.values()].sort((a, b) =>
    a.scope === b.scope ? 0 : a.scope === "book" ? -1 : 1,
  );
  return {
    type: "passage_context",
    reference: newer.reference || older.reference,
    scope: newer.scope,
    notes,
    availability: newer.availability ?? older.availability,
  };
}

/**
 * Merge component lists chronologically — later entries win per type,
 * except `passage_context` which merges book/chapter notes so verse-range
 * TN/TW turns cannot wipe orientation context.
 */
export function mergeNewestWins(lists: UIComponent[][]): UIComponent[] {
  const byType = new Map<string, UIComponent>();
  for (const list of lists) {
    for (const c of list) {
      if (c.type === "passage_context") {
        const prev = byType.get("passage_context") as
          | PassageContextComponent
          | undefined;
        const merged = mergePassageContextComponents(prev, c);
        if (merged) byType.set("passage_context", merged);
        continue;
      }
      byType.set(c.type, c);
    }
  }
  return [...byType.values()];
}

/**
 * Build panel components for the latest passage block while retaining
 * book/chapter context from earlier same-book blocks (TIT → TIT 1 → TIT 1:1-4).
 */
export function retainContextForPanel(
  blockComponents: UIComponent[][],
  latest: UIComponent[],
): UIComponent[] {
  let retained: PassageContextComponent | undefined;
  for (const comps of blockComponents) {
    const ctx = comps.find((c) => c.type === "passage_context") as
      | PassageContextComponent
      | undefined;
    retained = mergePassageContextComponents(retained, ctx);
  }
  const latestCtx = latest.find((c) => c.type === "passage_context") as
    | PassageContextComponent
    | undefined;
  const mergedCtx = mergePassageContextComponents(retained, latestCtx);
  if (!mergedCtx || mergedCtx.notes.length === 0) return latest;

  const without = latest.filter((c) => c.type !== "passage_context");
  return [...without, mergedCtx];
}
