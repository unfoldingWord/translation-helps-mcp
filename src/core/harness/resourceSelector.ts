/**
 * Resource selector — maps an intent to an ordered resource plan.
 *
 * Per the retrieval policy:
 *   - passage_overview    → get_passage + get_passage_context + get_note + get_passage_index
 *   - annotated_passage   → get_passage + get_passage_context + get_note + get_passage_index
 *   - passage_help        → get_passage + get_passage_context + get_note + get_passage_index + rc expansion
 *   - phrase_drill        → no initial fetches (challenge from history); articles fetched at runtime
 *   - word_study          → get_word_article by path/term
 *   - methodology         → get_academy_article by topic slug
 *   - checking            → get_passage + get_questions
 *   - discovery           → list_languages / list_resources
 *   - open_ended          → defer to agentic loop
 *
 * Scripture text comes from get_passage (all versions in one cheap call).
 * get_passage_context (book/chapter intros + availability) is an initial fetch
 * for overview / annotated / help intents and emitted as a `passage_context`
 * UI component (retained in the panel across verse-range drills).
 */

import type { IntentType, IntentResult } from "./intent.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolCallSpec =
  | { tool: "get_passage"; params: { reference: string; language: string } }
  | {
      tool: "get_passage_context";
      params: { reference: string; language: string };
    }
  | {
      tool: "get_note";
      params: { reference: string; language: string; id?: string };
    }
  | {
      tool: "get_passage_index";
      params: { reference: string; language: string; skipNotes?: boolean };
    }
  | { tool: "get_word_article"; params: { path: string; language: string } }
  | { tool: "get_academy_article"; params: { path: string; language: string } }
  | { tool: "get_questions"; params: { reference: string; language: string } }
  | {
      tool: "search_articles";
      params: {
        query: string;
        language: string;
        resourceTypes?: string[];
        topK?: number;
      };
    }
  | { tool: "list_languages"; params: { filter?: string } }
  | { tool: "list_resources"; params: { language: string } };

export type ToolName = ToolCallSpec["tool"];

export interface ResourcePlan {
  /** Ordered tool calls to execute in parallel where possible. */
  initialFetches: ToolCallSpec[];
  /**
   * Whether to run rc-link expansion after initial fetches:
   *   - "tn_to_ta": expand TN supportReferences → get_academy_article calls
   *   - "twl_to_tw": expand TWL paths → get_word_article calls
   */
  rcExpansion: Array<"tn_to_ta" | "twl_to_tw">;
  /**
   * When set, the harness will call search_articles to locate relevant
   * TA/TW articles by concept when no direct path is available.
   */
  articleLocate?: { query: string; resourceType?: string };
  /** Intent this plan was derived from */
  intent: IntentType;
  /**
   * Set by the harness when articleLocate fell back to English catalog search
   * because the study language had no hits (e.g. TW missing for es-419).
   */
  twEnFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

/**
 * Build a ResourcePlan from a classified intent.
 *
 * Scripture text is fetched via get_passage (all versions in one call).
 * Book/chapter orientation uses get_passage_context when the intent is
 * passage-scoped.
 */
/** True when `term` is already a TW dict path, not a surface-language word. */
function isTwArticlePath(term: string): boolean {
  const t = term.trim().toLowerCase();
  return t.includes("/") || /^(bible\/)?(kt|names|other)\//.test(t);
}

export function selectResources(
  intentResult: IntentResult,
  language: string,
): ResourcePlan {
  const { intent, reference, term, taTopic } = intentResult;

  switch (intent) {
    case "passage_overview": {
      if (!reference) return openEndedPlan(intent);
      return {
        intent,
        initialFetches: [
          { tool: "get_passage", params: { reference, language } },
          { tool: "get_passage_context", params: { reference, language } },
          { tool: "get_note", params: { reference, language } },
          // skipNotes: get_note already hits /notes; only need word-links here
          {
            tool: "get_passage_index",
            params: { reference, language, skipNotes: true },
          },
        ],
        rcExpansion: ["tn_to_ta", "twl_to_tw"],
      };
    }

    case "annotated_passage": {
      if (!reference) return openEndedPlan(intent);
      return {
        intent,
        initialFetches: [
          { tool: "get_passage", params: { reference, language } },
          { tool: "get_passage_context", params: { reference, language } },
          { tool: "get_note", params: { reference, language } },
          // Words only — note bodies come from get_note (one /notes fetch)
          {
            tool: "get_passage_index",
            params: { reference, language, skipNotes: true },
          },
        ],
        rcExpansion: [],
      };
    }

    case "phrase_drill": {
      return { intent, initialFetches: [], rcExpansion: [] };
    }

    case "passage_help": {
      if (!reference) return openEndedPlan(intent);
      return {
        intent,
        initialFetches: [
          { tool: "get_passage", params: { reference, language } },
          { tool: "get_passage_context", params: { reference, language } },
          { tool: "get_note", params: { reference, language } },
          {
            tool: "get_passage_index",
            params: { reference, language, skipNotes: true },
          },
        ],
        rcExpansion: ["tn_to_ta", "twl_to_tw"],
      };
    }

    case "word_study": {
      // Only treat as a direct TW path when it looks like one (e.g. "bible/kt/grace").
      // Bare terms ("siervo", "grace") must go through search_articles first —
      // get_word_article rejects non-path slugs and would silently miss the article.
      if (term && isTwArticlePath(term)) {
        return {
          intent,
          initialFetches: [
            { tool: "get_word_article", params: { path: term, language } },
          ],
          rcExpansion: [],
        };
      }
      return {
        intent,
        articleLocate: {
          query: term ?? intentResult.term ?? "biblical term",
          resourceType: "tw",
        },
        initialFetches: [],
        rcExpansion: [],
      };
    }

    case "methodology": {
      if (taTopic) {
        return {
          intent,
          initialFetches: [
            {
              tool: "get_academy_article",
              params: { path: taTopic, language },
            },
          ],
          rcExpansion: [],
        };
      }
      return {
        intent,
        articleLocate: {
          query: intentResult.taTopic ?? "translation methodology",
          resourceType: "ta",
        },
        initialFetches: [],
        rcExpansion: [],
      };
    }

    case "checking": {
      // Draft-check coaching needs TN/TW context + TQ — not questions alone.
      if (reference) {
        return {
          intent,
          initialFetches: [
            { tool: "get_passage", params: { reference, language } },
            { tool: "get_note", params: { reference, language } },
            {
              tool: "get_passage_index",
              params: { reference, language, skipNotes: true },
            },
            { tool: "get_questions", params: { reference, language } },
          ],
          rcExpansion: [],
        };
      }
      return openEndedPlan(intent);
    }

    case "discovery": {
      return {
        intent,
        initialFetches: [{ tool: "list_resources", params: { language } }],
        rcExpansion: [],
      };
    }

    case "checklist_step":
    case "quiz_answer":
    case "quiz_skip":
      return { intent, initialFetches: [], rcExpansion: [] };

    default:
      return openEndedPlan(intent);
  }
}

function openEndedPlan(intent: IntentType): ResourcePlan {
  return { intent, initialFetches: [], rcExpansion: [] };
}
