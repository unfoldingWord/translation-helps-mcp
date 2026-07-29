/**
 * Chat pacing — progressive, shorter first-turn replies for long-help intents.
 *
 * Pedagogy: consult by questioning (CANA consultant style), not long lectures.
 * Short turns = one consulting move + one question; point to the resources panel;
 * ask what’s hard; invite a draft; after a draft, CANA-probe keywords/phrases/TN
 * without grading unknown receptor-language surface form.
 *
 * Also:
 *   1. Declares per-intent word budgets + prompt instruction fragments
 *   2. Post-processes completed replies (trim + coaching closer)
 *
 * Hidden HTML markers (<!-- CHALLENGES:… -->, quiz/checklist footers, etc.)
 * are preserved and excluded from the word count.
 */

import { stripCoachScaffoldLabels } from "./coachPedagogy.js";

/** Intents where first-turn volume must stay progressive. */
export type PacedIntent =
  | "annotated_passage"
  | "phrase_drill"
  | "passage_help"
  | "open_ended"
  | "methodology"
  | "passage_overview"
  | "checklist_step";

/** Visible-word budgets (HTML comments excluded). Soft target for prompts; hard cap for trim. */
export const CHAT_WORD_BUDGETS: Record<PacedIntent, number> = {
  annotated_passage: 180,
  phrase_drill: 140,
  passage_help: 180,
  open_ended: 180,
  methodology: 160,
  passage_overview: 120,
  checklist_step: 120,
};

/** Shape of the fallback coaching question when the model omits one. */
export type CoachingCloserKind = "brief" | "drill";

/** Completion maxTokens roughly proportional to word budget (multilingual headroom). */
export function maxTokensForWordBudget(budget: number): number {
  return Math.min(420, Math.max(160, Math.round(budget * 1.55) + 40));
}

export function wordBudgetForIntent(intent: string): number | null {
  if (intent in CHAT_WORD_BUDGETS) {
    return CHAT_WORD_BUDGETS[intent as PacedIntent];
  }
  return null;
}

export function closerKindForIntent(intent: string): CoachingCloserKind {
  if (intent === "phrase_drill" || intent === "methodology") return "drill";
  return "brief";
}

/**
 * Shared pacing + consultant-pedagogy instructions for long-help replies.
 * Inject into system prompts for paced intents.
 */
export function pacingPromptInstructions(
  budget: number,
  opts?: { priorityDecisions?: boolean },
): string {
  const decisions = opts?.priorityDecisions !== false;
  return (
    `## Chat pacing — consultant pedagogy (mandatory)\n` +
    `- You are a translation **consultant** (CANA: Consistent, Accurate, Natural, Clear), not a lecturer and not a grader of unknown receptor languages.\n` +
    `- Hard cap ≈ **${budget} words** for this visible reply.\n` +
    (decisions
      ? `- Cover at most **2–3 priority decisions** in the first turn — do NOT dump the full analysis. Paraphrase TN jargon in everyday words.\n`
      : `- Cover **one focused point** (or a short direct answer) — do NOT dump a full essay. Paraphrase jargon in everyday words.\n`) +
    `- Point the translator to text already in the **resources panel** (notes, terms, scripture) instead of re-quoting it.\n` +
    `- After your brief consulting move, **STOP** and ask exactly **ONE** consultant question. Before they have drafted / asked for check, prefer:\n` +
    `  - what's hard ("What don't you know how to translate yet?" / "¿Qué parte no sabes cómo traducir?")\n` +
    `  - invite a draft in **Mi traducción**\n` +
    `  - which phrase/note to explore next\n` +
    `- Do **not** ask "How did you translate X?" / "¿Cómo tradujiste X?" — ever: it invites target-language text you cannot read. When probing their wording (after draft / check), ask what the word they chose MEANS in their language, in the source language.\n` +
    `- After Pedir revisión / ready-for-check: acknowledge → ask what felt hard → exactly ONE meaning-based CANA probe per turn on **source** items (the sequence continues across turns) — never rewrite their draft, never claim it "sounds right", never praise/grade receptor wording they paste in chat.\n` +
    `- Always reply in the source/conversation language; target language is metadata only.\n` +
    `- Never end with a "want more information?" dump. Never imply you will fix their target-language text. Never instruct them to type a keyword.`
  );
}

/** Count whitespace-separated words in visible text (strips HTML comments). */
export function countWords(text: string): number {
  const visible = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!visible) return 0;
  return visible.split(/\s+/).filter(Boolean).length;
}

/** True when the visible reply already ends with a question. */
export function endsWithQuestion(text: string): boolean {
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!cleaned) return false;
  return /[？?]\s*$/.test(cleaned);
}

/**
 * Default consulting closer when the model omits a final question.
 * Biased to consultant CANA questions — not “want more info?” or “I’ll fix your text”.
 */
export function coachingCloser(
  language: string,
  kind: CoachingCloserKind = "brief",
): string {
  const lang = language.toLowerCase();
  // Pre-draft closers: invite draft / ask what's hard — never
  // "How did you translate…?" (that phrasing is banned everywhere; checking
  // probes ask for the meaning of the chosen word instead).
  if (lang.startsWith("es")) {
    return kind === "drill"
      ? "¿Qué te resulta más difícil de esa expresión del panel, o quieres escribir un borrador en Mi traducción?"
      : "¿Qué parte no sabes cómo traducir todavía, o quieres escribir un borrador en Mi traducción?";
  }
  if (lang.startsWith("pt")) {
    return kind === "drill"
      ? "O que está mais difícil nessa expressão do painel, ou quer escrever um rascunho em Minha tradução?"
      : "O que você ainda não sabe como traduzir, ou quer escrever um rascunho em Minha tradução?";
  }
  if (lang.startsWith("fr")) {
    return kind === "drill"
      ? "Qu'est-ce qui est le plus difficile dans cette expression du panneau, ou voulez-vous écrire une ébauche dans Ma traduction ?"
      : "Que ne savez-vous pas encore traduire, ou voulez-vous écrire une ébauche dans Ma traduction ?";
  }
  return kind === "drill"
    ? "What's hardest about that phrase from the panel, or would you like to write a draft in My translation?"
    : "What don't you know how to translate yet, or would you like to write a draft in My translation?";
}

/** @deprecated Prefer coachingCloser — kept for call-site clarity during transition. */
export const wantMoreCloser = coachingCloser;

function extractTrailingMarkers(text: string): {
  body: string;
  markers: string;
} {
  const found: string[] = [];
  const body = text
    .replace(/<!--[\s\S]*?-->/g, (m) => {
      found.push(m);
      return "";
    })
    .replace(/\s+$/u, "");
  return {
    body: body.trimEnd(),
    markers: found.length > 0 ? "\n" + found.join("\n") : "",
  };
}

/**
 * Truncate to `budget` words, preferring a sentence/paragraph boundary
 * when that still keeps at least ~55% of the budget.
 */
export function truncateAtWordBudget(
  text: string,
  budget: number,
): { text: string; truncated: boolean } {
  if (budget <= 0) return { text: "", truncated: true };
  if (countWords(text) <= budget) return { text, truncated: false };

  const parts = text.split(/(\s+)/);
  let words = 0;
  let cutIdx = parts.length;
  for (let i = 0; i < parts.length; i++) {
    if (/\S/.test(parts[i]!)) {
      words++;
      if (words > budget) {
        cutIdx = i;
        break;
      }
    }
  }

  const candidate = parts.slice(0, cutIdx).join("").trimEnd();
  const minKeep = Math.floor(budget * 0.55);

  const paraIdx = Math.max(
    candidate.lastIndexOf("\n\n"),
    candidate.lastIndexOf("\r\n\r\n"),
  );
  if (paraIdx > 0) {
    const beforePara = candidate.slice(0, paraIdx).trimEnd();
    if (countWords(beforePara) >= minKeep) {
      return { text: beforePara, truncated: true };
    }
  }

  // Walk back to the latest sentence end that still keeps ≥55% of the budget.
  const sentenceEnd = /[.!?](?=\s|$)/g;
  let lastGood = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnd.exec(candidate)) !== null) {
    const end = match.index + 1;
    const sliceWords = countWords(candidate.slice(0, end));
    if (sliceWords >= minKeep && sliceWords <= budget) {
      lastGood = end;
    }
  }
  if (lastGood > 0) {
    return { text: candidate.slice(0, lastGood).trimEnd(), truncated: true };
  }

  return { text: candidate, truncated: true };
}

/**
 * Keep only up to the FIRST question in a coach reply (checking pedagogy:
 * exactly ONE probe per turn — prompt-only enforcement does not hold).
 * Truncates at the end of the sentence containing the first question mark and
 * drops everything after it. Hidden HTML markers (<!-- CHECK:… -->, session
 * footers, …) anywhere in the text are preserved and re-appended at the end.
 * Replies with no question are returned unchanged (scaffold labels stripped).
 */
export function truncateAtFirstQuestion(text: string): {
  text: string;
  truncated: boolean;
} {
  if (!text) return { text, truncated: false };
  const cleaned = stripCoachScaffoldLabels(text);
  const { body, markers } = extractTrailingMarkers(cleaned);

  const end = firstQuestionEnd(body);
  if (end < 0 || end >= body.trimEnd().length) {
    return { text: body.trimEnd() + markers, truncated: false };
  }
  return { text: body.slice(0, end).trimEnd() + markers, truncated: true };
}

/**
 * Index just past the end of the sentence containing the first question mark,
 * or -1 when the text has no question. A "?" followed by a connector
 * (— – - , ; :) or a lowercase continuation belongs to a quoted/embedded
 * question mid-sentence, so scanning proceeds to the next question end.
 */
function firstQuestionEnd(body: string): number {
  const re = /[?？]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let end = m.index + 1;
    while (end < body.length && /["'”’)\]»*_]/.test(body[end]!)) end++;
    const rest = body.slice(end).replace(/^[ \t]+/, "");
    if (rest && /^(?:[—–,;:-]|\p{Ll})/u.test(rest)) continue;
    return end;
  }
  return -1;
}

export interface EnforceReplyBudgetResult {
  text: string;
  truncated: boolean;
  wordCount: number;
}

/**
 * Enforce a visible-word budget and ensure a coaching closer
 * when the reply was truncated or lacked a closing question.
 */
export function enforceReplyBudget(
  text: string,
  opts: {
    budget: number;
    language: string;
    /** When true (default), append coaching closer if missing a final question. */
    ensureCloser?: boolean;
    closerKind?: CoachingCloserKind;
  },
): EnforceReplyBudgetResult {
  // Drop English prompt scaffolding before counting/truncating words.
  const cleaned = stripCoachScaffoldLabels(text);
  const { body, markers } = extractTrailingMarkers(cleaned);
  const { text: trimmed, truncated } = truncateAtWordBudget(body, opts.budget);

  let next = trimmed;
  const ensureCloser = opts.ensureCloser !== false;
  if (ensureCloser && (truncated || !endsWithQuestion(next))) {
    if (!endsWithQuestion(next)) {
      next =
        next.replace(/[.!…]?\s*$/u, "").trimEnd() +
        "\n\n" +
        coachingCloser(opts.language, opts.closerKind ?? "brief");
    }
  }

  return {
    text: next + markers,
    truncated,
    wordCount: countWords(next),
  };
}

/** Apply pacing when the intent has a configured budget; otherwise return unchanged. */
export function paceChatReply(
  text: string,
  intent: string,
  language: string,
): EnforceReplyBudgetResult {
  const budget = wordBudgetForIntent(intent);
  if (budget == null) {
    return { text, truncated: false, wordCount: countWords(text) };
  }
  return enforceReplyBudget(text, {
    budget,
    language,
    closerKind: closerKindForIntent(intent),
  });
}
