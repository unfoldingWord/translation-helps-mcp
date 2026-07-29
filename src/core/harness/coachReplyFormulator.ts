/**
 * coachReplyFormulator — LLM-formulate short coach chat replies from English
 * intent instructions, with named sync emergency fallbacks on failure.
 *
 * Hidden HTML markers (QUIZ / READY / CHECKLIST / …) are NEVER generated here;
 * callers append them programmatically after the visible text.
 *
 * Intent prompts describe communicative GOALS only — never paste polished
 * Spanish/English coach sentences the model would echo.
 */

import type { LLMProvider } from "../rag/providers/LLMProvider.js";
import {
  EMERGENCY_FALLBACK_CHAPTER_ORIENTATION,
  chapterOrientationCoachIntent,
} from "./bookContextPanel.js";
import type { ReadinessLevel } from "./contextReadiness.js";

const FORMULATOR_SYSTEM = `You are Ezer, a Bible translation consultant coach in a study chat UI.
Write ONLY the user-visible chat reply described in the Intent.
Rules:
- Reply in the source/conversation language given by the BCP-47 Language code.
- Natural, warm, concise prose. No markdown headings. No HTML comments or hidden markers.
- Do not invent scripture facts. Do not grade receptor-language surface form.
- Never ask "How did you translate X?" — invite drafts in Mi traducción / My translation, or ask what's hard.
- Follow the Intent for communicative goal, tone, and approximate length — invent your own wording; do not reuse stock phrases.
- Output the reply text only — no preamble, no labels like "Reply:".`;

/**
 * Formulate a short coach reply from an English intent + language.
 * Returns `fallback` when the LLM fails or returns empty/marker-only text.
 */
export async function formulateCoachReply(
  llm: LLMProvider,
  opts: {
    language: string;
    /** English description of the communicative goal. */
    intent: string;
    fallback: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<string> {
  try {
    const text = await llm.generate(
      [
        { role: "system", content: FORMULATOR_SYSTEM },
        {
          role: "user",
          content:
            `Language: ${opts.language}\n\n` +
            `Intent:\n${opts.intent}\n\n` +
            `Write the reply now.`,
        },
      ],
      {
        maxTokens: opts.maxTokens ?? 140,
        temperature: opts.temperature ?? 0.5,
      },
    );
    const visible = (text ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
    return visible.length > 0 ? visible : opts.fallback;
  } catch {
    return opts.fallback;
  }
}

// ---------------------------------------------------------------------------
// Emergency fallbacks (English, short, clearly non-production coach voice)
// ---------------------------------------------------------------------------

/** LLM-failure only — not production coach copy. */
export function EMERGENCY_FALLBACK_READINESS_GATE(
  level: ReadinessLevel,
): string {
  return level === "book"
    ? "[offline] Optional book-context quiz before continuing?"
    : "[offline] Optional chapter-context quiz before continuing?";
}

/** LLM-failure only — not production coach copy. */
export const EMERGENCY_FALLBACK_QUIZ_PANEL_REFERRAL =
  "[offline] Context quiz is in the resources panel. Submit when done, or say if you prefer chat / skip.";

/** LLM-failure only — not production coach copy. */
export function EMERGENCY_FALLBACK_QUIZ_OFFER_FOOTER(total: number): string {
  return `*(Optional)* Short context check (~${total} Qs), or continue with the note / My translation.`;
}

/** LLM-failure only — not production coach copy. */
export const EMERGENCY_FALLBACK_QUIZ_PROGRESS_FOOTER =
  "*(Say so if you want to skip the quiz.)*";

/** LLM-failure only — not production coach copy. */
export const EMERGENCY_FALLBACK_QUIZ_COMPLETE =
  "[offline] Quiz done. Panel text is ready — what's hardest to translate, or draft in My translation?";

/** LLM-failure only — not production coach copy. */
export const EMERGENCY_FALLBACK_QUIZ_SKIPPED =
  "[offline] Skipping quiz. Panel notes/text ready — what don't you know how to translate yet?";

/** LLM-failure only — not production coach copy. */
export const EMERGENCY_FALLBACK_STALE_QUIZ =
  "[offline] That quiz is inactive. Want a new one?";

// ---------------------------------------------------------------------------
// Intent prompts (English communicative goals — no canned reply sentences)
// ---------------------------------------------------------------------------

export function readinessGateQuestionIntent(level: ReadinessLevel): string {
  const scope =
    level === "book" ? "book-level background" : "chapter-level background";
  return (
    `Goal: Softly offer an optional short context quiz about ${scope} before the translator advances.\n` +
    `Shape: Exactly one friendly yes/no question. 1–2 sentences max.\n` +
    `Constraints: Optional tone (they may decline). Do not start the quiz. ` +
    `Do not mention readiness systems, gates, markers, or technical internals. ` +
    `Invent fresh wording in the reply language — do not echo a fixed template.`
  );
}

export function quizPanelReferralIntent(): string {
  return (
    `Goal: Point the user to a short context quiz already waiting in the resources panel (not in chat).\n` +
    `Include: They may answer at their pace and submit when finished; they may also skip, or take it in chat instead, by saying so.\n` +
    `Shape: 2–4 short sentences. At most one soft invitation at the end — no question pile-up.\n` +
    `Invent fresh wording in the reply language — do not echo a fixed template.`
  );
}

export function quizOfferFooterIntent(total: number): string {
  return (
    `Goal: Secondary, clearly optional CTA for a brief context check (~${total} questions) before translating.\n` +
    `Include: Declining is fine — they can stay with the note or draft in Mi traducción / My translation.\n` +
    `Shape: 1–2 sentences; italic/parenthetical tone is fine. Never the main ask of the turn.\n` +
    `Invent fresh wording in the reply language — do not echo a fixed template.`
  );
}

export function quizProgressFooterIntent(): string {
  return (
    `Goal: Tiny soft opt-out hint on quiz question 1 only.\n` +
    `Shape: One short parenthetical/italic line that they can skip the quiz by saying so. Nothing else.\n` +
    `Invent fresh wording in the reply language — do not echo a fixed template.`
  );
}

export function quizCompleteMessageIntent(): string {
  return (
    `Goal: Brief affirmation after a successful context quiz; orient them to the passage text in the resources panel.\n` +
    `Close: Exactly one question — either what is hardest to translate, or invite a draft in Mi traducción / My translation.\n` +
    `Shape: 2–3 short sentences.\n` +
    `Invent fresh wording in the reply language — do not echo a fixed template.`
  );
}

export function quizSkippedMessageIntent(): string {
  return (
    `Goal: Briefly acknowledge opting out of the context quiz; note that notes/text are ready in the resources panel.\n` +
    `Close: Exactly one question about what they still don't know how to translate.\n` +
    `Shape: 2–3 short sentences.\n` +
    `Invent fresh wording in the reply language — do not echo a fixed template.`
  );
}

export function staleQuizNoticeIntent(): string {
  return (
    `Goal: Gently explain the submitted quiz session is no longer active, and ask whether to prepare a new one.\n` +
    `Shape: 1–2 short sentences.\n` +
    `Invent fresh wording in the reply language — do not echo a fixed template.`
  );
}

// ---------------------------------------------------------------------------
// Typed formulators
// ---------------------------------------------------------------------------

export async function formulateReadinessGateQuestion(
  level: ReadinessLevel,
  language: string,
  llm: LLMProvider,
): Promise<string> {
  return formulateCoachReply(llm, {
    language,
    intent: readinessGateQuestionIntent(level),
    fallback: EMERGENCY_FALLBACK_READINESS_GATE(level),
    maxTokens: 100,
  });
}

export async function formulateQuizPanelReferral(
  language: string,
  llm: LLMProvider,
): Promise<string> {
  return formulateCoachReply(llm, {
    language,
    intent: quizPanelReferralIntent(),
    fallback: EMERGENCY_FALLBACK_QUIZ_PANEL_REFERRAL,
    maxTokens: 160,
  });
}

export async function formulateQuizOfferFooter(
  language: string,
  total: number,
  llm: LLMProvider,
): Promise<string> {
  return formulateCoachReply(llm, {
    language,
    intent: quizOfferFooterIntent(total),
    fallback: EMERGENCY_FALLBACK_QUIZ_OFFER_FOOTER(total),
    maxTokens: 100,
  });
}

export async function formulateQuizProgressFooter(
  language: string,
  askedIndex: number,
  total: number,
  llm: LLMProvider,
): Promise<string> {
  if (askedIndex !== 1) return "";
  void total;
  return formulateCoachReply(llm, {
    language,
    intent: quizProgressFooterIntent(),
    fallback: EMERGENCY_FALLBACK_QUIZ_PROGRESS_FOOTER,
    maxTokens: 60,
  });
}

export async function formulateQuizCompleteMessage(
  language: string,
  llm: LLMProvider,
): Promise<string> {
  return formulateCoachReply(llm, {
    language,
    intent: quizCompleteMessageIntent(),
    fallback: EMERGENCY_FALLBACK_QUIZ_COMPLETE,
    maxTokens: 120,
  });
}

export async function formulateQuizSkippedMessage(
  language: string,
  llm: LLMProvider,
): Promise<string> {
  return formulateCoachReply(llm, {
    language,
    intent: quizSkippedMessageIntent(),
    fallback: EMERGENCY_FALLBACK_QUIZ_SKIPPED,
    maxTokens: 120,
  });
}

export async function formulateStaleQuizNotice(
  language: string,
  llm: LLMProvider,
): Promise<string> {
  return formulateCoachReply(llm, {
    language,
    intent: staleQuizNoticeIntent(),
    fallback: EMERGENCY_FALLBACK_STALE_QUIZ,
    maxTokens: 80,
  });
}

/** Panel-first whole-chapter orientation (Context tab + Scripture section). */
export async function formulateChapterOrientationReply(
  language: string,
  llm: LLMProvider,
  opts: {
    reference: string;
    hasPanelNotes: boolean;
    hasScripture: boolean;
    notesError?: string;
    sourceLanguage?: string;
  },
): Promise<string> {
  return formulateCoachReply(llm, {
    language,
    intent: chapterOrientationCoachIntent(opts),
    fallback: EMERGENCY_FALLBACK_CHAPTER_ORIENTATION,
    maxTokens: 160,
  });
}
