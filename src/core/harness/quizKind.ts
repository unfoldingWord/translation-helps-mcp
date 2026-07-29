/**
 * quizKind — leaf helpers for QUIZ marker kinds (no harness imports).
 *
 *   context  — book/chapter intro readiness (may emit READY)
 *   passage  — verse/range TN practice (never READY)
 *   practice — generic on-demand practice (never READY)
 */

export type QuizKind = "context" | "passage" | "practice";

const QUIZ_KINDS = new Set<QuizKind>(["context", "passage", "practice"]);

export function parseQuizKind(raw: string | null | undefined): QuizKind {
  const k = (raw ?? "").trim().toLowerCase();
  if (QUIZ_KINDS.has(k as QuizKind)) return k as QuizKind;
  return "context"; // legacy markers omit kind → readiness-eligible
}

/** Only `context` quizzes may mark book/chapter READY. */
export function quizKindMarksReadiness(
  kind: QuizKind | null | undefined,
): boolean {
  return (kind ?? "context") === "context";
}

/** Format optional `:kind` suffix for QUIZ markers (omit for legacy context). */
export function formatQuizKindSuffix(
  kind: QuizKind | null | undefined,
): string {
  if (!kind || kind === "context") return "";
  return `:${kind}`;
}
