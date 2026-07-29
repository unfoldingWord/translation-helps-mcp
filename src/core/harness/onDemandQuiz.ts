/**
 * onDemandQuiz — user- or coach-triggered practice quizzes outside the
 * readiness-gate path.
 *
 * Readiness quizzes (book/chapter gates, Path R accept) keep using QUIZSCOPE
 * + READY. On-demand / practice quizzes may share the same panel + grading
 * machinery but must NOT emit READY unless they are clearly a readiness quiz
 * (`kind: "context"` with a QUIZSCOPE).
 *
 * Marker kinds (embedded in QUIZ panel/chat markers):
 *   context  — book/chapter intro readiness (may emit READY)
 *   passage  — verse/range TN practice (never READY)
 *   practice — generic on-demand practice (never READY)
 */

import { parseRefParts, type ReadinessScope } from "./contextReadiness.js";
import {
  parseQuizKind,
  quizKindMarksReadiness,
  type QuizKind,
} from "./quizKind.js";

export type { QuizKind } from "./quizKind.js";
export {
  formatQuizKindSuffix,
  parseQuizKind,
  quizKindMarksReadiness,
} from "./quizKind.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where quiz questions are generated from. */
export type QuizContentSource = "context" | "passage";

export interface OnDemandQuizRequest {
  /** True when this turn should generate (or accept) an on-demand quiz. */
  requested: true;
  /** Content pipeline: intro notes vs verse TN notes. */
  source: QuizContentSource;
  /** Marker kind for the generated session. */
  kind: QuizKind;
  /**
   * Reference to quiz against (USFM). May be book-only, chapter, or verse range.
   * Resolved from the message, studyRef, or a pending QUIZOFFER.
   */
  quizRef: string;
  /**
   * When true, the user is accepting a prior coach offer (QUIZ:0 / QUIZOFFER /
   * readiness-adjacent soft offer) rather than issuing a fresh request.
   */
  fromOfferAccept?: boolean;
}

export interface SelectQuizSourceOptions {
  /** User message (for "contexto" / practice cues). */
  message: string;
  /** Resolved USFM reference for this turn (message / relative / study). */
  reference: string | null | undefined;
  /** Active study-session reference fallback. */
  studyRef?: string | null;
  /**
   * When the book/chapter readiness is already settled, book/chapter quizzes
   * become practice (no READY) even if sourced from intro notes.
   */
  readinessSettled?: boolean;
  /** Forced kind from a pending QUIZOFFER marker. */
  offerKind?: QuizKind;
  /** Forced source from a pending QUIZOFFER marker. */
  offerSource?: QuizContentSource;
}

// ---------------------------------------------------------------------------
// Soft offer marker (last-assistant-turn only — like READYGATE / QUIZ:retry)
// ---------------------------------------------------------------------------

/**
 * Lightweight coach offer WITHOUT pre-generated questions.
 * Affirmative → Path QO generates from source/kind/ref.
 *
 *   <!-- QUIZOFFER:passage|JON 1:1-4 -->
 *   <!-- QUIZOFFER:context|JON -->
 *   <!-- QUIZOFFER:practice|JON 1 -->
 */
export function buildQuizOfferMarker(
  kind: QuizKind,
  quizRef: string,
  source?: QuizContentSource,
): string {
  const src = source ?? (kind === "passage" ? "passage" : "context");
  return `<!-- QUIZOFFER:${kind}|${quizRef.trim()}|${src} -->`;
}

export interface PendingQuizOffer {
  kind: QuizKind;
  quizRef: string;
  source: QuizContentSource;
}

/** Parse a pending QUIZOFFER from the LAST assistant turn only. */
export function extractPendingQuizOffer(
  history: Array<{ role: string; content: string }> | undefined,
): PendingQuizOffer | null {
  if (!history?.length) return null;
  const last = [...history].reverse().find((m) => m.role === "assistant");
  if (!last) return null;
  const m =
    /<!--\s*QUIZOFFER:(context|passage|practice)\|([^|>]+)\|?(context|passage)?\s*-->/i.exec(
      last.content,
    );
  if (!m) return null;
  const kind = parseQuizKind(m[1]);
  const quizRef = m[2].trim();
  if (!quizRef) return null;
  const source =
    (m[3]?.toLowerCase() as QuizContentSource | undefined) ??
    (kind === "passage" ? "passage" : "context");
  return { kind, quizRef, source };
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/**
 * Explicit on-demand quiz / practice request (broader than isExplicitQuizRequest).
 * Covers: "hazme un quiz", "quiero practicar", "dame un cuestionario", "quiz me", etc.
 */
export function isOnDemandQuizRequest(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  // Narrow opt-out must not look like a request.
  if (
    /\b(omitir|saltar|skip|pass|omit|no\s+quiero|don'?t\s+want)\b.{0,40}\b(quiz|cuestionario|chequeo|practic)/i.test(
      t,
    )
  ) {
    return false;
  }
  return /\b((haz(me|nos)?|hacer|hagamos|quiero|vamos\s+a|dame|prep[aá]rame|cr[eé]ame|let'?s|start|do|take|give\s+me|make\s+me)\b.{0,48}\b(chequeo|cuestionario|quiz|context\s+check|pr[aá]ctic[ao]|practice|comprobaci[oó]n)|(quiz\s+me|test\s+me)\b|(chequeo|cuestionario|quiz|pr[aá]ctic[ao]|practice)\b.{0,28}\b(por\s+favor|please|ahora|now|s[ií]|de\s+contexto|of\s+context)|(quiero|want\s+to|let'?s)\b.{0,24}\b(practicar|practice|repasar)|un\s+(peque[nñ]o\s+)?(quiz|cuestionario|chequeo))\b/i.test(
    t,
  );
}

/**
 * Detect an on-demand quiz turn: fresh user request OR affirmative after a
 * pending QUIZOFFER. Does NOT handle READYGATE / QUIZ:retry (those stay on
 * Path R / Path QR). Does NOT hijack an active panel/chat quiz session.
 */
export function detectOnDemandQuizIntent(opts: {
  message: string;
  studyRef?: string | null;
  /** Composed reference already resolved for this turn (relative refs etc.). */
  reference?: string | null;
  history?: Array<{ role: string; content: string }>;
  isAffirmative?: boolean;
  /** When a live QUIZ session exists, leave it to Path Q / QP. */
  hasActiveQuiz?: boolean;
}): OnDemandQuizRequest | null {
  const {
    message,
    studyRef,
    reference,
    history,
    isAffirmative = false,
    hasActiveQuiz = false,
  } = opts;

  if (hasActiveQuiz) return null;

  const pendingOffer = extractPendingQuizOffer(history);
  if (pendingOffer) {
    const accept =
      isAffirmative ||
      isOnDemandQuizRequest(message) ||
      /^(s[ií]|yes|ok(?:ay)?|dale|claro|vale|sure|please|por\s+favor)\b/i.test(
        message.trim(),
      );
    if (accept) {
      return {
        requested: true,
        source: pendingOffer.source,
        kind: pendingOffer.kind,
        quizRef: pendingOffer.quizRef,
        fromOfferAccept: true,
      };
    }
  }

  if (!isOnDemandQuizRequest(message)) return null;

  const selected = selectQuizContentSource({
    message,
    reference: reference ?? null,
    studyRef,
  });
  if (!selected) return null;

  return {
    requested: true,
    source: selected.source,
    kind: selected.kind,
    quizRef: selected.quizRef,
  };
}

// ---------------------------------------------------------------------------
// Content source selection
// ---------------------------------------------------------------------------

/**
 * Choose intro-note vs verse-TN generation, and the marker kind.
 *
 * Rules:
 *   - User says "contexto" / "context" → context notes; kind context (or practice
 *     when readiness already settled).
 *   - Verse / verse-range ref → passage notes; kind passage (never READY).
 *   - Book / chapter only → context notes; kind context unless settled → practice.
 *   - No usable ref → null (caller cannot generate).
 */
export function selectQuizContentSource(
  opts: SelectQuizSourceOptions,
): { source: QuizContentSource; kind: QuizKind; quizRef: string } | null {
  if (opts.offerKind && opts.offerSource && opts.reference) {
    return {
      source: opts.offerSource,
      kind: opts.offerKind,
      quizRef: opts.reference.trim(),
    };
  }

  // Caller (skillChat) resolves relative/study refs into `reference` before
  // calling — avoid importing intent.js here (circular with QuizKind helpers).
  const raw = opts.reference?.trim() || opts.studyRef?.trim() || "" || null;
  if (!raw) return null;

  const parts = parseRefParts(raw);
  if (!parts) return null;

  const wantsContext =
    /\b(contexto|context|intro|introducci[oó]n|book\s+intro|chapter\s+intro)\b/i.test(
      opts.message,
    );

  // Verse / range → passage practice (unless user explicitly asked for context).
  if (parts.verseStart && !wantsContext) {
    return {
      source: "passage",
      kind: opts.offerKind === "practice" ? "practice" : "passage",
      quizRef: raw.trim(),
    };
  }

  // Book / chapter (or explicit context) → intro notes.
  const quizRef = parts.chapter ? `${parts.book} ${parts.chapter}` : parts.book;

  if (opts.offerKind === "passage") {
    return { source: "passage", kind: "passage", quizRef: raw.trim() };
  }

  const kind: QuizKind =
    opts.readinessSettled || opts.offerKind === "practice"
      ? "practice"
      : "context";

  return { source: "context", kind, quizRef };
}

/**
 * Readiness scope to attach (QUIZSCOPE) for a quiz — only when the kind may
 * mark READY. Practice / passage return null.
 */
export function readinessScopeForQuizKind(
  kind: QuizKind,
  quizRef: string,
): ReadinessScope | null {
  if (!quizKindMarksReadiness(kind)) return null;
  const parts = parseRefParts(quizRef);
  if (!parts) return null;
  if (!parts.chapter) return { level: "book", book: parts.book };
  return { level: "chapter", book: parts.book, chapter: parts.chapter };
}
