/**
 * Intent classifier for the context harness.
 *
 * Classifies a user message into one of:
 *   passage_overview    — large range (whole chapter, many verses) → orientation first
 *   annotated_passage   — short verse range (< LARGE_RANGE_THRESHOLD) → annotated text + challenge list
 *   passage_help        — fallback for verse ranges (kept for batch-continuation)
 *   phrase_drill        — user selected a specific challenge phrase to explore
 *   checklist_step      — advancing through a guided checklist session
 *   quiz_answer         — answering / starting an interactive context quiz
 *   quiz_skip           — opting out of an active context quiz
 *   word_study          — asking about a specific biblical term
 *   methodology         — asking how to translate / handle a linguistic problem
 *   checking            — verifying / checking a translation
 *   discovery           — what languages/resources are available
 *   open_ended          — anything else → agentic fallback
 *
 * Continuation detection (message like "next", "continue"):
 *   When the conversation history contains a batch-session footer, the intent
 *   becomes a continuation and carries the next batch reference from that footer.
 *
 * Phrase-drill detection:
 *   When history contains a <!-- CHALLENGES:N [...] --> comment and the user
 *   types a number (1-9) or a phrase that matches a challenge label, the intent
 *   is phrase_drill carrying challengeIndex + challengePhrase.
 *
 * Context-quiz detection:
 *   When history contains a <!-- QUIZ:idx/total [...] --> comment (and no more
 *   recent <!-- QUIZ:cleared -->), short answer-like messages are quiz_answer
 *   (or quiz_skip for explicit opt-out). A new Bible reference, a clear
 *   topic/resource request, or a long non-answer question abandons the quiz.
 *
 * Sticky checking (Pedir revisión):
 *   When history contains <!-- CHECKING:REF --> (and no more recent
 *   <!-- CHECKING:cleared -->), validation replies stay on intent "checking"
 *   until the checklist is complete, the user opts out, they clearly change
 *   topic / name a different Bible reference, or they explicitly request
 *   Study / Translate workflow mode (UI switch or intent phrases).
 */

import { parseReferenceForTool } from "@translation-helps/door43";
import type { LLMProvider } from "../rag/providers/LLMProvider.js";

import {
  detectDifficultyFollowUp,
  detectDraftSubmitIntent,
} from "./coachPedagogy.js";
import { parseCheckItemFromMessage } from "../checklist/checkingChecklist.js";
import {
  extractPending,
  hasAwaitingLang,
  extractWarmup,
  isAffirmative as isAffirmativeMessage,
} from "./warmup.js";
import { detectWorkflowModeIntent } from "./workflowMode.js";
import { parseQuizKind, type QuizKind } from "./quizKind.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentType =
  | "passage_overview"
  | "annotated_passage" // short verse range → annotated text + challenge buttons
  | "passage_help"
  | "phrase_drill" // user selected a specific challenge to explore
  | "checklist_step" // advancing through a guided checklist session
  | "quiz_answer" // answering / starting an interactive context quiz
  | "quiz_skip" // opting out of an active context quiz
  | "word_study"
  | "methodology"
  | "checking"
  | "discovery"
  | "open_ended"
  | "language_answer"; // user is replying to the language-gate prompt

/** One Q+A pair stored in a <!-- QUIZ:... --> history marker. */
export interface QuizItem {
  q: string;
  a: string;
  /**
   * Multiple-choice options (3–4, includes the correct answer `a`).
   * Present when the quiz was generated for the interactive panel UI;
   * chat Path Q ignores it and grades free-text answers as before.
   */
  options?: string[];
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface IntentResult {
  intent: IntentType;
  /** Detected Bible reference, e.g. "JHN 3:16" or "JHN 3" */
  reference?: string;
  /** True when reference covers more than LARGE_RANGE_THRESHOLD verses or is a whole chapter. */
  isLargeRange?: boolean;
  /** For batch continuations: the next batch ref extracted from history ("JHN 3:5-8"). */
  continuationRef?: string;
  /** For checklist_step: the step number to present next. */
  nextStep?: number;
  /** For checklist_step: total number of steps in this session. */
  totalSteps?: number;
  /** For phrase_drill: 1-based index of the challenge the user selected. */
  challengeIndex?: number;
  /** For phrase_drill: the phrase label the user typed or clicked. */
  challengePhrase?: string;
  /** For quiz_answer / quiz_skip: questions embedded in the QUIZ marker. */
  quizQuestions?: QuizItem[];
  /**
   * For quiz_answer / quiz_skip: marker index.
   * 0 = offer pending; N (1..total) = question N was asked and awaits an answer.
   */
  quizIndex?: number;
  /** For quiz_answer / quiz_skip: total questions in the quiz. */
  quizTotal?: number;
  /**
   * For quiz_answer / quiz_skip: session mode from the QUIZ marker.
   * "panel" = the quiz renders in the resources panel; a quiz_answer with
   * this mode is an explicit "ask me in chat" request (turn-by-turn fallback).
   */
  quizMode?: "chat" | "panel";
  /**
   * For quiz_answer / quiz_skip: marker kind.
   * "context" = readiness-eligible; "passage" / "practice" = on-demand only.
   */
  quizKind?: QuizKind;
  /** Detected term for word_study */
  term?: string;
  /** Detected TA topic slug for methodology */
  taTopic?: string;
  confidence: "high" | "medium" | "low";
  /** True when user confirmed a warm-gate offer ("yes") — skip the gate this turn */
  warmConfirmed?: boolean;
  /** True when we need to ask the user for their preferred strategic language */
  awaitingLanguage?: boolean;
  /** For language_answer intent: the pending passage ref to resume after language is resolved */
  pendingRef?: string;
  /** For language_answer intent: the pending intent to resume after language is resolved */
  pendingIntent?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Verse count threshold above which a range is treated as large. */
const LARGE_RANGE_THRESHOLD = 5;

/** Batch size used when drilling into a chapter verse-by-verse. */
export const BATCH_SIZE = 4;

// ---------------------------------------------------------------------------
// USFM book validation set
// ---------------------------------------------------------------------------

export const VALID_USFM_BOOKS = new Set([
  "GEN",
  "EXO",
  "LEV",
  "NUM",
  "DEU",
  "JOS",
  "JDG",
  "RUT",
  "1SA",
  "2SA",
  "1KI",
  "2KI",
  "1CH",
  "2CH",
  "EZR",
  "NEH",
  "EST",
  "JOB",
  "PSA",
  "PRO",
  "ECC",
  "SNG",
  "ISA",
  "JER",
  "LAM",
  "EZK",
  "DAN",
  "HOS",
  "JOL",
  "AMO",
  "OBA",
  "JON",
  "MIC",
  "NAM",
  "HAB",
  "ZEP",
  "HAG",
  "ZEC",
  "MAL",
  "MAT",
  "MRK",
  "LUK",
  "JHN",
  "ACT",
  "ROM",
  "1CO",
  "2CO",
  "GAL",
  "EPH",
  "PHP",
  "COL",
  "1TH",
  "2TH",
  "1TI",
  "2TI",
  "TIT",
  "PHM",
  "HEB",
  "JAS",
  "1PE",
  "2PE",
  "1JN",
  "2JN",
  "3JN",
  "JUD",
  "REV",
]);

// ---------------------------------------------------------------------------
// Keyword tables
// ---------------------------------------------------------------------------

// TODO(llm-intent): These keyword lists are brittle for free-form user text (multilingual,
// paraphrased phrasing, etc.). However, classifyIntent() is called synchronously on every
// request before the first streamed token, so replacing them with an LLM call would add
// visible cold-start latency. The streaming path already calls resolveContextual() for short
// messages; these keyword lists only fire for longer, reference-free messages where the user
// is clearly asking about a topic (word study, methodology, etc.). Consider batching with the
// resolveContextual() call or adding a dedicated intent-classify LLM call in a future pass
// once it can run in parallel with the first status emit.
const WORD_STUDY_KEYWORDS = [
  "what does",
  "meaning of",
  "define",
  "definition",
  "what is",
  "word for",
  "term",
  "translate the word",
  "how to translate",
  "biblical term",
  "word study",
  // Spanish / multilingual article & term requests
  "artículo",
  "articulo",
  "palabra",
  "término",
  "termino",
  "significado de",
  "qué significa",
  "que significa",
  "definición",
  "definicion",
  "translation word",
  "translation words",
  "palabra clave",
  "término clave",
  "termino clave",
];

/** Explicit TW article request (Spanish/English) — stronger than keyword substring match. */
const TW_ARTICLE_REQUEST_RE =
  /\b(?:artículo|articulo|article)\s+(?:de\s+)?(?:tw|translation\s+words?)?\s*(?:sobre|de|del|para|about|on|for)\b|\b(?:muéstrame|muestrame|show|dame|quiero|open|abrir|ver)\b.{0,40}\b(?:artículo|articulo|article|tw)\b|\b(?:tw|translation\s+words?)\b.{0,40}\b(?:artículo|articulo|article|sobre|about)\b/i;

// TODO(llm-intent): Same concern as WORD_STUDY_KEYWORDS — keyword list on free-form text.
// Kept on sync path for now to avoid blocking first token.
const METHODOLOGY_KEYWORDS = [
  "figure of speech",
  "figures of speech",
  "metaphor",
  "simile",
  "how do i translate",
  "how should i translate",
  "how to handle",
  "translation strategy",
  "translation strategies",
  "academy",
  "passive voice",
  "rhetorical question",
  "pronoun",
  "idiom",
  "hyperbole",
  "metonymy",
  "euphemism",
  "abstraction",
  "inclusive language",
  "unknown",
  "culture",
  "cultural",
];

// TODO(llm-intent): Same concern as WORD_STUDY_KEYWORDS — keyword list on free-form text.
// Kept on sync path for now to avoid blocking first token.
const CHECKING_KEYWORDS = [
  "check",
  "verify",
  "comprehension question",
  "translation question",
  "is my translation",
  "did i get it right",
  "accurate",
  "check draft",
  "check my draft",
  "review my draft",
  "review my translation",
  "save draft",
  "aquí está mi borrador",
  "aqui esta mi borrador",
  "revisa mi borrador",
  "revisa mi traducción",
  "revisa mi traduccion",
  "verifica mi borrador",
  "chequea mi borrador",
  "mi borrador",
];

// TODO(llm-intent): Same concern as WORD_STUDY_KEYWORDS — keyword list on free-form text.
// Kept on sync path for now to avoid blocking first token.
const DISCOVERY_KEYWORDS = [
  "available languages",
  "list languages",
  "what languages",
  "available resources",
  "list resources",
  "what resources",
  "which languages",
  "which resources",
  "does it support",
  "is there a resource",
];

/** Continuation phrases that advance a batch session (multilingual).
 *
 * TODO(llm-intent): This is a keyword list on free-form text that will miss paraphrased
 * continuations in languages not covered here. However, isContinuationMessage() is called
 * inside the synchronous classifyIntent(), which runs before the first streamed token.
 * Replacing it with an LLM call would add cold-start latency. The streaming path in
 * skillChat.ts already uses resolveContextual() (LLM) to detect continuation intent for
 * messages ≤ 120 chars, which covers the vast majority of continuation replies. This regex
 * serves as the fast fallback for the non-streaming answer() path and as an early short-
 * circuit before the LLM call in answerStream().
 */
const CONTINUATION_PATTERN =
  /^(next|continue|go on|keep going|yes|ok|proceed|move on|next verses|next section|carry on|more|go ahead|yes please|let'?s continue|s[ií]|adelante|siguiente|continuar|continúa|sigue|vamos|dale|por favor|s[ií] por favor|sim|próximo|pode|vamos lá|oui|suivant|continuer|allez|ja|weiter|nächste|ya|lanjut|teruskan)\s*\.?$/i;

const METHODOLOGY_SLUG_MAP: Array<[RegExp, string]> = [
  [/metaphor/i, "translate/figs-metaphor"],
  [/simile/i, "translate/figs-simile"],
  [/passive\s+voice/i, "translate/figs-activepassive"],
  [/rhetorical\s+question/i, "translate/figs-rquestion"],
  [/euphemism/i, "translate/figs-euphemism"],
  [/hyperbole/i, "translate/figs-hyperbole"],
  [/metonymy/i, "translate/figs-metonymy"],
  [/synecdoche/i, "translate/figs-synecdoche"],
  [/abstract/i, "translate/figs-abstractnouns"],
  [/pronoun/i, "translate/figs-pronouns"],
  [/translation\s+notes/i, "intro/translation-notes-intro"],
  [/check.*accurac/i, "checking/accuracy"],
  [/unknown/i, "translate/translate-unknown"],
  [/names?/i, "translate/translate-names"],
];

// ---------------------------------------------------------------------------
// Reference extraction
// ---------------------------------------------------------------------------

export interface ExtractedReference {
  /** Formatted USFM reference, e.g. "JHN 3" or "JHN 3:1-20" */
  ref: string;
  /** True when the reference covers more than LARGE_RANGE_THRESHOLD verses or is a whole chapter/chapter-range. */
  isLargeRange: boolean;
}

/**
 * Scan a message for a Bible reference.
 * Returns structured info including whether it's a large range, or null.
 */
export function extractReferenceInfo(
  message: string,
): ExtractedReference | null {
  const words = message.split(/\s+/);

  for (let i = 0; i < words.length - 1; i++) {
    for (const len of [2, 3]) {
      // Strip wrapping/trailing punctuation so "Titus 2:12?", "John 3:16.",
      // and hint tags like "[Passage: TIT 1]" are recognised.
      const candidate = words
        .slice(i, i + len)
        .join(" ")
        .replace(/^[[{(<"']+/, "")
        .replace(/[\]})>"'.,!?;:]+$/, "");
      const parsed = parseReferenceForTool(candidate);
      if (!parsed || !VALID_USFM_BOOKS.has(parsed.book)) continue;

      // Format reference string
      let ref: string;
      if (parsed.verseStart) {
        ref = parsed.verseEnd
          ? `${parsed.book} ${parsed.chapter}:${parsed.verseStart}-${parsed.verseEnd}`
          : `${parsed.book} ${parsed.chapter}:${parsed.verseStart}`;
      } else {
        ref = `${parsed.book} ${parsed.chapter}`;
      }

      // Detect large range
      const wholeChapter = !parsed.verseStart;
      // Count inclusive verses: end - start + 1 (e.g. 1:1-5 = 5 verses)
      const wideVerseRange =
        parsed.verseStart &&
        parsed.verseEnd &&
        parseInt(parsed.verseEnd) - parseInt(parsed.verseStart) + 1 >=
          LARGE_RANGE_THRESHOLD;

      return { ref, isLargeRange: !!(wholeChapter || wideVerseRange) };
    }
  }

  // Second pass: handle "Book chapter N" or "Book ch. N" patterns that the
  // word-window scan above misses (e.g. "Titus chapter 2", "1 Cor ch. 3",
  // "1 Corinthians chapter 3:5-7").
  //
  // No `i` flag on the book-name part — requiring a literal uppercase first
  // letter prevents common English words like "translate" or "help" from
  // being mistaken for book names (they start with lowercase). The chapter
  // keyword alternatives are spelled out in mixed case instead.
  const chapterWordPattern =
    /\b(\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:[Cc]hapter|[Cc][Hh]\.?|[Cc][Hh][Aa][Pp]\.?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?/;
  const chMatch = message.match(chapterWordPattern);
  if (chMatch) {
    const [, bookRaw, chapterStr, verseStr, endVerseStr] = chMatch;
    const parsedCh = parseReferenceForTool(
      `${bookRaw.trim()} ${chapterStr}${verseStr ? `:${verseStr}${endVerseStr ? `-${endVerseStr}` : ""}` : ""}`,
    );
    if (parsedCh) {
      // The parser may return abbreviated/spaced codes (e.g. "1 COR" instead of
      // the standard USFM code "1CO").  Normalise by stripping spaces and taking
      // the 3-char prefix so that both forms resolve to the same set entry.
      const rawBook = parsedCh.book;
      const compactBook = rawBook.replace(/\s+/g, "").slice(0, 3);
      const bookCode = VALID_USFM_BOOKS.has(rawBook)
        ? rawBook
        : VALID_USFM_BOOKS.has(compactBook)
          ? compactBook
          : null;

      if (bookCode) {
        let ref: string;
        if (parsedCh.verseStart) {
          ref = parsedCh.verseEnd
            ? `${bookCode} ${parsedCh.chapter}:${parsedCh.verseStart}-${parsedCh.verseEnd}`
            : `${bookCode} ${parsedCh.chapter}:${parsedCh.verseStart}`;
        } else {
          ref = `${bookCode} ${parsedCh.chapter}`;
        }
        const wholeChapter = !parsedCh.verseStart;
        return { ref, isLargeRange: wholeChapter };
      }
    }
  }

  return null;
}

/** Convenience wrapper — returns just the reference string, or null. */
export function extractReference(message: string): string | null {
  return extractReferenceInfo(message)?.ref ?? null;
}

// ---------------------------------------------------------------------------
// Batch computation
// ---------------------------------------------------------------------------

/**
 * Given a chapter/chapter-range reference (e.g. "JHN 3"), return the first
 * batch reference (e.g. "JHN 3:1-4").
 */
export function firstBatchRef(chapterRef: string): string {
  const parsed = parseReferenceForTool(chapterRef);
  if (!parsed) return chapterRef;
  if (parsed.verseStart) return chapterRef; // already a verse reference
  return `${parsed.book} ${parsed.chapter}:1-${BATCH_SIZE}`;
}

/**
 * Given a batch reference (e.g. "JHN 3:1-4"), return the next batch
 * (e.g. "JHN 3:5-8"). Returns null if the current ref has no verse.
 */
export function nextBatchRef(batchRef: string): string | null {
  const parsed = parseReferenceForTool(batchRef);
  if (!parsed?.verseStart) return null;
  const endVerse = parsed.verseEnd
    ? parseInt(parsed.verseEnd)
    : parseInt(parsed.verseStart);
  const nextStart = endVerse + 1;
  const nextEnd = nextStart + BATCH_SIZE - 1;
  return `${parsed.book} ${parsed.chapter}:${nextStart}-${nextEnd}`;
}

// ---------------------------------------------------------------------------
// Continuation detection
// ---------------------------------------------------------------------------

/** True when the message is a continuation phrase (next, continue, etc.) */
export function isContinuationMessage(message: string): boolean {
  return CONTINUATION_PATTERN.test(message.trim());
}

/**
 * Describes the session type found in the most recent assistant message.
 */
export type SessionContext =
  | { type: "batch"; nextRef: string }
  | { type: "checklist"; currentStep: number; totalSteps: number }
  | {
      type: "quiz";
      questions: QuizItem[];
      currentIndex: number;
      total: number;
      mode: "chat" | "panel";
      kind: QuizKind;
    }
  | null;

/** Opt-out phrases for the interactive context quiz (multilingual). */
const QUIZ_OPT_OUT_RE =
  /^(skip|no|stop|pass|omit|decline|no thanks|no thank you|not now|mejor no|saltar|omitir|no gracias|no por ahora|parar|detener|não|pular|non|passer|nein|überspringen|ya tidak|لا)\s*[.!]?\s*$/i;

/** Uncertainty replies that count as quiz *answers*, never as opt-out. */
const QUIZ_UNCERTAIN_ANSWER_RE =
  /^(no sé|no se|no lo sé|no lo se|i don't know|i dont know|idk|not sure|no estoy seguro|no estoy segura)\s*[.!]?\s*$/i;

/**
 * True when the user is declining / skipping an active context quiz.
 * Does NOT match uncertainty answers like "No sé" / "I don't know".
 */
export function isQuizOptOut(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  // Preserve systems-tester contract: uncertainty is an answer, not opt-out.
  if (QUIZ_UNCERTAIN_ANSWER_RE.test(trimmed)) return false;
  if (QUIZ_OPT_OUT_RE.test(trimmed)) return true;
  // Longer natural declines that still clearly opt out of the quiz.
  // Includes compound "prefer to skip …" / "omitir el cuestionario …".
  return /\b(skip(?:\s+the\s+quiz)?|saltar|omitir|omit(?:\s+the\s+quiz)?|no gracias|no thanks|not now|mejor no|stop the quiz|prefiero\s+(?:omitir|saltar|skip)|quiero\s+(?:omitir|saltar|skip)|rather\s+skip)\b/i.test(
    trimmed,
  );
}

/**
 * True when a message during an active quiz looks like an attempt to answer
 * the current question (including "No sé"). False for clear topic changes,
 * resource requests, or long methodological / drafting questions.
 */
export function looksLikeQuizAnswer(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (isQuizOptOut(trimmed)) return false;
  if (QUIZ_UNCERTAIN_ANSWER_RE.test(trimmed)) return true;
  if (isQuizTopicChange(trimmed)) return false;

  const isQuestion =
    /[¿?]/.test(trimmed) ||
    /^(qué|que|cómo|como|cuál|cual|dónde|donde|por\s+qué|why|what|how|when|where|which)\b/i.test(
      trimmed,
    );
  // Long interrogatives / drafting questions are never short quiz answers.
  if (isQuestion && trimmed.length > 60) return false;
  if (trimmed.length > 180) return false;
  return true;
}

/**
 * True when the user is asking for notes/terms/next-steps / methodology rather
 * than answering the current quiz question.
 *
 * Intentionally avoids broad keyword lists like bare "check" / "accurate" /
 * "term" — those appear inside normal quiz answers and were aborting Path Q.
 */
export function isQuizTopicChange(message: string): boolean {
  const lower = message.toLowerCase();

  if (
    /\b(qué debo|que debo|what should i|how (?:do|should) i|ahora qué|ahora que|siguiente paso|next step|por dónde|por donde)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  // Resource / note / term requests ("revisar la nota sobre fe", "show the note").
  if (
    /\b(nota|notas|notes?|término|termino|terms?|palabra|article|artículo|articulo|translation notes?|\btn\b|\btw\b|\bta\b)\b/i.test(
      lower,
    ) &&
    /\b(revisar|ver|mostrar|muéstrame|muestrame|show|look|leer|sobre|about|quiero|prefiero|dame|give|open|abrir)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (isWordArticleRequest(message)) return true;

  // Strong methodology / drafting redirects (not bare jargon words in answers).
  if (
    /\b(figure of speech|figures of speech|translation strateg(?:y|ies)|how (?:do|should) i translate|cómo (?:debo|puedo) traducir|mientras redacto|while (?:i\s+)?draft)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  // Explicit draft-check / discovery requests (not bare "check"/"accurate").
  if (
    /\b(check my (?:draft|translation)|review my (?:draft|translation)|pedir revisi[oó]n|revisa mi (?:borrador|traducci[oó]n)|available languages|list languages|available resources|list resources)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (DISCOVERY_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  return false;
}

/**
 * Strip quiz opt-out phrasing so any residual request remains.
 * Important: do NOT swallow the rest of the sentence after "omitir/skip"
 * (compound: "omitir el cuestionario y muéstrame el artículo…").
 */
export function stripQuizOptOutPhrases(message: string): string {
  return message
    .trim()
    .replace(
      /\b(no,?\s*)?(prefiero\s+|quiero\s+|rather\s+)?(omitir|saltar|skip|pass|omit)(\s+((el|the)\s+)?(cuestionario|quiz|chequeo(?:\s+de\s+contexto)?))?/gi,
      " ",
    )
    .replace(
      /\b(el\s+|the\s+)?(cuestionario|quiz|chequeo(?:\s+de\s+contexto)?)\b/gi,
      " ",
    )
    .replace(
      /\b(mejor no|not now|no gracias|no thanks|no por ahora|no thank you|decline|detener|parar)\b/gi,
      " ",
    )
    .replace(/^(no)\b/gi, " ")
    .replace(/[.!,;:?¿\s«»""]+/g, " ")
    .trim();
}

/**
 * True when an opt-out message also carries a follow-on request (e.g. skip the
 * quiz and open the note on "fe"). Pure declines return false.
 */
export function hasQuizFollowOnRequest(message: string): boolean {
  if (!isQuizOptOut(message)) return false;
  if (isQuizTopicChange(message)) return true;
  if (isWordArticleRequest(message)) return true;
  return stripQuizOptOutPhrases(message).length >= 8;
}

/**
 * True when history has a sticky quiz skip (`<!-- QUIZ:cleared -->`) that should
 * suppress auto-offering a new context quiz on later annotated_passage turns.
 * A more-recent active `<!-- QUIZ:idx/total -->` marker means a new quiz started.
 */
export function historyHasQuizCleared(
  history: ConversationMessage[] | undefined,
): boolean {
  if (!history?.length) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    if (/<!-- QUIZ:cleared -->/.test(msg.content)) return true;
    if (
      /<!-- QUIZ:(?:\d+|panel)\/\d+(?::(?:context|passage|practice))? /.test(
        msg.content,
      )
    )
      return false;
  }
  return false;
}

/** User explicitly asks to start / resume a context quiz after a prior skip. */
export function isExplicitQuizRequest(message: string): boolean {
  // Broader on-demand phrasing ("hazme un quiz", "quiero practicar") plus
  // the classic chequeo / context-check opt-in patterns.
  if (
    /\b((hagamos|hacer|quiero|vamos\s+a|haz(me|nos)?|dame|let'?s|start|do|take|give\s+me|make\s+me|quiz\s+me)\b.{0,48}\b(chequeo|cuestionario|quiz|context\s+check|pr[aá]ctic[ao]|practice)|(chequeo|cuestionario|quiz)\b.{0,24}\b(por\s+favor|please|ahora|now|s[ií])|(s[ií]|yes|ok|okay|dale|claro).{0,20}\b(chequeo|cuestionario|quiz|context\s+check)|(quiero|want\s+to)\b.{0,24}\b(practicar|practice))\b/i.test(
      message,
    )
  ) {
    return true;
  }
  return false;
}

/** True for Path Q intents that must not be stolen by passage-binding. */
export function isQuizRoutingIntent(
  intent: IntentType | undefined,
): intent is "quiz_answer" | "quiz_skip" {
  return intent === "quiz_answer" || intent === "quiz_skip";
}

export type QuizSession = {
  questions: QuizItem[];
  currentIndex: number;
  total: number;
  /**
   * "chat" — turn-by-turn chat quiz (idx 0 offer / question N pending).
   * "panel" — the quiz renders in the resources panel; the marker only
   * carries the answer key for the panel submit and must NOT hijack chat
   * turns into Path Q.
   */
  mode: "chat" | "panel";
  /**
   * Marker kind — "context" (default / readiness) vs on-demand
   * "passage" / "practice". Practice kinds must not emit READY.
   */
  kind: QuizKind;
};

/**
 * After contextual LLM flags / study-ref composition, re-assert Path Q when a
 * quiz marker is live. Abandon only when the *user message* names a new Bible
 * reference — never because study context or wantsPassageResources attached a
 * spurious `reference` to the intent.
 */
export function reinforceQuizSession(args: {
  message: string;
  intentResult: IntentResult;
  history: ConversationMessage[] | undefined;
  /** LLM contextual flag (skillChat resolveContextual). */
  isAffirmative?: boolean;
  /** LLM contextual flag (skillChat resolveContextual). */
  isContinuation?: boolean;
}): { intentResult: IntentResult; clearQuizOnResponse: boolean } {
  const {
    message,
    history,
    isAffirmative: contextualAffirmative = false,
    isContinuation: contextualContinuation = false,
  } = args;
  const intentResult = args.intentResult;
  const quizSession = extractQuizFromHistory(history);
  if (!quizSession) {
    return { intentResult, clearQuizOnResponse: false };
  }

  const bindQuiz = (intent: "quiz_answer" | "quiz_skip"): IntentResult => {
    const rest = { ...intentResult };
    delete rest.reference;
    return {
      ...rest,
      intent,
      quizQuestions: quizSession.questions,
      quizIndex: quizSession.currentIndex,
      quizTotal: quizSession.total,
      quizMode: quizSession.mode,
      quizKind: quizSession.kind,
      confidence: "high",
    };
  };

  // Panel quiz pending: never hijack the turn and never clear the session —
  // the answer key must stay live in history until the panel Submit (Path QP)
  // grades it. Opt-out still ends it; an explicit "ask me in chat" request
  // switches to the turn-by-turn chat fallback.
  if (quizSession.mode === "panel") {
    if (isQuizOptOut(message)) {
      return {
        intentResult: bindQuiz("quiz_skip"),
        clearQuizOnResponse: false,
      };
    }
    if (isExplicitQuizRequest(message)) {
      return {
        intentResult: bindQuiz("quiz_answer"),
        clearQuizOnResponse: false,
      };
    }
    return { intentResult, clearQuizOnResponse: false };
  }

  // Only a Bible reference typed in this user turn abandons the quiz.
  if (extractReferenceInfo(message)) {
    return { intentResult, clearQuizOnResponse: true };
  }

  if (isQuizOptOut(message)) {
    return { intentResult: bindQuiz("quiz_skip"), clearQuizOnResponse: false };
  }

  if (
    quizSession.currentIndex === 0 &&
    (contextualAffirmative ||
      contextualContinuation ||
      isExplicitQuizRequest(message) ||
      isAffirmativeMessage(message) ||
      isContinuationMessage(message))
  ) {
    return {
      intentResult: bindQuiz("quiz_answer"),
      clearQuizOnResponse: false,
    };
  }

  // In-progress quiz (Q1+): continue Path Q through remaining questions unless
  // the user opts out (above), names a new Bible ref (above), or clearly
  // changes topic away from answering.
  if (quizSession.currentIndex > 0) {
    if (isQuizTopicChange(message) && !looksLikeQuizAnswer(message)) {
      return { intentResult, clearQuizOnResponse: true };
    }
    return {
      intentResult: bindQuiz("quiz_answer"),
      clearQuizOnResponse: false,
    };
  }

  if (isQuizRoutingIntent(intentResult.intent)) {
    // Already on Path Q from classifyIntent — keep it, drop any spurious ref.
    return {
      intentResult: bindQuiz(intentResult.intent),
      clearQuizOnResponse: false,
    };
  }

  // Offer ignored (idx 0, non-affirmative) — end quiz session.
  return { intentResult, clearQuizOnResponse: true };
}

// ---------------------------------------------------------------------------
// Sticky checking session (Pedir revisión / draft-check)
// ---------------------------------------------------------------------------

export type CheckingSession = {
  reference: string;
};

/** Hidden sticky-checking marker (not shown in UI). */
export function buildCheckingSessionMarker(reference: string): string {
  const ref = reference.trim().replace(/\s+/g, " ");
  return `<!-- CHECKING:${ref} -->`;
}

/** Terminal clear — ends sticky checking for later turns. */
export function buildCheckingClearedMarker(): string {
  return `<!-- CHECKING:cleared -->`;
}

/**
 * Scan history (most recent first) for an active <!-- CHECKING:REF --> marker.
 * A more-recent <!-- CHECKING:cleared --> ends the session.
 */
export function extractCheckingFromHistory(
  history: ConversationMessage[] | undefined,
): CheckingSession | null {
  if (!history?.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    if (/<!--\s*CHECKING:cleared\s*-->/i.test(msg.content)) return null;
    const m = msg.content.match(/<!--\s*CHECKING:([^>]+?)\s*-->/i);
    if (!m) continue;
    const reference = m[1].trim().replace(/\s+/g, " ");
    if (!reference || /^cleared$/i.test(reference)) continue;
    return { reference };
  }
  return null;
}

/** User declines remaining check questions. */
export function isCheckingOptOut(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (
    /^(skip|stop|pass|no|no thanks|no thank you|not now|mejor no|omitir|saltar|no gracias|no por ahora|parar|detener|ya no|basta)\s*[.!]?\s*$/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  return /\b(stop\s+(the\s+)?(check|checking|review)|no\s+more\s+(check|checking|review|questions)|terminar\s+(la\s+)?revisi[oó]n|ya\s+no\s+(quiero\s+)?(revis(ar|i[oó]n)|preguntas)|omitir\s+(la\s+)?revisi[oó]n|saltar\s+(la\s+)?revisi[oó]n)\b/i.test(
    trimmed,
  );
}

/**
 * Clear topic change away from checking (resource / methodology / new work).
 * Does NOT treat Pedir revisión / ready-for-check as a topic change.
 */
export function isCheckingTopicChange(message: string): boolean {
  const lower = message.toLowerCase();

  if (
    /\b(qué debo|que debo|what should i|how (?:do|should) i (?:start|begin)|ahora qué|ahora que|por dónde|por donde)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (
    /\b(nota|notas|notes?|término|termino|terms?|palabra|article|artículo|articulo|translation notes?|\btn\b|\btw\b|\bta\b)\b/i.test(
      lower,
    ) &&
    /\b(revisar|ver|mostrar|muéstrame|muestrame|show|look|leer|sobre|about|quiero|prefiero|dame|give|open|abrir)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (isWordArticleRequest(message)) return true;

  if (
    /\b(figure of speech|figures of speech|translation strateg(?:y|ies)|how (?:do|should) i translate|cómo (?:debo|puedo) traducir|mientras redacto|while (?:i\s+)?draft)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (DISCOVERY_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  return false;
}

/** True when intent is sticky checking (must not be stolen by passage bind). */
export function isCheckingRoutingIntent(
  intent: IntentType | undefined,
): boolean {
  return intent === "checking";
}

/**
 * After contextual LLM flags / study-ref composition, re-assert checking when
 * a CHECKING session marker is live. Abandon on new Bible ref in the *user*
 * message, explicit opt-out, clear topic change, or Study/Translate mode intent.
 */
export function reinforceCheckingSession(args: {
  message: string;
  intentResult: IntentResult;
  history: ConversationMessage[] | undefined;
}): { intentResult: IntentResult; clearCheckingOnResponse: boolean } {
  const { message, history } = args;
  const intentResult = args.intentResult;
  const session = extractCheckingFromHistory(history);
  if (!session) {
    return { intentResult, clearCheckingOnResponse: false };
  }

  // Checklist-item click — deterministic panel action stays on checking for
  // this session's passage (title text must never look like a topic change).
  if (parseCheckItemFromMessage(message)) {
    return {
      intentResult: {
        ...intentResult,
        intent: "checking",
        reference: intentResult.reference ?? session.reference,
        confidence: "high",
      },
      clearCheckingOnResponse: false,
    };
  }

  // Explicit Study / Translate mode request ends sticky checking so the coach
  // can honor the new mode (NL: "let's study first" / UI mode sync).
  const modeIntent = detectWorkflowModeIntent(message);
  if (modeIntent === "study" || modeIntent === "translate") {
    return {
      intentResult:
        intentResult.intent === "checking"
          ? {
              ...intentResult,
              intent: "open_ended",
              confidence: "medium",
            }
          : intentResult,
      clearCheckingOnResponse: true,
    };
  }

  // Explicit draft-check / difficulty stay on checking (may refresh reference).
  if (detectDraftSubmitIntent(message) || detectDifficultyFollowUp(message)) {
    const refInfo = extractReferenceInfo(message);
    return {
      intentResult: {
        ...intentResult,
        intent: "checking",
        reference: refInfo?.ref ?? session.reference,
        confidence: "high",
      },
      clearCheckingOnResponse: false,
    };
  }

  const refInMessage = extractReferenceInfo(message);
  if (refInMessage) {
    // New passage named in this turn — leave checking for that passage only if
    // it matches; otherwise abandon sticky checking.
    const same =
      refInMessage.ref.replace(/\s+/g, " ").toUpperCase() ===
      session.reference.replace(/\s+/g, " ").toUpperCase();
    if (same) {
      return {
        intentResult: {
          ...intentResult,
          intent: "checking",
          reference: session.reference,
          confidence: "high",
        },
        clearCheckingOnResponse: false,
      };
    }
    return { intentResult, clearCheckingOnResponse: true };
  }

  if (isCheckingOptOut(message)) {
    return { intentResult, clearCheckingOnResponse: true };
  }

  if (isCheckingTopicChange(message)) {
    return { intentResult, clearCheckingOnResponse: true };
  }

  // Stick: validation answers, short affirmatives, continuations, etc.
  return {
    intentResult: {
      ...intentResult,
      intent: "checking",
      reference: session.reference,
      confidence: "high",
    },
    clearCheckingOnResponse: false,
  };
}

/**
 * Ensure a checking reply carries the sticky session marker (and optionally
 * a cleared marker). Preserves any existing CHECKING footer.
 */
export function ensureCheckingSessionFooter(
  response: string,
  reference: string,
  opts?: { cleared?: boolean },
): string {
  const base = response.trimEnd();
  if (opts?.cleared) {
    if (/<!--\s*CHECKING:cleared\s*-->/i.test(base)) return base;
    // Drop a live session marker when clearing.
    const withoutLive = base
      .replace(/\n?<!--\s*CHECKING:(?!cleared)[^>]*-->\s*/gi, "\n")
      .trimEnd();
    return `${withoutLive}\n${buildCheckingClearedMarker()}`;
  }
  if (/<!--\s*CHECKING:/i.test(base)) return base;
  const ref = reference.trim();
  if (!ref) return base;
  return `${base}\n${buildCheckingSessionMarker(ref)}`;
}

/**
 * Scan conversation history (most recent first) for a <!-- QUIZ:idx/total [...] -->
 * marker. Returns the parsed quiz session, or null.
 *
 * Marker format (embedded by ContextHarness / Path Q, not shown in UI):
 *   <!-- QUIZ:0/4 [{"q":"...","a":"..."},...] -->              (chat offer)
 *   <!-- QUIZ:panel/4 [{"q":"...","a":"..."},...] -->          (panel, context)
 *   <!-- QUIZ:panel/4:passage [{"q":"...","a":"..."},...] -->  (panel, practice)
 *   <!-- QUIZ:panel/4:practice [...] -->
 * Terminal clear (ends the session):
 *   <!-- QUIZ:cleared -->
 */
export function extractQuizFromHistory(
  history: ConversationMessage[] | undefined,
): QuizSession | null {
  if (!history?.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    // A more-recent cleared marker means the quiz session is over.
    if (/<!-- QUIZ:cleared -->/.test(msg.content)) return null;
    // Match through the first ` -->` after the header so `]` inside question
    // strings cannot truncate the JSON payload. Optional `:kind` suffix.
    const m = msg.content.match(
      /<!-- QUIZ:(\d+|panel)\/(\d+)(?::(context|passage|practice))? ([\s\S]*?) -->/,
    );
    if (!m) continue;
    try {
      const questions = JSON.parse(m[4]) as QuizItem[];
      if (!Array.isArray(questions) || questions.length === 0) continue;
      const mode = m[1] === "panel" ? ("panel" as const) : ("chat" as const);
      const currentIndex = mode === "panel" ? 0 : parseInt(m[1], 10);
      const total = parseInt(m[2], 10) || questions.length;
      const kind = parseQuizKind(m[3]);
      return { questions, currentIndex, total, mode, kind };
    } catch {
      continue;
    }
  }
  return null;
}

/** Hidden checklist progress marker (not shown in UI). */
export function buildChecklistMarker(step: number, total: number): string {
  return `<!-- CHECKLIST:${step}/${total} -->`;
}

/** Hidden batch-continuation marker (not shown in UI). */
export function buildBatchMarker(nextRef: string): string {
  return `<!-- BATCH:${nextRef} -->`;
}

/**
 * Scan conversation history (most recent first) for a session footer.
 *
 * Preference order (most recent assistant turn):
 *   1. <!-- QUIZ:idx/total [...] -->
 *   2. <!-- CHECKLIST:step/total -->  (preferred)
 *   3. legacy *[Step N/M]* footer
 *   4. <!-- BATCH:ref -->  (preferred)
 *   5. legacy *Say "next" for REF*
 */
export function extractSessionContext(
  history: ConversationMessage[],
): SessionContext {
  // Quiz (incl. cleared-marker authority) — highest priority so answers don't
  // advance a checklist while a quiz offer or in-progress quiz is active.
  const activeQuiz = extractQuizFromHistory(history);
  if (activeQuiz) {
    return { type: "quiz", ...activeQuiz };
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;

    // Preferred: hidden checklist marker
    const checklistHidden = msg.content.match(
      /<!-- CHECKLIST:(\d+)\/(\d+) -->/,
    );
    if (checklistHidden) {
      return {
        type: "checklist",
        currentStep: parseInt(checklistHidden[1], 10),
        totalSteps: parseInt(checklistHidden[2], 10),
      };
    }

    // Legacy visible footer: [Step N/M] (localized Step synonyms too)
    const checklistMatch = msg.content.match(
      /\[(?:Step|Paso|Étape|Etape)\s*(\d+)\s*\/\s*(\d+)\]/i,
    );
    if (checklistMatch) {
      return {
        type: "checklist",
        currentStep: parseInt(checklistMatch[1]),
        totalSteps: parseInt(checklistMatch[2]),
      };
    }

    // Preferred: hidden batch marker
    const batchHidden = msg.content.match(
      /<!-- BATCH:([A-Z0-9]+ \d+:\d+(?:-\d+)?) -->/i,
    );
    if (batchHidden?.[1]) {
      return { type: "batch", nextRef: batchHidden[1] };
    }

    // Legacy batch footer: Say "next" for JHN 3:5-8
    const batchMatch = msg.content.match(
      /Say "next" for ([A-Z0-9]+ \d+:\d+(?:-\d+)?)/i,
    );
    if (batchMatch?.[1]) {
      return { type: "batch", nextRef: batchMatch[1] };
    }
  }
  return null;
}

/** Convenience wrapper — returns the next batch reference, or null. */
export function extractNextBatchFromHistory(
  history: ConversationMessage[],
): string | null {
  const ctx = extractSessionContext(history);
  return ctx?.type === "batch" ? ctx.nextRef : null;
}

/**
 * Scan history (most recent first) for a CHALLENGES comment embedded by the
 * annotated_passage handler. Returns the parsed Challenge array or null.
 *
 * Footer format (embedded by ContextHarness, not shown in UI):
 *   <!-- CHALLENGES:N [{"index":1,"phrase":"born again","verse":"3",...},...] -->
 */
export function extractChallengesFromHistory(
  history: ConversationMessage[],
): ChallengeEntry[] | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    const m = msg.content.match(/<!-- CHALLENGES:\d+ (\[.*?\]) -->/s);
    if (m?.[1]) {
      try {
        return JSON.parse(m[1]) as ChallengeEntry[];
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Minimal shape needed for phrase-drill detection.
 * Full Challenge type is defined in PassageAnnotator.ts.
 */
export interface ChallengeEntry {
  index: number;
  verse: string;
  phrase: string;
  noteText: string;
  /** Verbatim TN note body text (≤300 chars) — cited directly in phrase_drill. */
  rawNoteText?: string;
  /** Original-language `quote` field from the TSV — connects phrase to source. */
  rawQuote?: string;
  category: string;
  /** "tn" = translation note, "tw" = key term */
  sourceType?: "tn" | "tw";
  supportReference?: string;
  wordPath?: string;
  at?: string;
}

// ---------------------------------------------------------------------------
// Term extraction
// ---------------------------------------------------------------------------

function extractTerm(message: string): string | null {
  const quotedMatch = message.match(/["«»„“]([^"«»„“]+)["«»„“]|'([^']+)'/);
  if (quotedMatch) {
    return (
      (quotedMatch[1] ?? quotedMatch[2] ?? "").trim().toLowerCase() || null
    );
  }
  const articleMatch = message.match(
    /\b(?:artículo|articulo|article)\s+(?:de\s+)?(?:tw|translation\s+words?)?\s*(?:sobre|de|del|para|about|on|for)\s+["']?([^\s"'¿?.,:;]+)["']?/i,
  );
  if (articleMatch?.[1]) return articleMatch[1].toLowerCase();
  const esTermMatch = message.match(
    /\b(?:palabra|término|termino|significado\s+de|definición\s+de|definicion\s+de)\s+["']?([^\s"'¿?.,:;]+)["']?/i,
  );
  if (esTermMatch?.[1]) return esTermMatch[1].toLowerCase();
  const phraseMatch = message.match(
    /\b(?:meaning\s+of|define|definition\s+of|word\s+for|the\s+word|what\s+(?:does|is|are)\s+(?:the\s+)?(?:word\s+)?)\s*(\w+)/i,
  );
  if (phraseMatch) return phraseMatch[1].toLowerCase();
  return null;
}

/** True when the user is explicitly asking for a TW / word article. */
export function isWordArticleRequest(message: string): boolean {
  const lower = message.toLowerCase();
  if (TW_ARTICLE_REQUEST_RE.test(message)) return true;
  // "artículo … siervo" / "article … servant" with a recoverable term
  if (
    /\b(?:artículo|articulo|article)\b/i.test(lower) &&
    extractTerm(message)
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// LLM-based phrase-drill resolver
// ---------------------------------------------------------------------------

/**
 * Use a small, non-streaming LLM call to decide which challenge (if any) the
 * user is referring to in their message.  This replaces the brittle regex/fuzzy
 * approach and correctly handles connector words like "So why is 'world' a
 * metonymy?" — the LLM understands that "So" is a sentence connector, not a
 * reference to a challenge labelled "so".
 *
 * @param userMessage   The raw user message.
 * @param challenges    Active challenges extracted from conversation history.
 * @param recentHistory Last few conversation turns (for context).
 * @param llm           The LLM provider — called with maxTokens=10, temperature=0.
 * @returns The matching ChallengeEntry, or null if the user is not selecting a challenge.
 */
export async function resolvePhraseDrillIntent(
  userMessage: string,
  challenges: ChallengeEntry[],
  recentHistory: ConversationMessage[],
  llm: LLMProvider,
): Promise<ChallengeEntry | null> {
  // Build a compact numbered list of challenges (phrase + brief description).
  const challengeList = challenges
    .map(
      (c) =>
        `${c.index}. "${c.phrase ?? ""}" — ${(c.noteText ?? "").slice(0, 80)}`,
    )
    .join("\n");

  // Include the last 1–2 assistant + user turns as context, stripping hidden
  // HTML comments so the prompt stays compact.
  const contextTurns = recentHistory
    .slice(-4)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map(
      (m) =>
        `${m.role.toUpperCase()}: ${(m.content ?? "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .trim()
          .slice(0, 300)}`,
    )
    .join("\n");

  const systemPrompt = `You are a routing assistant for a Bible translation coaching tool.
Your only task: decide whether the user's message is selecting one of the numbered translation challenges listed below, and if so, which one.

CHALLENGES:
${challengeList}

RECENT CONVERSATION:
${contextTurns}

Rules:
- Reply with ONLY a single number (e.g. "3") if the user is clearly picking or asking about that specific challenge phrase.
- Reply with "none" if the user is asking a general follow-up question, continuing the conversation, or if the match is ambiguous.
- Short connector words at the start of a sentence (e.g. "So", "Well", "Now") are NOT challenge selections.`;

  let raw: string;
  try {
    raw = await llm.generate(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { maxTokens: 10, temperature: 0 },
    );
  } catch {
    // If the LLM call fails, fall through — treat as non-selection.
    return null;
  }

  const trimmed = raw.trim();
  if (/^none$/i.test(trimmed)) return null;

  const numMatch = trimmed.match(/^(\d{1,2})/);
  if (!numMatch) return null;

  const idx = parseInt(numMatch[1], 10);
  return challenges.find((c) => c.index === idx) ?? null;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify the user's intent. Accepts optional conversation history for
 * continuation detection.
 */
export function classifyIntent(
  message: string,
  history?: ConversationMessage[],
): IntentResult {
  const lower = message.toLowerCase();

  // 0a. Language answer — user is replying to the language-gate prompt
  if (history && hasAwaitingLang(history)) {
    const pending = extractPending(history);
    if (pending) {
      return {
        intent: "language_answer",
        pendingRef: pending.ref,
        pendingIntent: pending.intent as IntentType,
        confidence: "high",
      };
    }
  }

  // 0b. Warm confirmation — user replied "yes" / "yes please" / "go ahead" to a warm-gate offer
  if (history) {
    const warmup = extractWarmup(history);
    if (
      warmup &&
      (isAffirmativeMessage(message) || isContinuationMessage(message))
    ) {
      return {
        intent: warmup.intent as IntentType,
        reference: warmup.ref,
        warmConfirmed: true,
        confidence: "high",
      };
    }
  }

  // 0b2. Checklist-item click — deterministic <!-- CHECKITEM:kind:id --> marker
  // from the resources-panel Checking checklist. Always routes to checking
  // scoped to that item (wins over quiz / sticky sessions — explicit UI action).
  if (parseCheckItemFromMessage(message)) {
    const clickRef = extractReferenceInfo(message);
    const sticky = history ? extractCheckingFromHistory(history) : null;
    return {
      intent: "checking",
      reference: clickRef?.ref ?? sticky?.reference,
      confidence: "high",
    };
  }

  // 0c. Context quiz — active <!-- QUIZ:idx/total --> marker.
  // A new Bible reference, explicit opt-out, or clear non-answer topic change
  // abandons the quiz (fall through). Only answer-like utterances grade.
  if (history) {
    const quiz = extractQuizFromHistory(history);
    if (quiz) {
      const refDuringQuiz = extractReferenceInfo(message);
      if (!refDuringQuiz) {
        if (isQuizOptOut(message)) {
          return {
            intent: "quiz_skip",
            quizQuestions: quiz.questions,
            quizIndex: quiz.currentIndex,
            quizTotal: quiz.total,
            quizMode: quiz.mode,
            quizKind: quiz.kind,
            confidence: "high",
          };
        }
        // Panel quiz pending: chat turns are handled normally (the panel owns
        // the questions). Only an explicit "ask me in chat" request switches
        // to the turn-by-turn chat fallback.
        if (quiz.mode === "panel") {
          if (isExplicitQuizRequest(message)) {
            return {
              intent: "quiz_answer",
              quizQuestions: quiz.questions,
              quizIndex: 0,
              quizTotal: quiz.total,
              quizMode: "panel",
              quizKind: quiz.kind,
              confidence: "high",
            };
          }
          // fall through — do NOT hijack this message into Path Q.
        }
        // Offer pending (idx 0): start on affirmative / continuation / explicit
        // quiz opt-in ("sí, hagamos el chequeo"). Other messages abandon.
        else if (quiz.currentIndex === 0) {
          if (
            isAffirmativeMessage(message) ||
            isContinuationMessage(message) ||
            isExplicitQuizRequest(message)
          ) {
            return {
              intent: "quiz_answer",
              quizQuestions: quiz.questions,
              quizIndex: quiz.currentIndex,
              quizTotal: quiz.total,
              quizMode: quiz.mode,
              quizKind: quiz.kind,
              confidence: "high",
            };
          }
        } else if (
          // In progress — continue to the next question unless the user clearly
          // changes topic (resource request / drafting question). Normal answers
          // (including ones that mention "check"/"accurate"/etc.) stay on Path Q.
          !(isQuizTopicChange(message) && !looksLikeQuizAnswer(message))
        ) {
          return {
            intent: "quiz_answer",
            quizQuestions: quiz.questions,
            quizIndex: quiz.currentIndex,
            quizTotal: quiz.total,
            quizMode: quiz.mode,
            quizKind: quiz.kind,
            confidence: "high",
          };
        }
      }
    }
  }

  // 0d. Sticky checking — active <!-- CHECKING:REF --> after Pedir revisión.
  // Stay on checking for validation answers until complete / opt-out / topic
  // change / Study|Translate mode intent. A new Bible reference in the user
  // message abandons (fall through) unless it is the same passage (handled
  // via draft-submit / reinforce).
  if (history) {
    const checking = extractCheckingFromHistory(history);
    if (checking) {
      const refDuringCheck = extractReferenceInfo(message);
      const modeLeave = detectWorkflowModeIntent(message);
      const leavingForStudyOrTranslate =
        modeLeave === "study" || modeLeave === "translate";
      if (
        !refDuringCheck &&
        !isCheckingOptOut(message) &&
        !isCheckingTopicChange(message) &&
        !leavingForStudyOrTranslate
      ) {
        return {
          intent: "checking",
          reference: checking.reference,
          confidence: "high",
        };
      }
    }
  }

  // 1a. Phrase-drill detection — user picks a challenge from an annotated passage
  if (history) {
    const challenges = extractChallengesFromHistory(history);
    if (challenges && challenges.length > 0) {
      // Check if message is a 1-based number
      const numMatch = message.trim().match(/^(\d{1,2})\.?$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1]);
        const challenge = challenges.find((c) => c.index === idx);
        if (challenge) {
          return {
            intent: "phrase_drill",
            challengeIndex: idx,
            challengePhrase: challenge.phrase,
            confidence: "high",
          };
        }
      }
      // Non-numeric phrase selection is resolved by the LLM in ContextHarness
      // (see resolvePhraseDrillIntent below). Nothing more to do here.
    }
  }

  // 1b. Checklist step jump ("paso 3", "step 2", "étape 4") — before bare "next"
  if (history) {
    const stepJumpMatch = message
      .trim()
      .match(/\b(?:paso|step|étape)\s*(\d{1,2})\b/i);
    if (stepJumpMatch) {
      const ctx = extractSessionContext(history);
      if (ctx?.type === "checklist") {
        const jump = parseInt(stepJumpMatch[1], 10);
        if (jump >= 1 && jump <= ctx.totalSteps) {
          return {
            intent: "checklist_step",
            nextStep: jump,
            totalSteps: ctx.totalSteps,
            confidence: "high",
          };
        }
      }
    }
  }

  // 1c. Checklist / batch continuation
  if (history && isContinuationMessage(message)) {
    const ctx = extractSessionContext(history);
    if (ctx?.type === "checklist") {
      // Advancing through a guided checklist session
      const nextStep = ctx.currentStep + 1;
      if (nextStep <= ctx.totalSteps) {
        return {
          intent: "checklist_step",
          nextStep,
          totalSteps: ctx.totalSteps,
          confidence: "high",
        };
      }
      // All steps done — fall through to normal classification
    } else if (ctx?.type === "batch") {
      return {
        intent: "passage_help",
        reference: ctx.nextRef,
        continuationRef: ctx.nextRef,
        confidence: "high",
      };
    }
  }

  // 2. Draft submit / difficulty follow-up — before reference routing so
  // "aquí está mi borrador de Tito 1:1" coaches the draft instead of re-annotating.
  const refInfo = extractReferenceInfo(message);
  if (detectDraftSubmitIntent(message) || detectDifficultyFollowUp(message)) {
    return {
      intent: "checking",
      reference: refInfo?.ref,
      isLargeRange: refInfo?.isLargeRange,
      confidence: "high",
    };
  }

  // 3. Bible reference detection
  if (refInfo) {
    // Large range (whole chapter, 5+ verses) → overview checklist
    // Short range / single verse → annotated passage
    const intent: IntentType = refInfo.isLargeRange
      ? "passage_overview"
      : "annotated_passage";
    return {
      intent,
      reference: refInfo.ref,
      isLargeRange: refInfo.isLargeRange,
      confidence: "high",
    };
  }

  // 4. Discovery
  if (DISCOVERY_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { intent: "discovery", confidence: "high" };
  }

  // 5. Checking (keyword cues without an explicit draft-submit phrase)
  if (CHECKING_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { intent: "checking", confidence: "medium" };
  }

  // 6. Methodology
  if (METHODOLOGY_KEYWORDS.some((kw) => lower.includes(kw))) {
    let taTopic: string | undefined;
    for (const [pattern, slug] of METHODOLOGY_SLUG_MAP) {
      if (pattern.test(lower)) {
        taTopic = slug;
        break;
      }
    }
    return { intent: "methodology", taTopic, confidence: "high" };
  }

  // 7. Word study (explicit TW article requests + keyword / term cues)
  if (
    isWordArticleRequest(message) ||
    WORD_STUDY_KEYWORDS.some((kw) => lower.includes(kw))
  ) {
    const term = extractTerm(message);
    return {
      intent: "word_study",
      term: term ?? undefined,
      confidence: isWordArticleRequest(message) ? "high" : "medium",
    };
  }

  // 7. Fallback
  return { intent: "open_ended", confidence: "low" };
}
