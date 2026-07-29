/**
 * Source vs target language pair for translation coaching.
 *
 * - **sourceLanguage**: Door43 scripture/helps AND the conversation language
 *   with the coach (LLM replies in this language). This is what onboarding
 *   establishes — the language the user translates FROM.
 * - **targetLanguage**: receptor / heart-language label for UX ("I'm translating
 *   into X"). Usually unknown to the LLM and never asked for during onboarding —
 *   it defaults to the neutral {@link NEUTRAL_TARGET_LABEL}. Never used as
 *   coach reply locale. The user's draft stays in Mi traducción; the LLM does
 *   not read/grade it.
 *
 * Legacy single `language` maps to **source** when it is a gateway language
 * (en, es-419, fr, pt-br, …); otherwise it keeps its old receptor meaning
 * with source defaulting to `en`.
 */

export interface LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface LanguagePairInput {
  /** Legacy single field — source when a gateway language, else receptor target. */
  language?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
}

/**
 * Neutral receptor placeholder used when the user never named a target
 * language (we never ask for it during onboarding). Metadata only — must
 * never be sent to Door43 as a fetch language.
 */
export const NEUTRAL_TARGET_LABEL = "my language";

/** True for the neutral "my language" receptor placeholder (or empty). */
export function isNeutralTarget(code: string | null | undefined): boolean {
  return !code || code.trim().toLowerCase() === NEUTRAL_TARGET_LABEL;
}

/**
 * Primary subtags of Door43 gateway/strategic languages — languages that have
 * scripture + helps resources and are plausible SOURCE languages. Used to
 * migrate legacy single-`language` profiles: a gateway value was almost
 * certainly the language the user works IN, not their (unknown) receptor.
 */
const GATEWAY_PRIMARY_SUBTAGS = new Set([
  "en",
  "es",
  "fr",
  "pt",
  "hi",
  "id",
  "sw",
  "ar",
  "ru",
  "zh",
  "bn",
  "ne",
  "tl",
  "my",
  "am",
  "fa",
  "tr",
  "vi",
  "ur",
  "ha",
  "plt",
  "ceb",
  "ilo",
  "ta",
  "te",
  "kn",
  "gu",
  "ml",
  "mr",
  "pa",
  "or",
  "as",
]);

/** True when the code's primary subtag is a known gateway language (en, es-419, …). */
export function isGatewayLanguage(code: string): boolean {
  return GATEWAY_PRIMARY_SUBTAGS.has(primarySubtag(code));
}

export function primarySubtag(code: string): string {
  const part = code.trim().split("-")[0]?.toLowerCase();
  return part || "en";
}

/**
 * Resolve a source/target pair with backward-compatible defaults.
 *
 * Mapping rules:
 * 1. `sourceLanguage` ← explicit source, else legacy `language` when it is a
 *    gateway language (en/es-419/…), else `"en"` (or an en-family explicit
 *    target for same-locale study).
 * 2. `targetLanguage` ← explicit target, else legacy `language` when it did
 *    NOT map to source (non-gateway receptor code), else the neutral
 *    {@link NEUTRAL_TARGET_LABEL} — we never ask the user for a target.
 */
export function resolveLanguagePair(
  input: LanguagePairInput = {},
): LanguagePair {
  const explicitSource =
    (typeof input.sourceLanguage === "string" && input.sourceLanguage.trim()) ||
    "";
  const explicitTarget =
    (typeof input.targetLanguage === "string" && input.targetLanguage.trim()) ||
    "";
  const legacy =
    (typeof input.language === "string" && input.language.trim()) || "";

  let sourceLanguage = explicitSource;
  let legacyMappedToSource = false;
  if (
    !sourceLanguage &&
    legacy &&
    !isNeutralTarget(legacy) &&
    isGatewayLanguage(legacy)
  ) {
    sourceLanguage = legacy;
    legacyMappedToSource = true;
  }

  let targetLanguage = explicitTarget;
  if (!targetLanguage) {
    targetLanguage =
      legacy && !legacyMappedToSource && !isNeutralTarget(legacy)
        ? legacy
        : NEUTRAL_TARGET_LABEL;
  }

  if (!sourceLanguage) {
    // Same-locale study when an explicit en-family target exists; else English gateway.
    sourceLanguage =
      !isNeutralTarget(targetLanguage) && primarySubtag(targetLanguage) === "en"
        ? targetLanguage
        : "en";
  }

  return { sourceLanguage, targetLanguage };
}

/** True when source and target share the same primary subtag (e.g. en / en-US). */
export function isSameLanguageFamily(pair: LanguagePair): boolean {
  return (
    primarySubtag(pair.sourceLanguage) === primarySubtag(pair.targetLanguage)
  );
}

/**
 * Prompt guidance for coach / harness system messages.
 *
 * Tools and coach replies use `sourceLanguage`. `targetLanguage` is metadata
 * only — do not reply in it or ask the model to read target drafts.
 */
export function languagePairPromptGuidance(pair: LanguagePair): string {
  const targetLabel = isNeutralTarget(pair.targetLanguage)
    ? "the user's own language, unknown to you"
    : pair.targetLanguage;
  const lock = [
    `CRITICAL — language lock: Always reply in sourceLanguage (${pair.sourceLanguage}).`,
    `targetLanguage (${targetLabel}) is receptor metadata only — never the coach reply locale.`,
    `Do not switch into the receptor language because the user pasted target text, volunteered target phrases, or code-switched.`,
    `Quoted words or phrases in the target language (or any other language) inside the user's message are CONTENT to discuss — they are NEVER a signal to switch your reply language. Judge the reply language by the framing language of the user's message, and switch only when the user explicitly asks you to.`,
    `Never praise, correct, translate-for-them, or evaluate target-language wording surface. If they paste receptor text in chat, ignore surface form and ask source-side questions only.`,
  ].join(" ");

  if (isSameLanguageFamily(pair)) {
    return (
      `SOURCE / CONVERSATION LANGUAGE: ${pair.sourceLanguage}. ` +
      `Fetch Door43 resources in this language and reply in this language. ` +
      `The user's receptor draft (if any) stays in their workspace — do not ask to paste it and do not evaluate target-language surface form. ` +
      lock
    );
  }
  return [
    `SOURCE / CONVERSATION LANGUAGE: ${pair.sourceLanguage} — fetch Door43 resources (ULT/UST/TN/TW/TA) in this language and reply entirely in this language.`,
    `TARGET / RECEPTOR LANGUAGE (metadata only): ${targetLabel} — the user is translating into this language. You often will not know it, and you never need to ask what it is. Never reply in the target language; never ask them to paste their draft for you to read or grade.`,
    `CANA probes are source-side questions (key terms, TN decisions, meaning, audience risk, consistency). The translator answers and judges their own draft in Mi traducción.`,
    lock,
  ].join("\n");
}
