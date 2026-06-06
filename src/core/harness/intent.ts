/**
 * Intent classifier for the context harness.
 *
 * Classifies a user message into one of:
 *   passage_overview    — large range (whole chapter, many verses) → orientation first
 *   annotated_passage   — short verse range (< LARGE_RANGE_THRESHOLD) → annotated text + challenge list
 *   passage_help        — fallback for verse ranges (kept for batch-continuation)
 *   phrase_drill        — user selected a specific challenge phrase to explore
 *   checklist_step      — advancing through a guided checklist session
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
 */

import { parseReferenceForTool } from "../resources/referenceParser.js";
import type { LLMProvider } from "../rag/providers/LLMProvider.js";

import {
  extractPending,
  hasAwaitingLang,
  extractWarmup,
  isAffirmative,
} from "./warmup.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentType =
  | "passage_overview"
  | "annotated_passage"   // short verse range → annotated text + challenge buttons
  | "passage_help"
  | "phrase_drill"        // user selected a specific challenge to explore
  | "checklist_step"      // advancing through a guided checklist session
  | "word_study"
  | "methodology"
  | "checking"
  | "discovery"
  | "open_ended"
  | "language_answer";    // user is replying to the language-gate prompt

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
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA",
  "1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO",
  "ECC","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO",
  "OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL",
  "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH",
  "PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS",
  "1PE","2PE","1JN","2JN","3JN","JUD","REV",
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
  "what does", "meaning of", "define", "definition",
  "what is", "word for", "term", "translate the word",
  "how to translate", "biblical term", "word study",
];

// TODO(llm-intent): Same concern as WORD_STUDY_KEYWORDS — keyword list on free-form text.
// Kept on sync path for now to avoid blocking first token.
const METHODOLOGY_KEYWORDS = [
  "figure of speech", "figures of speech", "metaphor", "simile",
  "how do i translate", "how should i translate", "how to handle",
  "translation strategy", "translation strategies", "academy",
  "passive voice", "rhetorical question", "pronoun", "idiom",
  "hyperbole", "metonymy", "euphemism", "abstraction",
  "inclusive language", "unknown", "culture", "cultural",
];

// TODO(llm-intent): Same concern as WORD_STUDY_KEYWORDS — keyword list on free-form text.
// Kept on sync path for now to avoid blocking first token.
const CHECKING_KEYWORDS = [
  "check", "verify", "comprehension question", "translation question",
  "is my translation", "did i get it right", "accurate",
];

// TODO(llm-intent): Same concern as WORD_STUDY_KEYWORDS — keyword list on free-form text.
// Kept on sync path for now to avoid blocking first token.
const DISCOVERY_KEYWORDS = [
  "available languages", "list languages", "what languages",
  "available resources", "list resources", "what resources",
  "which languages", "which resources", "does it support",
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
  [/metaphor/i,               "translate/figs-metaphor"],
  [/simile/i,                 "translate/figs-simile"],
  [/passive\s+voice/i,        "translate/figs-activepassive"],
  [/rhetorical\s+question/i,  "translate/figs-rquestion"],
  [/euphemism/i,              "translate/figs-euphemism"],
  [/hyperbole/i,              "translate/figs-hyperbole"],
  [/metonymy/i,               "translate/figs-metonymy"],
  [/synecdoche/i,             "translate/figs-synecdoche"],
  [/abstract/i,               "translate/figs-abstractnouns"],
  [/pronoun/i,                "translate/figs-pronouns"],
  [/translation\s+notes/i,    "intro/translation-notes-intro"],
  [/check.*accurac/i,         "checking/accuracy"],
  [/unknown/i,                "translate/translate-unknown"],
  [/names?/i,                 "translate/translate-names"],
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
export function extractReferenceInfo(message: string): ExtractedReference | null {
  const words = message.split(/\s+/);

  for (let i = 0; i < words.length - 1; i++) {
    for (const len of [2, 3]) {
      // Strip trailing punctuation so "Titus 2:12?" or "John 3:16." are recognised
      const candidate = words.slice(i, i + len).join(" ").replace(/[.!?,;:]+$/, "");
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
        parseInt(parsed.verseEnd) - parseInt(parsed.verseStart) + 1 >= LARGE_RANGE_THRESHOLD;

      return { ref, isLargeRange: !!(wholeChapter || wideVerseRange) };
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
  | null;

/**
 * Scan conversation history (most recent first) for a session footer.
 *
 * Batch footer (appended by ContextHarness):
 *   *Say "next" for JHN 3:5-8*
 *
 * Checklist footer (produced by orchestrator + appended by harness):
 *   *[Step 2/5] — Say "next" when ready to continue.*
 */
export function extractSessionContext(
  history: ConversationMessage[],
): SessionContext {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;

    // Checklist footer: [Step N/M]
    const checklistMatch = msg.content.match(/\[Step (\d+)\/(\d+)\]/i);
    if (checklistMatch) {
      return {
        type: "checklist",
        currentStep: parseInt(checklistMatch[1]),
        totalSteps: parseInt(checklistMatch[2]),
      };
    }

    // Batch footer: Say "next" for JHN 3:5-8
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
  const quotedMatch = message.match(/["']([^"']+)["']/);
  if (quotedMatch) return quotedMatch[1].trim().toLowerCase();
  const phraseMatch = message.match(
    /\b(?:meaning\s+of|define|definition\s+of|word\s+for|the\s+word)\s+(\w+)/i,
  );
  if (phraseMatch) return phraseMatch[1].toLowerCase();
  return null;
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
    .map((c) => `${c.index}. "${c.phrase}" — ${c.noteText.slice(0, 80)}`)
    .join("\n");

  // Include the last 1–2 assistant + user turns as context, stripping hidden
  // HTML comments so the prompt stays compact.
  const contextTurns = recentHistory
    .slice(-4)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map(
      (m) =>
        `${m.role.toUpperCase()}: ${m.content
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
    if (warmup && (isAffirmative(message) || isContinuationMessage(message))) {
      return {
        intent: warmup.intent as IntentType,
        reference: warmup.ref,
        warmConfirmed: true,
        confidence: "high",
      };
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

  // 1b. Checklist / batch continuation
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

  // 2. Bible reference detection
  const refInfo = extractReferenceInfo(message);
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

  // 3. Discovery
  if (DISCOVERY_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { intent: "discovery", confidence: "high" };
  }

  // 4. Checking
  if (CHECKING_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { intent: "checking", confidence: "medium" };
  }

  // 5. Methodology
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

  // 6. Word study
  if (WORD_STUDY_KEYWORDS.some((kw) => lower.includes(kw))) {
    const term = extractTerm(message);
    return {
      intent: "word_study",
      term: term ?? undefined,
      confidence: "medium",
    };
  }

  // 7. Fallback
  return { intent: "open_ended", confidence: "low" };
}
