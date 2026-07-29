/**
 * Book / chapter context → resources panel.
 *
 * Path B (bare book) and chapter orientation load get_passage_context notes and
 * must emit a `passage_context` UI component so the side panel — not chat —
 * holds the intro text. Coach copy stays short and panel-first.
 */

import type { PanelAction } from "./panelActions.js";
import {
  inferPassageContextScope,
  type PassageContextComponent,
  type UIComponent,
} from "./uiComponents.js";

export type ContextNoteLike = {
  scope?: string;
  note?: string;
  noteText?: string;
  body?: string;
  text?: string;
  title?: string;
  id?: string;
  chapter?: string;
};

export function extractContextNoteText(n: ContextNoteLike): string {
  const raw = String(n.note ?? n.noteText ?? n.body ?? n.text ?? "").trim();
  return raw.replace(/\\n/g, "\n").replace(/<br\s*\/?>/gi, "\n");
}

/** True when the reference is book + chapter with no verse (e.g. "TIT 1"). */
export function isWholeChapterReference(reference: string): boolean {
  return inferPassageContextScope(reference) === "chapter";
}

/**
 * Build a `passage_context` UI component from intro notes.
 * Returns null when there is nothing for the panel to show.
 */
export function buildBookContextPanelComponent(
  reference: string,
  notes: ContextNoteLike[],
  availability?: PassageContextComponent["availability"],
): Extract<UIComponent, { type: "passage_context" }> | null {
  const mapped = notes
    .map((n, index) => {
      const noteText = extractContextNoteText(n);
      if (!noteText) return null;
      const scope: "book" | "chapter" =
        n.scope === "book" || String(n.chapter ?? "") === "front"
          ? "book"
          : "chapter";
      return {
        id: (typeof n.id === "string" && n.id.trim()
          ? n.id
          : `intro-${scope}-${index}`
        ).trim(),
        scope,
        ...(n.title?.trim() ? { title: n.title.trim() } : {}),
        noteText,
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);

  if (mapped.length === 0) return null;

  return {
    type: "passage_context",
    reference: reference.trim() || "passage",
    scope: inferPassageContextScope(reference),
    notes: mapped,
    ...(availability && availability.length > 0 ? { availability } : {}),
  };
}

/** Prefer a chapter-scope note id for scroll/highlight; else first note. */
export function preferredContextNoteId(
  notes: Array<{ id?: string; scope?: string }>,
): string | undefined {
  const chapter = notes.find(
    (n) => n.scope === "chapter" && typeof n.id === "string" && n.id.trim(),
  );
  if (chapter?.id) return chapter.id.trim();
  const any = notes.find((n) => typeof n.id === "string" && n.id.trim());
  return any?.id?.trim();
}

/**
 * Imperative panel actions for book/chapter orientation:
 * open panel + focus Context tab (+ optional scroll to a note).
 */
export function panelFocusActionsForContext(opts?: {
  scrollToNoteId?: string;
}): PanelAction[] {
  const actions: PanelAction[] = [
    { type: "panel.open" },
    { type: "panel.focus_tab", tab: "context" },
  ];
  if (opts?.scrollToNoteId?.trim()) {
    actions.push({
      type: "panel.scroll_to",
      kind: "note",
      id: opts.scrollToNoteId.trim().slice(0, 160),
    });
  }
  return actions;
}

/**
 * Coach system-prompt guidance for book orientation.
 * When notes are in the panel, forbid dumping / paraphrasing the intro in chat.
 */
export function bookOrientationCoachGuidance(opts: {
  hasPanelNotes: boolean;
  notesError?: string;
  sourceLanguage?: string;
  studyLanguage: string;
}): string {
  if (opts.notesError) {
    return (
      `Translation resources could not be reached right now (${opts.notesError}). ` +
      `Tell the user resources are temporarily unreachable — do NOT present this as ` +
      `"this book has no notes" and do NOT invent book background.`
    );
  }

  if (!opts.hasPanelNotes) {
    return (
      `No intro notes were available for the panel — do not invent book background; ` +
      `still explain the study workflow briefly.`
    );
  }

  const langHint =
    opts.sourceLanguage &&
    opts.sourceLanguage.trim().toLowerCase() !==
      opts.studyLanguage.trim().toLowerCase() &&
    opts.sourceLanguage.trim().toLowerCase() === "en"
      ? ` (notes may be in English — the user can still read them in the panel)`
      : "";

  return (
    `The book's context notes are already loaded in the translation helps panel ` +
    `beside the chat${langHint}. Do NOT paste, quote, or paraphrase the intro notes ` +
    `in chat (no author/outline/background dump). In 2 short sentences: (1) tell them ` +
    `to read the context in that panel and ask any questions, (2) end with ONE clear ` +
    `next-step question (stay with book context, start chapter 1, or what feels hard).`
  );
}

/**
 * Coach system-prompt guidance for whole-chapter orientation.
 * Panel holds chapter intro + scripture; chat must not dump either.
 */
export function chapterOrientationCoachGuidance(opts: {
  hasPanelNotes: boolean;
  hasScripture: boolean;
  notesError?: string;
  sourceLanguage?: string;
  studyLanguage: string;
}): string {
  if (opts.notesError) {
    return (
      `Translation resources could not be reached right now (${opts.notesError}). ` +
      `Tell the user resources are temporarily unreachable — do NOT present this as ` +
      `"this chapter has no notes" and do NOT invent chapter background.` +
      (opts.hasScripture
        ? ` Scripture text is in the scripture section — they may still read that.`
        : "")
    );
  }

  if (!opts.hasPanelNotes) {
    return (
      `No chapter intro notes were available for the panel — do not invent chapter background. ` +
      (opts.hasScripture
        ? `Scripture is loaded in the scripture section — invite them to read it and ask ONE next-step question.`
        : `Still explain the study workflow briefly and ask ONE next-step question.`)
    );
  }

  const langHint =
    opts.sourceLanguage &&
    opts.sourceLanguage.trim().toLowerCase() !==
      opts.studyLanguage.trim().toLowerCase() &&
    opts.sourceLanguage.trim().toLowerCase() === "en"
      ? ` (notes may be in English — the user can still read them in the panel)`
      : "";

  return (
    `The chapter introduction is already loaded in the Context tab of the translation ` +
    `helps panel beside the chat${langHint}` +
    (opts.hasScripture
      ? `, and the chapter scripture text is in the Scripture section`
      : "") +
    `. Do NOT paste, quote, or paraphrase the intro notes or the scripture text in chat ` +
    `(no outline/background/structure dump). In 2 short sentences: (1) invite them to read ` +
    `the chapter introduction in the Context tab` +
    (opts.hasScripture ? ` and the scripture in the Scripture section` : "") +
    `, (2) end with ONE clear next-step question (what stands out, which section to start, or what feels hard).`
  );
}

/**
 * Goal-only intent for formulateCoachReply on whole-chapter orientation.
 * No canned production Spanish/English coach sentences.
 */
export function chapterOrientationCoachIntent(opts: {
  reference: string;
  hasPanelNotes: boolean;
  hasScripture: boolean;
  notesError?: string;
  sourceLanguage?: string;
}): string {
  const ref = opts.reference.trim() || "this chapter";
  if (opts.notesError) {
    return (
      `Goal: Briefly tell the user resources for ${ref} are temporarily unreachable ` +
      `(do not invent chapter background; do not claim the chapter has no notes).\n` +
      (opts.hasScripture
        ? `They may still read the scripture already shown in the Scripture section.\n`
        : "") +
      `Shape: 2 short sentences + ONE next-step question.\n` +
      `Invent fresh wording — do not echo a fixed template.`
    );
  }
  if (!opts.hasPanelNotes) {
    return (
      `Goal: Orient the user to study ${ref} without inventing chapter intro content.\n` +
      (opts.hasScripture
        ? `Invite them to read the scripture in the Scripture section of the resources panel.\n`
        : "") +
      `Shape: 2 short sentences + ONE next-step question.\n` +
      `Invent fresh wording — do not echo a fixed template.`
    );
  }
  const langNote =
    opts.sourceLanguage?.trim().toLowerCase() === "en"
      ? ` Notes may be in English; that is fine — they can still read them in the panel.`
      : "";
  return (
    `Goal: Panel-first chapter orientation for ${ref}.${langNote}\n` +
    `Include: Invite reading the chapter introduction in the Context tab` +
    (opts.hasScripture
      ? ` AND the scripture text in the Scripture section`
      : "") +
    ` of the resources panel beside chat.\n` +
    `Constraints: Do NOT paste, quote, paraphrase, or summarize the intro notes or scripture in chat. ` +
    `No outline, structure map, background dump, or checklist this turn.\n` +
    `Shape: Exactly 2 short sentences, then ONE clear next-step question ` +
    `(what stands out / which section to start / what feels hard).\n` +
    `Invent fresh wording — do not echo a fixed template.`
  );
}

/** LLM-failure only — not production coach copy. */
export const EMERGENCY_FALLBACK_CHAPTER_ORIENTATION =
  "[offline] Chapter intro and scripture are in the resources panel — read those first, then say what's hard.";
