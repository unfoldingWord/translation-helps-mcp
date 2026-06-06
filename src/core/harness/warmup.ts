/**
 * warmup.ts — Warm-gate, language-gate, and profile helpers.
 *
 * Hidden HTML markers (follow the <!-- CHALLENGES:... --> pattern):
 *   <!-- WARMUP:<ref>|<intent> -->        warm-gate offer is pending
 *   <!-- LANG:<code> -->                  strategic language confirmed for session
 *   <!-- AWAITING_LANG -->                waiting for user to name a language
 *   <!-- PENDING_PASSAGE:<ref>|<intent> --> passage request that needs language first
 *   <!-- NAME_INVITED -->                 name invite has already been sent this session
 *
 * These markers are stored verbatim in the assistant turn content so they
 * round-trip through the UI and the conversation history on the next POST.
 */

import type { ConversationMessage } from "./intent.js";

// ---------------------------------------------------------------------------
// Affirmative / name detection
// ---------------------------------------------------------------------------

// TODO(llm-intent): AFFIRMATIVE_RE is a large multilingual keyword list on free-form user
// text. It will miss affirmatives in languages not enumerated here and can produce false
// positives (e.g. "absolute" matching "absolutely"). However, isAffirmative() is called
// inside the synchronous classifyIntent() (step 0b, warm-gate confirmation), which runs
// before the first streamed token, so replacing it with an LLM call would add cold-start
// latency. The streaming path in skillChat.ts already uses resolveContextual() (LLM) to
// detect affirmative intent for messages ≤ 120 chars and overrides the warm-gate there.
// This regex serves as the fast fallback for the non-streaming answer() path.
const AFFIRMATIVE_RE =
  /^(yes|yep|yeah|yup|ok|okay|sure|go ahead|show me|do it|please|let'?s go|sounds good|absolutely|of course|definitely|great|alright|y|👍|s[ií]|claro|por supuesto|adelante|dale|vamos|perfecto|exacto|s[ií] por favor|claro que s[ií]|sim|pode|com certeza|sim por favor|tá bom|tudo bien|vamos lá|oui|bien s[uû]r|d'accord|allez|parfait|absolument|ja|natürlich|klar|gerne|jawohl|ya|iya|baik|silakan|نعم|بله|да|好的|はい)\s*[.!]?$/i;

/**
 * True if the message is a plain affirmative reply ("yes", "ok", "sure", etc.).
 * Deliberately distinct from isContinuationMessage ("next"/"continue").
 */
export function isAffirmative(message: string): boolean {
  return AFFIRMATIVE_RE.test(message.trim());
}

// TODO(llm-intent): NAME_RE only matches English "call me / I'm / my name is" patterns.
// It misses introductions in other languages ("me llamo X", "je m'appelle X", etc.).
// The streaming path in skillChat.ts already supersedes this via resolveContextual() (LLM),
// which returns extractedName for all languages. extractName() is kept here for the
// non-streaming answer() path and any callers outside skillChat.ts.
const NAME_RE =
  /(?:call me|i'?m|my name is|name'?s|you can call me)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'-]{0,30})/i;

/**
 * Best-effort extraction of a user's preferred name from a message.
 * Returns the name string or null if not found.
 * Note: For the streaming path, resolveContextual() (LLM) is used instead.
 */
export function extractName(message: string): string | null {
  const match = NAME_RE.exec(message);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Warm-gate decision
// ---------------------------------------------------------------------------

import type { IntentResult } from "./intent.js";

const WARM_INTENTS = new Set([
  "annotated_passage",
  "passage_overview",
  "checking",
  "passage_help",
]);

/**
 * True when we should offer a warm-gate confirmation for this passage request.
 *
 * Conditions:
 *   - intent is one of the passage-fetch intents
 *   - there is a detected reference
 *   - warmConfirmed is NOT already set on this turn (user just said "yes")
 *   - the MOST RECENT assistant turn is not already a warmup offer for the same ref
 *     (prevents re-offering on the very next turn, but allows re-offering if the
 *     user sent an intervening message that moved the conversation forward)
 */
export function shouldOfferWarmup(
  intentResult: IntentResult,
  history: ConversationMessage[],
): boolean {
  if (!WARM_INTENTS.has(intentResult.intent)) return false;
  if (!intentResult.reference) return false;
  if ((intentResult as { warmConfirmed?: boolean }).warmConfirmed) return false;

  // Only skip if the IMMEDIATELY preceding assistant turn is a warm offer for this ref.
  // If there's been any intervening turn (user asked something else), offer again.
  const lastTurn = lastAssistantTurn(history);
  if (lastTurn) {
    const match = /<!-- WARMUP:([^|]+)\|/.exec(lastTurn.content);
    if (match && match[1] === intentResult.reference) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

/** Returns the most recent assistant turn, or null. */
function lastAssistantTurn(history: ConversationMessage[]): ConversationMessage | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") return history[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// WARMUP marker
// ---------------------------------------------------------------------------

export interface WarmupMarker {
  ref: string;
  intent: string;
}

export function buildWarmupMarker(ref: string, intent: string): string {
  return `<!-- WARMUP:${ref}|${intent} -->`;
}

export function extractWarmup(
  history: ConversationMessage[],
): WarmupMarker | null {
  const last = lastAssistantTurn(history);
  if (!last) return null;
  const match = /<!-- WARMUP:([^|]+)\|([^>]+) -->/.exec(last.content);
  return match ? { ref: match[1], intent: match[2] } : null;
}

// ---------------------------------------------------------------------------
// LANG marker
// ---------------------------------------------------------------------------

export function buildLangMarker(code: string): string {
  return `<!-- LANG:${code} -->`;
}

export function extractLang(history: ConversationMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const match = /<!-- LANG:([a-zA-Z0-9_-]+) -->/.exec(history[i].content);
    if (match) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// AWAITING_LANG + PENDING_PASSAGE markers
// ---------------------------------------------------------------------------

export interface PendingPassage {
  ref: string;
  intent: string;
}

export function buildPendingMarkers(ref: string, intent: string): string {
  return `<!-- AWAITING_LANG -->\n<!-- PENDING_PASSAGE:${ref}|${intent} -->`;
}

export function extractPending(
  history: ConversationMessage[],
): PendingPassage | null {
  const last = lastAssistantTurn(history);
  if (!last) return null;
  if (!last.content.includes("<!-- AWAITING_LANG -->")) return null;
  const passageMatch = /<!-- PENDING_PASSAGE:([^|]+)\|([^>]+) -->/.exec(
    last.content,
  );
  return passageMatch ? { ref: passageMatch[1], intent: passageMatch[2] } : null;
}

export function hasAwaitingLang(history: ConversationMessage[]): boolean {
  const last = lastAssistantTurn(history);
  return !!last?.content.includes("<!-- AWAITING_LANG -->");
}

// ---------------------------------------------------------------------------
// NAME_INVITED marker
// ---------------------------------------------------------------------------

export function buildNameInvitedMarker(): string {
  return "<!-- NAME_INVITED -->";
}

export function hasNameInvited(history: ConversationMessage[]): boolean {
  return history.some(
    (m) => m.role === "assistant" && m.content.includes("<!-- NAME_INVITED -->"),
  );
}

// ---------------------------------------------------------------------------
// Language resolution
// ---------------------------------------------------------------------------

export interface LanguageOption {
  /** BCP-47 language code, e.g. "es", "fr", "zh" */
  code?: string;
  /** Language name (as returned by list_languages) */
  name?: string;
  /** Language name in English (legacy field, fallback) */
  ln?: string;
  /** Language name in the language itself (legacy field, fallback) */
  ang?: string;
  /** Optional region/variant labels (legacy field, fallback) */
  ld?: string;
}

/**
 * Resolve a user's free-text language reply ("Spanish", "es", "español",
 * "latin american spanish") to a BCP-47 code by matching against the list
 * returned by `list_languages`.
 *
 * Strategy (in order):
 *  1. Exact code match (case-insensitive whole-word)
 *  2. Bidirectional substring: name ⊆ message OR message ⊆ name
 *  3. All significant words in the language name appear in the message
 *     (order-insensitive, prefix-tolerant) — enables "latin american spanish" → es-419
 *  4. If multiple candidates, rank by word-overlap count and pick the best
 *
 * Returns the matched code, or null if unresolvable / ambiguous.
 */
export function resolveLanguage(
  reply: string,
  langList: LanguageOption[],
): string | null {
  const normalized = reply.trim().toLowerCase();
  if (!normalized) return null;

  // Tokenise: keep hyphens so "es-419" stays intact; split on spaces/punctuation
  const msgWords = normalized.split(/[\s,;.!?()]+/).filter((w) => w.length > 1);

  // ── Pass 1: exact code match (case-insensitive, whole-word) ───────────────
  for (const lang of langList) {
    const code = (lang.code ?? "").toLowerCase();
    if (!code) continue;
    if (code === normalized) return lang.code!;
    if (msgWords.includes(code)) return lang.code!;
  }

  // ── Pass 2: scored name matching ──────────────────────────────────────────
  //
  // Scoring (per name field, take best across ln/ang/ld):
  //   1000  exact equality  (user typed the name exactly)
  //    name_wc * 20  all words of name found in message  (order-insensitive)
  //    name_wc * 5   name is a substring of the message
  //    name_wc * 3   message is a substring of the name  (partial input)
  //
  // Multiplying by word-count means more-specific names (more words) beat
  // shorter ones only when ALL their words actually appear in the message.

  const scored: Array<{ code: string; score: number }> = [];

  for (const lang of langList) {
    const code = lang.code ?? "";
    if (!code) continue;

    const nameFields = [lang.name ?? "", lang.ln ?? "", lang.ang ?? "", lang.ld ?? ""]
      .map((n) => n.toLowerCase())
      .filter(Boolean);

    let bestScore = 0;

    for (const name of nameFields) {
      if (!name) continue;
      const nameWc = name.split(/\s+/).filter((w) => w.length > 0).length;

      // Exact equality
      if (name === normalized) {
        bestScore = Math.max(bestScore, 1000);
        continue;
      }

      // All significant words of the name appear in the message (any order)
      const sigWords = name.split(/\s+/).filter((w) => w.length > 2);
      if (sigWords.length > 0) {
        const allMatch = sigWords.every((nw) =>
          msgWords.some((mw) => mw.startsWith(nw) || nw.startsWith(mw)),
        );
        if (allMatch) {
          bestScore = Math.max(bestScore, sigWords.length * 20);
          continue;
        }
      }

      // Name is a substring of the user's message
      if (normalized.includes(name)) {
        bestScore = Math.max(bestScore, nameWc * 5);
        continue;
      }

      // User's message is a substring of the name (partial input, e.g. "span" → "Spanish")
      if (name.includes(normalized)) {
        bestScore = Math.max(bestScore, nameWc * 3);
      }
    }

    if (bestScore > 0) scored.push({ code, score: bestScore });
  }

  if (scored.length === 0) return null;
  if (scored.length === 1) return scored[0].code;

  scored.sort((a, b) => b.score - a.score);
  if (scored[0].score > scored[1].score) return scored[0].code;

  // Tied — prefer exact name equality as a tiebreak
  const topScore = scored[0].score;
  const tied = scored.filter((s) => s.score === topScore);
  const exact = tied.filter((s) => {
    const lang = langList.find((l) => (l.code ?? "") === s.code);
    if (!lang) return false;
    const ln = (lang.ln ?? "").toLowerCase();
    const ang = (lang.ang ?? "").toLowerCase();
    return ln === normalized || ang === normalized;
  });

  return exact.length === 1 ? exact[0].code : null;
}
