/**
 * Workflow modes for Ezer chat — Study → Translate → Check (any order).
 *
 * Modes bias coach prompts and UI panel emphasis. Intents still work across
 * modes; defaults and persona emphasis follow the active mode.
 */

export type WorkflowMode = "study" | "translate" | "check";

export const WORKFLOW_MODES: readonly WorkflowMode[] = [
  "study",
  "translate",
  "check",
] as const;

export const DEFAULT_WORKFLOW_MODE: WorkflowMode = "study";

/** Panel tab the UI should emphasize for a mode. */
export type WorkflowPanelEmphasis = "context" | "checklist" | "draft" | null;

export function isWorkflowMode(value: unknown): value is WorkflowMode {
  return value === "study" || value === "translate" || value === "check";
}

export function parseWorkflowMode(
  value: unknown,
  fallback: WorkflowMode = DEFAULT_WORKFLOW_MODE,
): WorkflowMode {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return isWorkflowMode(normalized) ? normalized : fallback;
}

/**
 * Detect an explicit user request to switch workflow mode.
 * Returns null when the message does not clearly pick a mode.
 */
export function detectWorkflowModeIntent(message: string): WorkflowMode | null {
  const text = message.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  // Check first — "check my draft" / Pedir revisión / ready for check
  if (
    /\b(check(ing)?|review(ing)?|verify(ing)?)\s+(of\s+)?(my\s+|the\s+)?(draft|translation)\b/i.test(
      text,
    ) ||
    /\bI'?m\s+ready\s+for\s+check\b/i.test(text) ||
    // "I finished my draft" / "terminé mi borrador" — done drafting ⇒ check
    /\bi(?:'?ve|\s+have)?\s+(?:just\s+)?finish(?:ed)?\s+(?:my\s+|the\s+)?(draft|translation|translating)\b/i.test(
      lower,
    ) ||
    /\b(?:ya\s+)?(?:termin[eé]|acab[eé])\s+(?:de\s+traducir|(?:con\s+)?mi\s+(?:borrador|traducci[oó]n))\b/i.test(
      lower,
    ) ||
    // "is my translation ok / right?" / "¿está bien mi traducción?"
    /\bis\s+my\s+(?:translation|draft)\s+(?:ok(?:ay)?|right|correct|good|accurate)\b/i.test(
      lower,
    ) ||
    /\b(?:est[aá]\s+bien|es\s+correcta?)\s+mi\s+(?:traducci[oó]n|borrador)\b/i.test(
      lower,
    ) ||
    /\bmi\s+(?:traducci[oó]n|borrador)\s+est[aá]\s+bien\b/i.test(lower) ||
    /\bestoy\s+list[oa]\s+para\s+(preguntas\s+de\s+)?revisi[oó]n\b/i.test(
      text,
    ) ||
    /\b(pedir|pide|solicitar|solicita)\s+(una\s+)?revisi[oó]n\b/i.test(text) ||
    /\b(revisa|verifica|chequea|comprueba)\s+(mi\s+)?(borrador|traducci[oó]n)\b/i.test(
      text,
    ) ||
    /\b(let'?s|vamos\s+a|quiero)\s+(check|revis(ar|ión)|verificar)\b/i.test(
      text,
    ) ||
    /\b(switch|cambiar|pasa|pasemos)\s+(a|to)\s+(check|checking|revisi[oó]n)\b/i.test(
      text,
    ) ||
    // Re-entry: "go back to checking", "resume the review", "continue checking"
    /\b(go|going|get|getting)\s+back\s+to\s+(the\s+)?(check(ing)?|review(ing)?|revision)\b/i.test(
      lower,
    ) ||
    /\b(resume|continue|keep)\s+(the\s+)?(check(ing)?|review(ing)?)\b/i.test(
      lower,
    ) ||
    /\b(volvamos|volver|regresemos|regresar)\s+a\s+(la\s+)?(revisi[oó]n|revisar|chequear|verificar)\b/i.test(
      lower,
    ) ||
    /\b(retomar|retomemos|continuar|continuemos|seguir|sigamos)\s+(con\s+)?(la\s+)?(revisi[oó]n|revisando|chequeando|verificando)\b/i.test(
      lower,
    ) ||
    /\bi\s+want\s+to\s+check\b/i.test(lower) ||
    /\bquiero\s+(revisar|chequear|verificar)\b/i.test(lower)
  ) {
    return "check";
  }

  // Translate — draft / write my translation (not check)
  if (
    /\b(let'?s|vamos\s+a|quiero)\s+(translate|traducir|draft|escribir)\b/i.test(
      text,
    ) ||
    /\b(switch|cambiar|pasa|pasemos)\s+(a|to)\s+(translate|traducci[oó]n|draft)\b/i.test(
      text,
    ) ||
    /\bi\s+want\s+to\s+(translate|draft)\b/i.test(lower) ||
    /\bquiero\s+(traducir|escribir\s+(mi\s+)?(borrador|traducci[oó]n))\b/i.test(
      lower,
    ) ||
    /\b(start|empezar|comenzar)\s+(translating|a\s+traducir|drafting)\b/i.test(
      lower,
    ) ||
    /\b(skip\s+(the\s+)?study|saltar\s+(el\s+)?estudio)\b/i.test(lower)
  ) {
    return "translate";
  }

  // Study — learn context / overview first
  if (
    /\b(let'?s|vamos\s+a|quiero)\s+(study|estudiar|aprender)\b/i.test(text) ||
    /\bstudy\s+first\b/i.test(lower) ||
    /\b(primero|first)\s+(estudiemos|estudiar|study)\b/i.test(lower) ||
    /\b(switch|cambiar|pasa|pasemos)\s+(a|to)\s+(study|estudio|context)\b/i.test(
      text,
    ) ||
    /\bi\s+want\s+to\s+study\b/i.test(lower) ||
    /\bquiero\s+estudiar\b/i.test(lower) ||
    /\b(learn|understand(?:ing)?|entender|comprender)\s+(?:the\s+|el\s+|la\s+)?(passage|context|contexto|pasaje)\b/i.test(
      lower,
    ) ||
    /\bcontext\s+quiz\b/i.test(lower) ||
    /\bchequeo\s+de\s+contexto\b/i.test(lower)
  ) {
    return "study";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Conversation-driven mode inference (soft cues) + session-start clarify
// ---------------------------------------------------------------------------

/** How confident a mode inference is. Soft cues never break sticky sessions. */
export type WorkflowModeConfidence = "explicit" | "soft";

export interface WorkflowModeInference {
  mode: WorkflowMode;
  confidence: WorkflowModeConfidence;
}

/** "I finished my draft" / "is my translation ok" — clear check cues (EN+ES). */
function hasSoftCheckCue(lower: string): boolean {
  return (
    /\bi(?:'?ve|\s+have)?\s+(?:just\s+)?finish(?:ed)?\s+(?:my\s+|the\s+)?(draft|translation|translating)\b/i.test(
      lower,
    ) ||
    /\bdid\s+i\s+translate\s+(?:it|this|that)\s+(?:right|correctly|well)\b/i.test(
      lower,
    ) ||
    /\b(?:ya\s+)?(?:termin[eé]|acab[eé])\s+(?:de\s+traducir|(?:con\s+)?mi\s+(?:borrador|traducci[oó]n))\b/i.test(
      lower,
    )
  );
}

/** "how do I say X" / "cómo digo X" / "I'm drafting" — drafting-in-progress cues. */
function hasSoftTranslateCue(lower: string): boolean {
  return (
    /\bhow\s+(?:do|would|can|could|should)\s+i\s+(?:say|translate|render|word|express)\b/i.test(
      lower,
    ) ||
    /\bi(?:'m|\s+am)\s+(?:drafting|translating)\b/i.test(lower) ||
    /\b(?:this|that|it)(?:'s|\s+is)\s+(?:a\s+)?hard\s+(?:word|phrase|to\s+translate)\b/i.test(
      lower,
    ) ||
    /\bhard\s+to\s+translate\b/i.test(lower) ||
    /\bc[oó]mo\s+(?:digo|se\s+dice|puedo\s+decir|traduzco|se\s+traduce|expreso|lo\s+digo)\b/i.test(
      lower,
    ) ||
    /\bestoy\s+(?:traduciendo|redactando|escribiendo\s+mi\s+(?:borrador|traducci[oó]n))\b/i.test(
      lower,
    ) ||
    /\bno\s+s[eé]\s+c[oó]mo\s+(?:traducir|decir)\b/i.test(lower) ||
    /\bdif[ií]cil\s+de\s+traducir\b/i.test(lower)
  );
}

/** "what does X mean" / "explain" / "context" — study-flavored asks. */
function hasSoftStudyCue(lower: string): boolean {
  return (
    /\bwhat\s+does\s+\S[\s\S]{0,60}?\s+mean\b/i.test(lower) ||
    /\bexplain\b/i.test(lower) ||
    /\b(?:cultural|historical)?\s*(?:background|context)\b/i.test(lower) ||
    /\bqu[eé]\s+significa\b/i.test(lower) ||
    /\bexpl[ií]ca(?:me|r)?\b/i.test(lower) ||
    /\bcontexto\b/i.test(lower) ||
    /\btrasfondo\b/i.test(lower)
  );
}

/**
 * Infer the workflow mode from a chat message.
 *
 * Explicit switch phrases (detectWorkflowModeIntent) always win. Soft cues are
 * gated by the current mode so ordinary coaching questions never ping-pong
 * modes mid-flow:
 * - soft CHECK cues ("I finished my draft", "did I translate it right") apply
 *   from any mode — finishing a draft is unambiguous;
 * - soft TRANSLATE cues ("how do I say…", "I'm drafting") apply from Study but
 *   never pull the user out of a Check session;
 * - soft STUDY cues ("what does X mean", "explain", "context") only confirm
 *   Study when already in Study — they are normal questions while drafting or
 *   checking and must not switch modes there.
 *
 * Returns null when the message carries no mode signal at all.
 */
export function inferWorkflowMode(
  message: string,
  currentMode: WorkflowMode = DEFAULT_WORKFLOW_MODE,
): WorkflowModeInference | null {
  const explicit = detectWorkflowModeIntent(message);
  if (explicit) return { mode: explicit, confidence: "explicit" };

  const lower = message.trim().toLowerCase();
  if (!lower) return null;

  if (hasSoftCheckCue(lower)) return { mode: "check", confidence: "soft" };
  if (hasSoftTranslateCue(lower)) {
    if (currentMode === "check") return null;
    return { mode: "translate", confidence: "soft" };
  }
  if (hasSoftStudyCue(lower)) {
    if (currentMode !== "study") return null;
    return { mode: "study", confidence: "soft" };
  }
  return null;
}

/**
 * Hidden marker appended when the coach asks the session-start mode question.
 * The next user turn is parsed as a possible answer (study/translate/check).
 */
export const WORKFLOW_CLARIFY_MARKER = "<!-- MODE:clarify -->";

type HistoryMessage = { role: string; content: string };

/** True when the clarify question was asked at any point in this session. */
export function hasAskedWorkflowClarify(
  history: HistoryMessage[] | undefined,
): boolean {
  if (!history) return false;
  return history.some(
    (m) =>
      m.role === "assistant" && m.content.includes(WORKFLOW_CLARIFY_MARKER),
  );
}

/** True when the LAST assistant turn asked the clarify question (answer pending). */
export function hasPendingWorkflowClarify(
  history: HistoryMessage[] | undefined,
): boolean {
  if (!history) return false;
  const lastAssistant = [...history]
    .reverse()
    .find((m) => m.role === "assistant");
  return Boolean(lastAssistant?.content.includes(WORKFLOW_CLARIFY_MARKER));
}

/**
 * Map an answer to the clarify question onto a mode (EN+ES).
 * Order matters: "check a draft I have" mentions drafts — test check first.
 * Returns null when the reply doesn't pick a mode (coach just continues).
 */
export function parseWorkflowClarifyAnswer(
  message: string,
): WorkflowMode | null {
  const lower = message.trim().toLowerCase();
  if (!lower) return null;

  // Check — "check", "I (already) have a draft", "revisar", "ya tengo un borrador"
  if (
    /\b(check|checking|review|revisar(?:lo)?|revisi[oó]n)\b/i.test(lower) ||
    /\bi\s+(?:already\s+)?have\s+a\s+(?:draft|translation)\b/i.test(lower) ||
    /\bya\s+tengo\s+(?:un(?:a)?\s+)?(?:borrador|traducci[oó]n)\b/i.test(
      lower,
    ) ||
    hasSoftCheckCue(lower)
  ) {
    return "check";
  }

  // Translate — "start translating", "translate", "traducir", "drafting"
  if (
    /\b(translate|translating|traducir(?:lo)?|draft(?:ing)?|redactar)\b/i.test(
      lower,
    ) ||
    /\bwrite\s+my\s+(?:draft|translation)\b/i.test(lower) ||
    /\bescribir\s+mi\s+(?:borrador|traducci[oó]n)\b/i.test(lower) ||
    hasSoftTranslateCue(lower)
  ) {
    return "translate";
  }

  // Study — "study (first)", "estudiar", "context first", "entenderlo primero"
  if (
    /\b(study|studying|estudiar(?:lo)?|estudio)\b/i.test(lower) ||
    /\b(?:context|contexto)\s+(?:first|primero)\b/i.test(lower) ||
    /\b(?:understand|entender(?:lo)?)\b[\s\S]{0,24}\b(?:first|primero|antes)\b/i.test(
      lower,
    ) ||
    hasSoftStudyCue(lower)
  ) {
    return "study";
  }

  return null;
}

/**
 * Should the coach ask ONE session-start question ("study, translate, or
 * check?") this turn? Caller additionally gates on "a passage actually
 * loaded" (reference resolved) before appending the question.
 */
export function shouldAskWorkflowClarify(opts: {
  /** Current user message. */
  message: string;
  /** Active mode from client/profile (default Study). */
  currentMode?: WorkflowMode;
  /** Conversation so far (excluding the current message). */
  history?: HistoryMessage[];
  /** Sticky checking / quiz in progress — never interrupt those flows. */
  sessionActive?: boolean;
  /**
   * True when the user explicitly picked the mode (UI tab click). Explicit
   * choices always win — never re-ask, even when the mode equals the default.
   */
  modeExplicit?: boolean;
}): boolean {
  if (opts.sessionActive) return false;
  if (opts.modeExplicit) return false;
  const currentMode = opts.currentMode ?? DEFAULT_WORKFLOW_MODE;
  // A non-default mode means the user (or a prior turn) already chose one.
  if (currentMode !== DEFAULT_WORKFLOW_MODE) return false;
  if (hasAskedWorkflowClarify(opts.history)) return false;
  // This turn already signals a mode (explicit or soft) — no need to ask.
  if (inferWorkflowMode(opts.message, currentMode)) return false;
  // An earlier user turn already picked a mode this session.
  for (const m of opts.history ?? []) {
    if (m.role === "user" && detectWorkflowModeIntent(m.content)) return false;
  }
  return true;
}

/** The one simple session-start question, in the conversation language. */
export function buildWorkflowClarifyQuestion(language = "en"): string {
  const es = language.toLowerCase().startsWith("es");
  return es
    ? "¿Prefieres estudiar este pasaje primero, comenzar a traducir, o revisar un borrador que ya tienes?"
    : "Would you like to study this passage first, start translating, or check a draft you already have?";
}

/**
 * Prompt fragment injected when the clarify question should be this turn's
 * single closing question (one-question-per-turn rule still applies).
 */
export function workflowClarifyPromptInstruction(language = "en"): string {
  return `## Session start — ask how they want to work
The user has loaded a passage but has not said whether they want to study it, translate it, or check a draft. End your reply with exactly ONE simple question asking which they'd like — study the passage first, start translating, or check a draft they already have. In the conversation language, e.g.: "${buildWorkflowClarifyQuestion(language)}" Use this as your ONLY closing question this turn (no other question).`;
}

/** Short one-line UI hint (EN). Icon-first UIs may show this as title/aria only. */
export function workflowModeHint(mode: WorkflowMode, language = "en"): string {
  const es = language.toLowerCase().startsWith("es");
  switch (mode) {
    case "study":
      return es
        ? "Contexto y panorama — sin borrador aún"
        : "Context & overview — not drafting yet";
    case "translate":
      return es
        ? "Escribe en Mi traducción — preguntas sobre frases difíciles"
        : "Draft in My translation — Q&A on hard phrases";
    case "check":
      return es
        ? "Lista de revisión TN/TW/TQ — sin calificar tu texto"
        : "TN/TW/TQ checklist — no grading your wording";
  }
}

export function panelEmphasisForMode(
  mode: WorkflowMode,
): WorkflowPanelEmphasis {
  switch (mode) {
    case "study":
      return "context";
    case "translate":
      return "draft";
    case "check":
      return "checklist";
  }
}

/**
 * Coach prompt bias by workflow mode. Injected into system context.
 * Soft guidance — explicit user intents (quiz, Pedir revisión) still win.
 */
export function workflowModePromptBias(mode: WorkflowMode): string {
  switch (mode) {
    case "study":
      return `## Active workflow mode — STUDY
The user is learning the passage (context, overview, sections). Bias this turn toward:
- Pointing to the **Context** tab / intro notes and an overview of sections
- Panel-first reading: when a passage is loaded, the full scripture text (ULT/UST) is already displayed in the resources panel beside the chat — NEVER paste the passage text into your reply; tell them to read it there
- Optional context-quiz offer when natural (do not force)
- Guiding review of the **source** text — not drafting yet, not TN-by-TN checking
- Ending with ONE simple orientation question about the passage (not a drafting prompt)
Soft-pedal: Pedir revisión / sticky Checking checklist / meaning-probes about the wording they chose
If they clearly ask to draft or check, honor that — otherwise stay in study coaching.`;

    case "translate":
      return `## Active workflow mode — TRANSLATE
The user is drafting section-by-section in **Mi traducción**. Bias this turn toward:
- Inviting or supporting drafting; answering questions with TN/TW/scripture helps
- Plain source-language coaching on hard phrases
- Exactly ONE consultant question (what's hard / which phrase) — not a full checklist walk
- **Section drafts only**: Mi traducción accepts a verse or verse range (e.g. TIT 1:1-4), never a whole book or whole chapter. If STUDY CONTEXT shows only a book or chapter (no verse range), nudge them to pick a section first before writing a draft — do not invite drafting the entire chapter.
Do **not** start a sticky CHECKING session or push Pedir revisión / context quiz as the primary move unless they explicitly ask.
If they say they are ready for check / Pedir revisión, honor that.`;

    case "check":
      return `## Active workflow mode — CHECK
The user has (or is finishing) a draft and wants source-side check questions. Bias this turn toward:
- Pedir revisión / sticky checking: walk TN note-by-note, TW term-by-term, TQ via the **Checking checklist**
- Exactly ONE meaning-based CANA probe per turn on a **source** item (the sequence unfolds across turns); emit \`<!-- CHECK:… -->\` when they validate
- Ground every probe in the **loaded** note/TW/TQ body — paraphrase what that resource says; never invent abstract-noun or grammar lectures from training data
- Never ask "How did you translate X?" — ask what the word they chose means in their language instead
- Never ask for / read / grade receptor draft text; never push context quiz as primary
They keep the draft in Mi traducción — you consult with questions only.`;
  }
}

/** True when auto-offering a context/practice quiz fits the mode (Study or Translate). */
export function shouldOfferContextQuiz(mode: WorkflowMode): boolean {
  return mode === "study" || mode === "translate";
}

/** True when coach should prefer sticky checking / checklist focus. */
export function prefersCheckingPath(mode: WorkflowMode): boolean {
  return mode === "check";
}
