/**
 * Resource selector — maps an intent to an ordered resource plan.
 *
 * Per the retrieval policy:
 *   - passage_overview    → get_passage + get_note + get_passage_index
 *   - annotated_passage   → get_passage + get_note + get_passage_index
 *   - passage_help        → get_passage + get_note + get_passage_index + rc-link expansion
 *   - phrase_drill        → no initial fetches (challenge from history); articles fetched at runtime
 *   - word_study          → get_word_article by path/term
 *   - methodology         → get_academy_article by topic slug
 *   - checking            → get_passage + get_questions
 *   - discovery           → list_languages / list_resources_for_language
 *   - open_ended          → defer to agentic loop
 *
 * Scripture text comes from get_passage (all versions in one cheap call).
 * get_passage_context (book/chapter intros + availability) is called in the
 * annotated_passage branch in parallel with the LLM annotator, after the
 * get_passage cache-warm call, and surfaced as a collapsible context block.
 */

import type { IntentType, IntentResult } from "./intent.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolCallSpec =
  // New workflow tools (primary MCP surface)
  | { tool: "get_passage"; params: { reference: string; language: string } }
  | { tool: "get_passage_context"; params: { reference: string; language: string } }
  | { tool: "get_note"; params: { reference: string; language: string; id?: string } }
  | { tool: "get_passage_index"; params: { reference: string; language: string } }
  | { tool: "get_word_article"; params: { path: string; language: string } }
  | { tool: "get_academy_article"; params: { path: string; language: string } }
  | { tool: "get_questions"; params: { reference: string; language: string } }
  | { tool: "search_articles"; params: { query: string; language: string; resourceTypes?: string[]; topK?: number } }
  | { tool: "list_languages"; params: { filter?: string } }
  // Legacy tools (kept for discovery compat)
  | { tool: "list_resources_for_language"; params: { language: string; subject?: string } };

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
}

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

/**
 * Build a ResourcePlan from a classified intent.
 *
 * Scripture is fetched via get_passage_context which dynamically returns all
 * available versions for the language in a single call — no per-version specs.
 */
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
          { tool: "get_note", params: { reference, language } },
          { tool: "get_passage_index", params: { reference, language } },
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
          { tool: "get_note", params: { reference, language } },
          { tool: "get_passage_index", params: { reference, language } },
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
          { tool: "get_note", params: { reference, language } },
          { tool: "get_passage_index", params: { reference, language } },
        ],
        rcExpansion: ["tn_to_ta", "twl_to_tw"],
      };
    }

    case "word_study": {
      if (term) {
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
        articleLocate: { query: intentResult.term ?? "biblical term", resourceType: "tw" },
        initialFetches: [],
        rcExpansion: [],
      };
    }

    case "methodology": {
      if (taTopic) {
        return {
          intent,
          initialFetches: [
            { tool: "get_academy_article", params: { path: taTopic, language } },
          ],
          rcExpansion: [],
        };
      }
      return {
        intent,
        articleLocate: { query: intentResult.taTopic ?? "translation methodology", resourceType: "ta" },
        initialFetches: [],
        rcExpansion: [],
      };
    }

    case "checking": {
      if (reference) {
        return {
          intent,
          initialFetches: [
            { tool: "get_passage", params: { reference, language } },
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
        initialFetches: [
          { tool: "list_resources_for_language", params: { language } },
        ],
        rcExpansion: [],
      };
    }

    case "checklist_step":
      return { intent, initialFetches: [], rcExpansion: [] };

    default:
      return openEndedPlan(intent);
  }
}

function openEndedPlan(intent: IntentType): ResourcePlan {
  return { intent, initialFetches: [], rcExpansion: [] };
}
