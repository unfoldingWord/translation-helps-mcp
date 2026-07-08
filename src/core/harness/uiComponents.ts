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
    };
