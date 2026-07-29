/**
 * quizPanel — interactive context quiz in the resources panel.
 *
 * The quiz is generated once (QuizAgents.generateQuiz, multiple-choice) and
 * rendered as a `context_quiz` UI component. The user answers at their own
 * pace and submits all answers in one structured chat message (visible
 * summary + hidden QUIZSUBMIT marker — same pattern as CHECKITEM clicks).
 * The server grades against the note-grounded answer key embedded in the
 * hidden <!-- QUIZ:idx/total [...] --> history marker.
 *
 * IMPORTANT: this module is imported by the browser bundle — keep it free of
 * value imports from intent.js / contextReadiness.js (they pull door43/fflate).
 */

import type { QuizItem } from "./intent.js";
import type { ContextQuizComponent } from "./uiComponents.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuizScopeLike {
  level: "book" | "chapter";
  book: string;
  chapter?: string;
}

export interface QuizSubmitPayload {
  /** Passage the quiz covers, e.g. "TIT" / "TIT 1". */
  reference: string;
  /** Chosen option per question (null = unanswered), index-aligned. */
  answers: (string | null)[];
}

export interface QuizGradeItem {
  q: string;
  expected: string;
  chosen: string | null;
  correct: boolean;
}

export interface QuizGradeSummary {
  results: QuizGradeItem[];
  correctCount: number;
  total: number;
  /** Majority-correct pass rule: strictly more than half. */
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Panel component builders
// ---------------------------------------------------------------------------

/**
 * Build the active `context_quiz` panel component from generated questions.
 * Only multiple-choice questions render in the panel; returns null when fewer
 * than 3 questions carry options (chat Path Q remains the only quiz surface).
 */
export function buildQuizPanelComponent(
  reference: string,
  questions: QuizItem[],
  scope?: QuizScopeLike | null,
): ContextQuizComponent | null {
  const mc = questions
    .map((item, i) => ({ item, i }))
    .filter(
      ({ item }) => Array.isArray(item.options) && item.options.length >= 3,
    );
  if (mc.length < 3) return null;

  return {
    type: "context_quiz",
    reference,
    ...(scope ? { scope: { ...scope } } : {}),
    status: "active",
    questions: mc.map(({ item, i }) => ({
      id: `q${i + 1}`,
      q: item.q,
      options: item.options!,
    })),
  };
}

/** Build the completed (graded) `context_quiz` panel component. */
export function buildQuizResultComponent(
  reference: string,
  questions: QuizItem[],
  grade: QuizGradeSummary,
  scope?: QuizScopeLike | null,
): ContextQuizComponent {
  return {
    type: "context_quiz",
    reference,
    ...(scope ? { scope: { ...scope } } : {}),
    status: "completed",
    questions: questions.map((item, i) => ({
      id: `q${i + 1}`,
      q: item.q,
      options: item.options ?? [],
      chosen: grade.results[i]?.chosen ?? undefined,
      correct: grade.results[i]?.correct ?? false,
      expected: item.a,
    })),
    correctCount: grade.correctCount,
    passed: grade.passed,
  };
}

// ---------------------------------------------------------------------------
// Submit message (hidden marker round-trip)
// ---------------------------------------------------------------------------

const QUIZSUBMIT_RE = /<!--\s*QUIZSUBMIT:(\{[\s\S]*?\})\s*-->/;

/** Hidden marker carrying the structured answers. */
export function buildQuizSubmitMarker(payload: QuizSubmitPayload): string {
  // An HTML-comment terminator inside option text would truncate the marker.
  const json = JSON.stringify(payload).replace(/-->/g, "\u2192");
  return `<!-- QUIZSUBMIT:${json} -->`;
}

/**
 * Build the chat user message for a panel quiz submission:
 * visible source-language summary + hidden QUIZSUBMIT marker
 * (draft-submit / CHECKITEM pattern).
 */
export function formatQuizSubmitMessage(opts: {
  payload: QuizSubmitPayload;
  /** Source / conversation language for the visible phrasing. */
  language?: string;
}): string {
  const es = (opts.language ?? "en").toLowerCase().startsWith("es");
  const lead = es
    ? `Mis respuestas del cuestionario (${opts.payload.reference}):`
    : `My quiz answers (${opts.payload.reference}):`;
  const lines = opts.payload.answers.map((a, i) => {
    const blank = es ? "(sin responder)" : "(unanswered)";
    return `${i + 1}. ${a?.trim() || blank}`;
  });
  return `${lead}\n${lines.join("\n")}\n${buildQuizSubmitMarker(opts.payload)}`;
}

/** Parse a QUIZSUBMIT marker from a user message (null when absent/invalid). */
export function parseQuizSubmitFromMessage(
  text: string | undefined | null,
): QuizSubmitPayload | null {
  if (!text) return null;
  const m = QUIZSUBMIT_RE.exec(text);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as Partial<QuizSubmitPayload>;
    if (
      typeof parsed.reference !== "string" ||
      !Array.isArray(parsed.answers)
    ) {
      return null;
    }
    const answers = parsed.answers.map((a) =>
      typeof a === "string" && a.trim() ? a : null,
    );
    if (answers.length === 0) return null;
    return { reference: parsed.reference.trim(), answers };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deterministic grading
// ---------------------------------------------------------------------------

function normalizeAnswer(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Grade a panel submission against the note-grounded answer key.
 * Multiple choice → exact (case/whitespace-insensitive) match with the
 * expected answer. Unanswered questions count as wrong.
 */
export function gradeQuizSubmission(
  questions: QuizItem[],
  answers: (string | null)[],
): QuizGradeSummary {
  const results: QuizGradeItem[] = questions.map((item, i) => {
    const chosen = answers[i] ?? null;
    const correct =
      chosen !== null && normalizeAnswer(chosen) === normalizeAnswer(item.a);
    return { q: item.q, expected: item.a, chosen, correct };
  });
  const correctCount = results.filter((r) => r.correct).length;
  const total = questions.length;
  return {
    results,
    correctCount,
    total,
    passed: total > 0 && correctCount * 2 > total,
  };
}

// ---------------------------------------------------------------------------
// Feedback fallback (used when the LLM feedback call fails)
// ---------------------------------------------------------------------------

/** Deterministic encouraging feedback — always states the right answer for misses. */
export function fallbackQuizResultFeedback(
  grade: QuizGradeSummary,
  language: string,
): string {
  const es = language.trim().toLowerCase().startsWith("es");
  const head = es
    ? `Respondiste bien ${grade.correctCount} de ${grade.total} preguntas.`
    : `You answered ${grade.correctCount} of ${grade.total} questions correctly.`;
  const misses = grade.results
    .filter((r) => !r.correct)
    .map((r) =>
      es
        ? `- «${r.q}» — la respuesta esperada es: ${r.expected}`
        : `- "${r.q}" — the expected answer is: ${r.expected}`,
    );
  const close = grade.passed
    ? es
      ? "¡Buen trabajo! Ya tienes el contexto de este pasaje. ¿Qué parte te gustaría traducir primero?"
      : "Nice work — you've got the context for this passage. Which part would you like to translate first?"
    : es
      ? "Te conviene releer las notas de contexto en el panel de recursos. Cuando las hayas repasado, ¿estás listo/a para intentar un cuestionario nuevo?"
      : "It's worth re-reading the context notes in the resources panel. When you've reviewed them, are you ready to try a new quiz?";
  return [head, ...(misses.length > 0 ? [misses.join("\n")] : []), close].join(
    "\n\n",
  );
}

/**
 * Deterministic panel-referral chat reply — used when the LLM formulator fails.
 * Prefer `formulateQuizPanelReferral` (coachReplyFormulator) at call sites.
 */
export function fallbackQuizPanelReferralMessage(language: string): string {
  const es = language.trim().toLowerCase().startsWith("es");
  return es
    ? "Te preparé un breve cuestionario de contexto en el panel de recursos. Responde a tu ritmo y pulsa Enviar cuando termines. Si prefieres omitirlo o hacerlo aquí en el chat, solo dímelo."
    : "I put a short context quiz in the resources panel. Answer at your own pace and press Submit when you're done. If you'd rather skip it or do it here in chat, just tell me.";
}

/** @deprecated Use fallbackQuizPanelReferralMessage / formulateQuizPanelReferral. */
export const quizPanelReferralMessage = fallbackQuizPanelReferralMessage;

/**
 * Deterministic notice when a panel submit arrives with no active quiz session.
 * Prefer `formulateStaleQuizNotice` (coachReplyFormulator) at call sites.
 */
export function fallbackStaleQuizNotice(language: string): string {
  const es = language.trim().toLowerCase().startsWith("es");
  return es
    ? "Ese cuestionario ya no está activo. ¿Quieres que preparemos uno nuevo?"
    : "That quiz is no longer active. Want me to prepare a new one?";
}

/** Localized hint appended to chat when the quiz also renders in the panel (UI aside). */
export function fallbackQuizPanelHint(language: string): string {
  const es = language.trim().toLowerCase().startsWith("es");
  return es
    ? "*(También puedes responder todas las preguntas en el panel de recursos y pulsar Enviar.)*"
    : "*(You can also answer all the questions in the resources panel and press Submit.)*";
}

/** @deprecated Use fallbackQuizPanelHint. */
export const quizPanelHint = fallbackQuizPanelHint;

// ---------------------------------------------------------------------------
// Panel option appearance (shared with ContextQuizPanel — keep class strings
// in the Svelte component; this helper is the single source of selection tone)
// ---------------------------------------------------------------------------

/** Visual tone for one multiple-choice option button. */
export type QuizOptionTone =
  | "default"
  | "selected"
  | "correct"
  | "incorrect"
  | "muted";

/**
 * Resolve whether an option is the current selection (active pick or graded
 * choice). Callers must pass `activeChoice` from template scope so Svelte
 * tracks `chosen` — do not bury that read inside an untracked helper call.
 */
export function isQuizOptionSelected(input: {
  status: "active" | "completed";
  option: string;
  /** Local pick while the quiz is active (`chosen[q.id]`). */
  activeChoice?: string | null;
  /** Graded choice when status is completed (`q.chosen`). */
  completedChosen?: string | null;
}): boolean {
  return input.status === "completed"
    ? input.completedChosen === input.option
    : input.activeChoice === input.option;
}

/**
 * Map quiz status + selection/grading fields → a tone the UI styles with.
 * Selected and aria-checked must use the same condition (`isQuizOptionSelected`).
 */
export function resolveQuizOptionTone(input: {
  status: "active" | "completed";
  option: string;
  activeChoice?: string | null;
  completedChosen?: string | null;
  expected?: string | null;
  correct?: boolean;
}): QuizOptionTone {
  if (input.status === "completed") {
    const isExpected =
      input.expected != null && input.option === input.expected;
    const isChosen =
      input.completedChosen != null && input.option === input.completedChosen;
    if (isExpected) return "correct";
    if (isChosen && !input.correct) return "incorrect";
    return "muted";
  }
  return input.activeChoice === input.option ? "selected" : "default";
}
