/**
 * contextReadiness — internal readiness checklist the coach consults before a
 * translator advances too fast (book → chapter → section/translate).
 *
 * Readiness is derived from hidden history markers (same architecture as the
 * QUIZ / CHECKING session markers, persisted via th_session on the client):
 *
 *   <!-- READY:book:TIT -->            book context understood (quiz passed)
 *   <!-- READY:ch:TIT:1 -->            chapter context understood
 *   <!-- READY:optout:book:TIT -->     user declined the book gate — never nag again
 *   <!-- READY:optout:ch:TIT:1 -->     user declined the chapter gate — never nag again
 *
 * Gate offer (only meaningful on the LAST assistant turn, like
 * AWAITING_LANG_SWITCH — a stale offer is simply ignored):
 *
 *   <!-- READYGATE:book:TIT|TIT 1|passage_overview -->
 *   <!-- READYGATE:ch:TIT:1|TIT 1:1-4|annotated_passage -->
 *
 * Quiz-session companions (bounded by <!-- QUIZ:cleared --> like the QUIZ
 * marker itself):
 *
 *   <!-- QUIZSCOPE:book:TIT --> / <!-- QUIZSCOPE:ch:TIT:1 -->
 *       what readiness a passing quiz should mark
 *   <!-- QUIZSCORE:2 -->
 *       cumulative count of correctly-answered questions so far
 *
 * Failed-quiz retry (LAST assistant turn only — like READYGATE, not sticky
 * QUIZ:idx chat hijacking):
 *
 *   <!-- QUIZ:retry:book:TIT|TIT -->
 *   <!-- QUIZ:retry:ch:TIT:1|TIT 1 -->
 *       awaiting user confirmation to regenerate a fresh panel quiz
 *
 * The gate is SOFT: declining (or ignoring) the offer marks an opt-out and the
 * coach proceeds with whatever the user asked. It never refuses to advance.
 */

import {
  extractCheckingFromHistory,
  extractQuizFromHistory,
  isQuizOptOut,
  VALID_USFM_BOOKS,
  type ConversationMessage,
} from "./intent.js";
import {
  parseQuizKind,
  quizKindMarksReadiness,
  type QuizKind,
} from "./quizKind.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReadinessLevel = "book" | "chapter";

export interface ReadinessScope {
  level: ReadinessLevel;
  /** USFM book code, e.g. "TIT". */
  book: string;
  /** Chapter number as string — required when level is "chapter". */
  chapter?: string;
}

export interface ReadinessState {
  readyBooks: Set<string>;
  /** Keys "BOOK:CH", e.g. "TIT:1". */
  readyChapters: Set<string>;
  optOutBooks: Set<string>;
  optOutChapters: Set<string>;
}

export interface PendingReadinessGate extends ReadinessScope {
  /** Reference to resume when the user declines (or after quiz-gen failure). */
  pendingRef: string;
  /** Intent recorded when the gate fired (informational). */
  pendingIntent: string;
}

// ---------------------------------------------------------------------------
// Marker builders
// ---------------------------------------------------------------------------

function scopeToken(scope: ReadinessScope): string {
  return scope.level === "book"
    ? `book:${scope.book}`
    : `ch:${scope.book}:${scope.chapter}`;
}

/** Hidden readiness marker — appended when a scoped quiz is passed. */
export function buildReadyMarker(scope: ReadinessScope): string {
  return `<!-- READY:${scopeToken(scope)} -->`;
}

/** Hidden opt-out marker — appended when the user declines the gate. */
export function buildReadinessOptOutMarker(scope: ReadinessScope): string {
  return `<!-- READY:optout:${scopeToken(scope)} -->`;
}

/** Hidden marker noting the gate offer was made (last assistant turn only). */
export function buildReadinessGateMarker(gate: PendingReadinessGate): string {
  return `<!-- READYGATE:${scopeToken(gate)}|${gate.pendingRef}|${gate.pendingIntent} -->`;
}

/** Hidden quiz-scope marker — what readiness a passing quiz marks. */
export function buildQuizScopeMarker(scope: ReadinessScope): string {
  return `<!-- QUIZSCOPE:${scopeToken(scope)} -->`;
}

/** Hidden cumulative correct-answer count for the active quiz. */
export function buildQuizScoreMarker(correct: number): string {
  return `<!-- QUIZSCORE:${correct} -->`;
}

/**
 * Hidden marker after a failed panel quiz — last-assistant-turn only.
 * Carries scope + quiz reference so a later affirmative can regenerate
 * without relying on QUIZSCOPE (which is wiped by QUIZ:cleared).
 *
 * Readiness-scoped (legacy / context):
 *   <!-- QUIZ:retry:book:TIT|TIT -->
 *   <!-- QUIZ:retry:ch:TIT:1|TIT 1|context -->
 * Practice (no READY scope):
 *   <!-- QUIZ:retry:practice|JON 1:1-4|passage -->
 */
export function buildQuizRetryMarker(
  scope: ReadinessScope | null,
  quizRef: string,
  kind: QuizKind = "context",
): string {
  const ref = quizRef.trim();
  if (scope && quizKindMarksReadiness(kind)) {
    const kindSuffix = kind === "context" ? "" : `|${kind}`;
    return `<!-- QUIZ:retry:${scopeToken(scope)}|${ref}${kindSuffix} -->`;
  }
  // Practice / passage — no readiness scope; kind is required in the marker.
  const practiceKind = kind === "context" ? "practice" : kind;
  return `<!-- QUIZ:retry:${practiceKind}|${ref}|${practiceKind} -->`;
}

export interface PendingQuizRetry {
  /** Present when this retry is for a readiness-scoped quiz. */
  level?: ReadinessLevel;
  book?: string;
  chapter?: string;
  /** Reference used to regenerate the quiz (e.g. "JON" / "JON 1"). */
  quizRef: string;
  /** Marker kind — practice/passage must not emit READY on pass. */
  kind: QuizKind;
}

/**
 * Parse a pending quiz-retry offer from the LAST assistant turn.
 * Older retries are stale (the user moved on) and are ignored.
 */
export function extractPendingQuizRetry(
  history: ConversationMessage[] | undefined,
): PendingQuizRetry | null {
  if (!history?.length) return null;
  const last = [...history].reverse().find((m) => m.role === "assistant");
  if (!last) return null;

  // Practice / passage retry (no book/ch scope).
  const practice =
    /<!--\s*QUIZ:retry:(passage|practice)\|([^|>]+)\|?(context|passage|practice)?\s*-->/i.exec(
      last.content,
    );
  if (practice) {
    const quizRef = practice[2].trim();
    if (!quizRef) return null;
    return {
      quizRef,
      kind: parseQuizKind(practice[3] ?? practice[1]),
    };
  }

  const m =
    /<!--\s*QUIZ:retry:(book|ch):([A-Z0-9]{2,3})(?::(\d+))?\|([^|>]+?)(?:\|(context|passage|practice))?\s*-->/i.exec(
      last.content,
    );
  if (!m) return null;
  const level: ReadinessLevel =
    m[1].toLowerCase() === "book" ? "book" : "chapter";
  const book = m[2].toUpperCase();
  const chapter = m[3] || undefined;
  if (level === "chapter" && !chapter) return null;
  const quizRef = m[4].trim();
  if (!quizRef) return null;
  return {
    level,
    book,
    chapter,
    quizRef,
    kind: parseQuizKind(m[5]),
  };
}

// ---------------------------------------------------------------------------
// Reference parsing
// ---------------------------------------------------------------------------

export interface ParsedRefParts {
  book: string;
  chapter?: string;
  verseStart?: string;
  verseEnd?: string;
}

/**
 * Parse a formatted USFM reference ("TIT", "TIT 1", "TIT 1:1-4") into parts.
 * Returns null when the book code is not a valid USFM book.
 */
export function parseRefParts(
  ref: string | null | undefined,
): ParsedRefParts | null {
  if (!ref?.trim()) return null;
  const m = /^([A-Z0-9]{2,3})(?:\s+(\d+)(?::(\d+)(?:-(\d+))?)?)?$/i.exec(
    ref.trim(),
  );
  if (!m) return null;
  const book = m[1].toUpperCase();
  if (!VALID_USFM_BOOKS.has(book)) return null;
  return {
    book,
    chapter: m[2] || undefined,
    verseStart: m[3] || undefined,
    verseEnd: m[4] || undefined,
  };
}

/**
 * Readiness scope a quiz for `reference` should mark on pass:
 * book-only ref → book scope; chapter (or verse) ref → chapter scope.
 */
export function quizScopeForReference(
  reference: string | null | undefined,
): ReadinessScope | null {
  const parts = parseRefParts(reference);
  if (!parts) return null;
  if (!parts.chapter) return { level: "book", book: parts.book };
  return { level: "chapter", book: parts.book, chapter: parts.chapter };
}

// ---------------------------------------------------------------------------
// History derivation
// ---------------------------------------------------------------------------

const READY_RE =
  /<!--\s*READY:(optout:)?(book|ch):([A-Z0-9]{2,3})(?::(\d+))?\s*-->/gi;

/**
 * Derive readiness state from conversation history. Markers are monotonic —
 * once ready / opted out, a book or chapter stays that way for the session.
 * User + assistant turns are both scanned (markers are only ever emitted by
 * the server on assistant turns, but scanning all is harmless and robust).
 */
export function deriveReadiness(
  history: ConversationMessage[] | undefined,
): ReadinessState {
  const state: ReadinessState = {
    readyBooks: new Set(),
    readyChapters: new Set(),
    optOutBooks: new Set(),
    optOutChapters: new Set(),
  };
  if (!history?.length) return state;
  for (const msg of history) {
    if (msg.role !== "assistant") continue;
    READY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = READY_RE.exec(msg.content)) !== null) {
      const optout = Boolean(m[1]);
      const level = m[2].toLowerCase();
      const book = m[3].toUpperCase();
      const chapter = m[4];
      if (level === "book") {
        (optout ? state.optOutBooks : state.readyBooks).add(book);
      } else if (chapter) {
        (optout ? state.optOutChapters : state.readyChapters).add(
          `${book}:${chapter}`,
        );
      }
    }
  }
  return state;
}

/** Ready OR opted out — either way, the gate must stay silent. */
export function isBookSettled(state: ReadinessState, book: string): boolean {
  const b = book.toUpperCase();
  return state.readyBooks.has(b) || state.optOutBooks.has(b);
}

/** Ready OR opted out — either way, the gate must stay silent. */
export function isChapterSettled(
  state: ReadinessState,
  book: string,
  chapter: string,
): boolean {
  const key = `${book.toUpperCase()}:${chapter}`;
  return state.readyChapters.has(key) || state.optOutChapters.has(key);
}

/**
 * Parse a pending gate offer from the LAST assistant turn. Older offers are
 * stale (the user moved on) and are ignored — like AWAITING_LANG_SWITCH.
 */
export function extractPendingReadinessGate(
  history: ConversationMessage[] | undefined,
): PendingReadinessGate | null {
  if (!history?.length) return null;
  const last = [...history].reverse().find((m) => m.role === "assistant");
  if (!last) return null;
  const m =
    /<!--\s*READYGATE:(book|ch):([A-Z0-9]{2,3})(?::(\d+))?\|([^|>]+)\|([^>]+?)\s*-->/i.exec(
      last.content,
    );
  if (!m) return null;
  const level: ReadinessLevel =
    m[1].toLowerCase() === "book" ? "book" : "chapter";
  const book = m[2].toUpperCase();
  const chapter = m[3] || undefined;
  if (level === "chapter" && !chapter) return null;
  return {
    level,
    book,
    chapter,
    pendingRef: m[4].trim(),
    pendingIntent: m[5].trim(),
  };
}

// ---------------------------------------------------------------------------
// Quiz-session companions (scope + score, bounded by QUIZ:cleared)
// ---------------------------------------------------------------------------

/**
 * Most recent quiz scope, scanning back until a <!-- QUIZ:cleared --> marker
 * (which ends the previous session, so its scope no longer applies).
 */
export function extractQuizScopeFromHistory(
  history: ConversationMessage[] | undefined,
): ReadinessScope | null {
  if (!history?.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    if (/<!--\s*QUIZ:cleared\s*-->/.test(msg.content)) return null;
    const m =
      /<!--\s*QUIZSCOPE:(book|ch):([A-Z0-9]{2,3})(?::(\d+))?\s*-->/i.exec(
        msg.content,
      );
    if (!m) continue;
    const level: ReadinessLevel =
      m[1].toLowerCase() === "book" ? "book" : "chapter";
    const chapter = m[3] || undefined;
    if (level === "chapter" && !chapter) continue;
    return { level, book: m[2].toUpperCase(), chapter };
  }
  return null;
}

/**
 * Cumulative correct-answer count for the active quiz (0 when none recorded).
 * Bounded by <!-- QUIZ:cleared --> like the scope marker.
 */
export function extractQuizScoreFromHistory(
  history: ConversationMessage[] | undefined,
): number {
  if (!history?.length) return 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    if (/<!--\s*QUIZ:cleared\s*-->/.test(msg.content)) return 0;
    const m = /<!--\s*QUIZSCORE:(\d+)\s*-->/.exec(msg.content);
    if (m) return Number.parseInt(m[1], 10) || 0;
  }
  return 0;
}

/** Majority-correct pass rule: strictly more than half the questions. */
export function isQuizPass(correct: number, total: number): boolean {
  if (total <= 0) return false;
  return correct * 2 > total;
}

// ---------------------------------------------------------------------------
// Gate detection
// ---------------------------------------------------------------------------

/** Intents that must never trigger the readiness gate. */
const GATE_EXCLUDED_INTENTS = new Set([
  "checking",
  "quiz_answer",
  "quiz_skip",
  "checklist_step",
  "phrase_drill",
  "word_study",
  "methodology",
  "discovery",
  "language_answer",
]);

/**
 * True when the study context shows existing saved work (drafts or a checking
 * checklist) covering this book/chapter — resuming work is never gated.
 *
 * Recognized study-context lines:
 *   Saved drafts: TIT 1:1-4; TIT 2:1-5
 *   Checking checklist for TIT 1:1-4: 0/5 complete …
 */
export function hasExistingWorkFor(
  studyContext: string | undefined,
  book: string,
  chapter?: string,
): boolean {
  if (!studyContext?.trim()) return false;
  const b = book.toUpperCase();
  const refPattern = chapter
    ? new RegExp(`\\b${b}\\s+${chapter}\\b`)
    : new RegExp(`\\b${b}\\b`);

  const draftsLine = /^Saved drafts:\s*(.+)$/im.exec(studyContext);
  if (draftsLine && refPattern.test(draftsLine[1].toUpperCase())) return true;

  const checklistLine = /^Checking checklist for\s+([^:]+):/im.exec(
    studyContext,
  );
  if (checklistLine && refPattern.test(checklistLine[1].toUpperCase())) {
    return true;
  }
  return false;
}

export interface DetectReadinessGateOptions {
  /** Resolved intent for this turn. */
  intent: string;
  /** Resolved passage reference (already composed from relative refs). */
  reference?: string;
  /** Batch continuation ref — continuations resume work, never gated. */
  continuationRef?: string;
  /** Explicit Study/Translate/Check switch this turn (NL or clarify answer). */
  explicitModeSwitch?: "study" | "translate" | "check" | null;
  /** Active workflow mode after all resolution. */
  workflowMode: string;
  history: ConversationMessage[] | undefined;
  /** Loaded study reference (client snapshot / history fallback). */
  studyRef?: string | null;
  studyContext?: string;
}

/**
 * Decide whether this turn is an advancement point that should be soft-gated
 * with a readiness quiz offer. Returns the gate to offer, or null.
 *
 * Advancement points:
 *   1. Chapter drill (passage_overview on a chapter ref) → BOOK readiness
 *   2. Section / verse-range pick (annotated_passage / passage_help with
 *      verses) → CHAPTER readiness
 *   3. Explicit switch to Translate mode → CHAPTER readiness of the loaded
 *      chapter (BOOK when no chapter is loaded)
 *
 * Never gates: Check mode, sticky checking, active quiz, continuations,
 * resource/methodology intents, already-ready or opted-out scopes, or when
 * saved drafts / checking work already exist for the scope.
 */
export function detectReadinessGate(
  opts: DetectReadinessGateOptions,
): PendingReadinessGate | null {
  const {
    intent,
    reference,
    continuationRef,
    explicitModeSwitch,
    workflowMode,
    history,
    studyRef,
    studyContext,
  } = opts;

  if (GATE_EXCLUDED_INTENTS.has(intent)) return null;
  if (continuationRef) return null;
  if (workflowMode === "check" || explicitModeSwitch === "check") return null;
  if (extractQuizFromHistory(history)) return null;
  if (extractCheckingFromHistory(history)) return null;
  // A gate offer answered this turn is handled by the caller before detection;
  // a live offer on the last assistant turn must not re-fire.
  if (extractPendingReadinessGate(history)) return null;

  const refParts = parseRefParts(reference);
  const translateSwitch = explicitModeSwitch === "translate";

  let scope: ReadinessScope | null = null;
  let pendingRef: string | null = null;

  if (translateSwitch) {
    const base = refParts ?? parseRefParts(studyRef);
    if (base) {
      scope = base.chapter
        ? { level: "chapter", book: base.book, chapter: base.chapter }
        : { level: "book", book: base.book };
      pendingRef = (reference ?? studyRef ?? "").trim() || null;
    }
  } else if (intent === "passage_overview" && refParts?.chapter) {
    scope = { level: "book", book: refParts.book };
    pendingRef = reference ?? null;
  } else if (
    (intent === "annotated_passage" || intent === "passage_help") &&
    refParts?.chapter &&
    refParts.verseStart
  ) {
    scope = {
      level: "chapter",
      book: refParts.book,
      chapter: refParts.chapter,
    };
    pendingRef = reference ?? null;
  }

  if (!scope || !pendingRef) return null;

  const state = deriveReadiness(history);
  // A settled BOOK covers its chapters: once the user passed (or opted out
  // of) the book-context quiz this session, section/verse picks inside that
  // book must not re-gate at chapter level ("never nag again"). Chapter
  // gates still fire when the user jumps straight into verses with no prior
  // book gate.
  const settled =
    scope.level === "book"
      ? isBookSettled(state, scope.book)
      : isChapterSettled(state, scope.book, scope.chapter!) ||
        isBookSettled(state, scope.book);
  if (settled) return null;

  if (hasExistingWorkFor(studyContext, scope.book, scope.chapter)) return null;

  return { ...scope, pendingRef, pendingIntent: intent };
}

// ---------------------------------------------------------------------------
// Gate offer text + reply interpretation
// ---------------------------------------------------------------------------

/**
 * Emergency sync stub if a caller bypasses the formulator.
 * Production coach wording belongs in `formulateReadinessGateQuestion`
 * (see EMERGENCY_FALLBACK_READINESS_GATE in coachReplyFormulator).
 * Intentionally English, short, and non-coach-voice — never polished ES/EN copy.
 */
export function fallbackReadinessGateQuestion(
  level: ReadinessLevel,
  _language = "en",
): string {
  void _language;
  return level === "book"
    ? "[offline] Optional book-context quiz before continuing?"
    : "[offline] Optional chapter-context quiz before continuing?";
}

/** @deprecated Use formulateReadinessGateQuestion (coachReplyFormulator). */
export const buildReadinessGateQuestion = fallbackReadinessGateQuestion;

export type ReadinessGateReply = "accept" | "decline" | "other";

/**
 * Interpret the user's reply to a pending gate offer.
 * "other" (ignoring the offer with a new request) is treated by the caller as
 * a decline-lite: opt-out marker + proceed, so the user is never nagged again.
 */
export function interpretReadinessGateReply(
  message: string,
  flags: { isAffirmative?: boolean; isNegative?: boolean },
  isAffirmativeMessage: (m: string) => boolean,
): ReadinessGateReply {
  const trimmed = message.trim();
  if (!trimmed) return "other";
  if (flags.isNegative || isQuizOptOut(trimmed)) return "decline";
  if (flags.isAffirmative || isAffirmativeMessage(trimmed)) return "accept";
  if (
    /\b(quiz|cuestionario|chequeo)\b/i.test(trimmed) &&
    /\b(s[ií]|yes|ok(?:ay)?|dale|claro|hagamos|let'?s|start|take)\b/i.test(
      trimmed,
    )
  ) {
    return "accept";
  }
  return "other";
}

/**
 * Interpret the user's reply after a failed quiz (QUIZ:retry pending).
 * Affirmatives / "try again" / "I'm ready" → regenerate; declines → skip;
 * anything else → leave the turn to normal routing (retry expires with the turn).
 */
export function interpretQuizRetryReply(
  message: string,
  flags: { isAffirmative?: boolean; isNegative?: boolean },
  isAffirmativeMessage: (m: string) => boolean,
): ReadinessGateReply {
  const trimmed = message.trim();
  if (!trimmed) return "other";
  if (flags.isNegative || isQuizOptOut(trimmed)) return "decline";
  if (flags.isAffirmative || isAffirmativeMessage(trimmed)) return "accept";
  if (
    /\b(try again|otra vez|de nuevo|estoy list[oa]|i'?m ready|ready to try|list[oa] para)\b/i.test(
      trimmed,
    )
  ) {
    return "accept";
  }
  if (
    /\b(quiz|cuestionario)\b/i.test(trimmed) &&
    /\b(s[ií]|yes|ok(?:ay)?|dale|claro|hagamos|let'?s|start|again|nuevo)\b/i.test(
      trimmed,
    )
  ) {
    return "accept";
  }
  return "other";
}
