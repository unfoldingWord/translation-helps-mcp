/**
 * PassageAnnotator — turns a raw scripture bundle into an annotated passage
 * with a structured list of translation challenges.
 *
 * Flow:
 *   1. Infer challenge category from TN supportReference slug (no LLM needed).
 *   2. Send ULT text + all notes + TWL origWords to the AnnotatorAgent LLM.
 *   3. LLM bolds the challenged phrases inside the passage text and extracts
 *      the AT (Alternate Translation) from each note.
 *   4. Return: annotated passage markdown + typed Challenge[].
 *
 * The AnnotatorAgent is the only LLM call needed for the annotated_passage path.
 * All subsequent phrase_drill calls work from the Challenge list in history.
 */

import type { LLMProvider } from "../rag/providers/LLMProvider.js";
import type { EnrichedBundle } from "./budgeter.js";
import {
  CHAT_WORD_BUDGETS,
  enforceReplyBudget,
  maxTokensForWordBudget,
  pacingPromptInstructions,
} from "./chatPacing.js";
import { fallbackQuizOfferFooter } from "./QuizAgents.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChallengeCategory =
  | "figure-of-speech"
  | "double-meaning"
  | "idiom"
  | "grammar"
  | "key-term"
  | "name"
  | "cultural"
  | "other";

/**
 * Whether this challenge originated from a Translation Note (TN) or a
 * Translation Word Link (TW).  Drives distinct visual treatment in the UI.
 */
export type ChallengeSource = "tn" | "tw";

export interface Challenge {
  /** 1-based display index. */
  index: number;
  /** Verse number string, e.g. "3". */
  verse: string;
  /**
   * English phrase in the ULT that needs attention.
   * Determined by the AnnotatorAgent from the note context.
   */
  phrase: string;
  /** One-sentence description of the challenge (from the note summary). */
  noteText: string;
  /**
   * The verbatim Translation Note body text (up to 300 chars).
   * Used by handlePhraseDrill to cite the exact resource rather than hallucinating.
   */
  rawNoteText?: string;
  /**
   * The raw `quote` field from the TN TSV — the original-language words this note covers.
   * Used to connect user phrases back to the source note.
   */
  rawQuote?: string;
  /** Broad category inferred from supportReference slug. */
  category: ChallengeCategory;
  /** Whether this came from a Translation Note or Translation Word link. */
  sourceType: ChallengeSource;
  /** rc:// or TA path for the translation principle (from TN supportReference). */
  supportReference?: string;
  /** Clean TW path for get_word_article, e.g. "bible/kt/life". */
  wordPath?: string;
  /** Alternate Translation extracted from the note text, if any. */
  at?: string;
}

export interface AnnotatedPassageResult {
  /** Passage markdown with challenged phrases in **bold** (from the primary/ULT source). */
  passage: string;
  /** Structured challenge list for UI buttons and phrase_drill routing. */
  challenges: Challenge[];
  /** Human-readable label of the scripture translation used, e.g. "ULT". */
  sourceLabel?: string;
  /** Additional scripture translations shown below the annotated passage (e.g. UST). */
  otherScriptures?: Array<{ label: string; text: string }>;
}

// ---------------------------------------------------------------------------
// Category inference (no LLM — pure slug mapping)
// ---------------------------------------------------------------------------

function inferCategory(
  supportReference: string | undefined,
): ChallengeCategory {
  if (!supportReference) return "other";
  const ref = supportReference.toLowerCase();

  if (ref.includes("figs-double")) return "double-meaning";
  if (ref.includes("figs-idiom")) return "idiom";
  if (ref.includes("figs-")) return "figure-of-speech";
  if (ref.includes("grammar-")) return "grammar";
  if (ref.includes("translate-names")) return "name";
  if (ref.includes("translate-unknown") || ref.includes("translate-terms"))
    return "key-term";
  if (ref.includes("tw/dict")) return "key-term";
  if (ref.includes("culture")) return "cultural";
  return "other";
}

// ---------------------------------------------------------------------------
// Minimal i18n for user-facing strings in the annotated response
// ---------------------------------------------------------------------------

type I18nStrings = {
  translationNotes: string;
  keyTerms: string;
  contextHeader: string;
  whichPhrase: (n: number) => string;
  badges: Record<ChallengeCategory, string>;
};

const I18N: Record<string, I18nStrings> = {
  en: {
    translationNotes: "📝 **Translation Notes**",
    keyTerms: "📖 **Key Terms**",
    contextHeader: "📖 Book / Chapter Context",
    whichPhrase: (n) =>
      `Which phrase do you want to explore? **Type a number** (1–${n}) or **click a button below**`,
    badges: {
      "figure-of-speech": "🌀 Figure",
      "double-meaning": "🔀 Double meaning",
      idiom: "💬 Idiom",
      grammar: "✏️ Grammar",
      "key-term": "📚 Key term",
      name: "📛 Name",
      cultural: "🏛 Cultural",
      other: "⚠️ Note",
    },
  },
  es: {
    translationNotes: "📝 **Notas de Traducción**",
    keyTerms: "📖 **Términos Clave**",
    contextHeader: "📖 Contexto del libro/capítulo",
    whichPhrase: (n) =>
      `¿Qué frase deseas explorar? **Escribe un número** (1–${n}) o **haz clic en un botón abajo**`,
    badges: {
      "figure-of-speech": "🌀 Figura retórica",
      "double-meaning": "🔀 Doble sentido",
      idiom: "💬 Modismo",
      grammar: "✏️ Gramática",
      "key-term": "📚 Término clave",
      name: "📛 Nombre",
      cultural: "🏛 Cultural",
      other: "⚠️ Nota",
    },
  },
  pt: {
    translationNotes: "📝 **Notas de Tradução**",
    keyTerms: "📖 **Termos-Chave**",
    contextHeader: "📖 Contexto do livro/capítulo",
    whichPhrase: (n) =>
      `Qual frase você quer explorar? **Digite um número** (1–${n}) ou **clique em um botão abaixo**`,
    badges: {
      "figure-of-speech": "🌀 Figura de linguagem",
      "double-meaning": "🔀 Duplo sentido",
      idiom: "💬 Expressão idiomática",
      grammar: "✏️ Gramática",
      "key-term": "📚 Termo-chave",
      name: "📛 Nome",
      cultural: "🏛 Cultural",
      other: "⚠️ Nota",
    },
  },
  fr: {
    translationNotes: "📝 **Notes de Traduction**",
    keyTerms: "📖 **Termes Clés**",
    contextHeader: "📖 Contexte du livre/chapitre",
    whichPhrase: (n) =>
      `Quelle expression souhaitez-vous explorer ? **Tapez un numéro** (1–${n}) ou **cliquez sur un bouton ci-dessous**`,
    badges: {
      "figure-of-speech": "🌀 Figure de style",
      "double-meaning": "🔀 Double sens",
      idiom: "💬 Expression idiomatique",
      grammar: "✏️ Grammaire",
      "key-term": "📚 Terme clé",
      name: "📛 Nom",
      cultural: "🏛 Culturel",
      other: "⚠️ Note",
    },
  },
  id: {
    translationNotes: "📝 **Catatan Penerjemahan**",
    keyTerms: "📖 **Istilah Kunci**",
    contextHeader: "📖 Konteks buku/pasal",
    whichPhrase: (n) =>
      `Frasa mana yang ingin Anda jelajahi? **Ketik angka** (1–${n}) atau **klik tombol di bawah**`,
    badges: {
      "figure-of-speech": "🌀 Kiasan",
      "double-meaning": "🔀 Makna ganda",
      idiom: "💬 Ungkapan",
      grammar: "✏️ Tata bahasa",
      "key-term": "📚 Istilah kunci",
      name: "📛 Nama",
      cultural: "🏛 Budaya",
      other: "⚠️ Catatan",
    },
  },
  sw: {
    translationNotes: "📝 **Maelezo ya Tafsiri**",
    keyTerms: "📖 **Maneno Muhimu**",
    contextHeader: "📖 Muktadha wa kitabu/sura",
    whichPhrase: (n) =>
      `Unataka kuchunguza neno gani? **Andika nambari** (1–${n}) au **bonyeza kitufe hapa chini**`,
    badges: {
      "figure-of-speech": "🌀 Sitiari",
      "double-meaning": "🔀 Maana mbili",
      idiom: "💬 Msemo",
      grammar: "✏️ Sarufi",
      "key-term": "📚 Neno muhimu",
      name: "📛 Jina",
      cultural: "🏛 Utamaduni",
      other: "⚠️ Maelezo",
    },
  },
};

function getI18n(language: string): I18nStrings {
  const base = language.split("-")[0].toLowerCase();
  return I18N[base] ?? I18N["en"];
}

// ---------------------------------------------------------------------------
// Annotator LLM prompt
// ---------------------------------------------------------------------------

function buildAnnotatorSystem(language: string): string {
  const baseLang = language.split("-")[0].toLowerCase();
  const langNote =
    baseLang !== "en"
      ? `\n- The "summary" field MUST be written in ${language}, not in English. Translate technical terms naturally.`
      : "";

  return `You are a Bible translation assistant annotating a scripture passage.

TASK:
1. Read the passage.
2. For EVERY numbered input line (1, 2, 3 ...), find the phrase in the passage.
3. Bold each phrase in the passage using **double asterisks**.
4. Write a 10-word max summary of the translation challenge for that line.
5. Extract AT (Alternate Translation) from note text if present ("AT:" pattern), else null.

OUTPUT FORMAT — return ONLY this, nothing else:

PASSAGE:
[full passage text with challenged phrases bolded]

CHALLENGES:
[JSON array — the number of items MUST equal the number of input lines]

Each item shape:
{"n": 1, "verse": "16", "phrase": "world", "summary": "metonymy for all people", "at": "people in the world"}

CRITICAL RULES:
- You MUST output one item for EVERY numbered input line, in order. NEVER skip a line.
- "n" = the input line number (copy it exactly).
- "verse" = the verse number string (e.g. "16").
- "phrase" = the closest matching phrase from the passage text.
- "at" = use AT_HINT if provided in the input line (it is the full AT text extracted before truncation). If no AT_HINT, look for "AT:" in the note text. If neither, null.
- JSON must be valid (no trailing commas, no comments).
- Output NOTHING outside the PASSAGE: and CHALLENGES: blocks.${langNote}`;
}

// ---------------------------------------------------------------------------
// Main annotator function
// ---------------------------------------------------------------------------

/**
 * Run the AnnotatorAgent: bold challenged phrases in the ULT and return
 * a typed Challenge list built from TN notes + TWL entries.
 */
export async function runAnnotator(
  bundle: EnrichedBundle,
  reference: string,
  language: string,
  llm: LLMProvider,
): Promise<AnnotatedPassageResult> {
  // Pick the primary scripture text (prefer ULT)
  const primary =
    bundle.scriptures.find((s) => s.resourceType === "ult") ??
    bundle.scriptures[0];

  const rawScriptureText =
    primary?.text ?? bundle.scripture.versions?.[0]?.text ?? "";
  // Strip any residual USFM alignment markup that the fetcher might have left in
  const scriptureText = stripUsfmMarkup(rawScriptureText);
  // Short label shown in the response header, e.g. "ULT" from "ULT (Literal)"
  const sourceLabel =
    primary?.label?.split(" ")[0] ?? primary?.label ?? undefined;

  if (!scriptureText || (bundle.notes.length === 0 && bundle.tw.length === 0)) {
    return {
      passage: scriptureText || `*No scripture text found for ${reference}.*`,
      challenges: [],
      sourceLabel,
    };
  }

  // Build the note/term input for the LLM.
  // Each entry is numbered so the LLM can echo back "n" for reliable mapping.
  // Deduplicate notes by (verse, quote) to avoid clutter.
  const noteLines: string[] = [];
  // Parallel metadata array for mapping "n" back to source data after LLM response.
  // rawNoteText and rawQuote are preserved verbatim so phrase_drill can cite them
  // directly rather than relying on the LLM's 10-word summary.
  const inputMeta: Array<{
    sourceType: ChallengeSource;
    supportReference?: string;
    wordPath?: string;
    rawNoteText?: string;
    rawQuote?: string;
  }> = [];

  // Cap TN and TW entries to keep the prompt manageable (LLM skips items if there are too many).
  // Prefer notes that have a quote (specific phrase) over general verse notes.
  const MAX_TN = 6;
  const MAX_TW = 6;

  const seenNoteKeys = new Set<string>();
  const sortedNotes = [...bundle.notes].sort((a, b) => {
    // Prioritise notes that have an explicit quote phrase
    const aHasQuote = a.quote ? 1 : 0;
    const bHasQuote = b.quote ? 1 : 0;
    return bHasQuote - aHasQuote;
  });
  for (const note of sortedNotes) {
    if (noteLines.filter((l) => l.includes("[TN")).length >= MAX_TN) break;
    if (!note.text?.trim()) continue;
    const key = `${note.verse ?? "?"}::${note.quote ?? note.id ?? ""}`;
    if (seenNoteKeys.has(key)) continue;
    seenNoteKeys.add(key);
    const n = noteLines.length + 1;
    // Extract AT from full note text before truncating so the LLM always has the
    // full AT suggestion even when the note body is cut by the slice below.
    const atMatch = note.text.match(/\bAT:\s*(.+?)(?:\s*(?:RC:|$))/s);
    const atHint = atMatch
      ? ` AT_HINT:"${atMatch[1].trim().slice(0, 120)}"`
      : "";
    noteLines.push(
      `${n}. [TN v.${note.verse ?? "?"}] quote="${note.quote ?? ""}" note="${note.text.slice(0, 300)}"${atHint} supportRef="${note.supportReference ?? ""}"`,
    );
    inputMeta.push({
      sourceType: "tn",
      supportReference: note.supportReference,
      wordPath: undefined,
      // Preserve verbatim data so phrase_drill can cite exactly (up to 300 chars)
      rawNoteText: note.text?.trim().slice(0, 300),
      rawQuote: note.quote?.trim() || undefined,
    });
  }
  // Deduplicate TW links by wordPath
  const seenTwPaths = new Set<string>();
  for (const tw of bundle.tw) {
    if (noteLines.filter((l) => l.includes("[TW")).length >= MAX_TW) break;
    const twPath = tw.wordPath ?? tw.path;
    if (!tw.origWords || seenTwPaths.has(twPath)) continue;
    seenTwPaths.add(twPath);
    const n = noteLines.length + 1;
    noteLines.push(
      `${n}. [TW v.${tw.verse ?? "?"}] origWords="${tw.origWords}" wordPath="${twPath}"`,
    );
    inputMeta.push({
      sourceType: "tw",
      supportReference: undefined,
      wordPath: twPath,
    });
  }

  if (noteLines.length === 0) {
    return { passage: scriptureText, challenges: [] };
  }

  const userPrompt = `ULT passage for ${reference}:
${scriptureText}

Input lines (${noteLines.length} total — you MUST produce exactly ${noteLines.length} challenge items):
${noteLines.join("\n")}

Annotate the passage and return a CHALLENGES array with exactly ${noteLines.length} items, one per input line.`;

  let raw: string;
  try {
    raw = await llm.generate([
      { role: "system", content: buildAnnotatorSystem(language) },
      { role: "user", content: userPrompt },
    ]);
  } catch (err) {
    console.error("[PassageAnnotator] LLM error:", err);
    return { passage: scriptureText, challenges: [] };
  }

  // Collect any other scripture translations for display alongside the annotated text.
  // Strip USFM alignment markup here so every consumer receives clean plain text.
  const otherScriptures = bundle.scriptures
    .filter((s) => s !== primary && s.text?.trim())
    .map((s) => ({
      label: s.label ?? s.resourceType?.toUpperCase() ?? "Alt",
      text: stripUsfmMarkup(s.text),
    }));

  const result = parseAnnotatorResponse(
    raw,
    inputMeta,
    reference,
    scriptureText,
  );
  return {
    ...result,
    sourceLabel,
    otherScriptures: otherScriptures.length > 0 ? otherScriptures : undefined,
  };
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Strip accents and lowercase a phrase so that "impiedad" and "Impiedad"
 * (or notes with diacritics vs. without) hash to the same dedup key.
 */
function normalizeForDedup(phrase: string): string {
  return phrase
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

interface LLMChallengeItem {
  /** 1-based index matching the numbered input line */
  n?: number;
  verse: string;
  phrase: string;
  summary: string;
  at?: string | null;
}

function parseAnnotatorResponse(
  raw: string,
  inputMeta: Array<{
    sourceType: ChallengeSource;
    supportReference?: string;
    wordPath?: string;
    rawNoteText?: string;
    rawQuote?: string;
  }>,
  _reference: string,
  fallbackPassage: string,
): AnnotatedPassageResult {
  // Extract PASSAGE section
  const passageMatch = raw.match(/PASSAGE:\s*([\s\S]*?)(?=\nCHALLENGES:|$)/i);
  const passage = passageMatch?.[1]?.trim() ?? fallbackPassage;

  // Extract CHALLENGES JSON array
  const challengesMatch = raw.match(/CHALLENGES:\s*([\s\S]*)/i);
  let llmItems: LLMChallengeItem[] = [];
  if (challengesMatch?.[1]) {
    const jsonText = challengesMatch[1].trim();
    // Find the first [...] block
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        llmItems = JSON.parse(arrayMatch[0]) as LLMChallengeItem[];
      } catch {
        llmItems = [];
      }
    }
  }

  // Build typed Challenge list.
  // Use inputMeta[n-1] to get the correct sourceType/supportReference/wordPath
  // for each challenge, mapping by the "n" field the LLM echoes back.
  const challenges: Challenge[] = [];
  let displayIndex = 0;

  for (const item of llmItems) {
    if (!item?.phrase) continue;
    displayIndex++;

    // Look up metadata by the echoed line number (1-based), fall back to position
    const metaIdx =
      item.n != null && item.n >= 1 ? item.n - 1 : displayIndex - 1;
    const meta = inputMeta[metaIdx] ?? inputMeta[displayIndex - 1];

    const sourceType: ChallengeSource = meta?.sourceType ?? "tn";
    const supportReference = meta?.supportReference;
    const wordPath = meta?.wordPath;
    const category = inferCategory(supportReference ?? wordPath);

    challenges.push({
      index: displayIndex,
      verse: String(item.verse ?? "?"),
      phrase: item.phrase,
      noteText: item.summary ?? "",
      rawNoteText: meta?.rawNoteText,
      rawQuote: meta?.rawQuote,
      category,
      sourceType,
      supportReference,
      wordPath,
      at: item.at ?? undefined,
    });
  }

  // Post-pass: deduplicate by (verse, normalizedPhrase).
  //   • Two TN entries for the same phrase (different original-language quotes)
  //     → keep only the first one (it already has priority due to the quote sort).
  //   • A TW entry that shares (verse, phrase) with an existing TN entry
  //     → drop the TW; the TN is richer for the translator.
  // TN entries always precede TW entries in the `challenges` array because
  // the input loops process sortedNotes before bundle.tw, so the "keep first"
  // rule naturally preserves TN over TW.
  const seenPhraseKeys = new Map<string, ChallengeSource>();
  const dedupedChallenges: Challenge[] = [];
  for (const c of challenges) {
    const key = `${c.verse}::${normalizeForDedup(c.phrase)}`;
    if (seenPhraseKeys.has(key)) continue;
    seenPhraseKeys.set(key, c.sourceType);
    dedupedChallenges.push(c);
  }
  // Re-number surviving entries with sequential 1-based indices.
  const finalChallenges = dedupedChallenges.map((c, i) => ({
    ...c,
    index: i + 1,
  }));

  return { passage, challenges: finalChallenges };
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by ContextHarness to render the response)
// ---------------------------------------------------------------------------

/**
 * Clean raw scripture text for readable chat display.
 *
 * Handles the "BOOK CH:VS N text" format produced when the API assembles
 * verse content as plain text, e.g.:
 *   "TIT 2:12 12 instruyéndonos, para que..."
 *
 * Steps:
 *   1. Strip leading USFM reference prefix  — "TIT 2:12 " / "1CO 15:3-5 "
 *   2. Format inline verse numbers          — "12 text" → "[12] text"
 *   3. Wrap every line in a blockquote      — "> text"
 */
function formatScriptureBlock(text: string): string {
  if (!text.trim()) return "";

  // 1. Strip leading USFM book-code reference prefix
  //    Matches patterns like "TIT 2:12 ", "1CO 15:3-5 ", "MAT 5:1 "
  let cleaned = text.replace(/^[A-Z1-9]{2,4}\s+\d+:\d+(?:-\d+)?\s*/g, "");

  // 2. Format verse numbers that appear at start of text or after a newline,
  //    followed by a space and a letter/quote character:
  //    "12 instruyéndonos" → "[12] instruyéndonos"
  //    Use a broad unicode letter range to cover Latin-extended characters.
  cleaned = cleaned.replace(
    /(^|\n)(\d{1,3})\s+(?=[A-Za-z\u00C0-\u024F\u0400-\u04FF'"«¿¡])/g,
    "$1[$2] ",
  );

  // 3. Wrap each line in a markdown blockquote
  return cleaned
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Strip residual USFM inline markup from scripture text so it renders cleanly.
 * Handles alignment markers (\zaln-s, \zaln-e), word markup (\w ... \w*),
 * verse/chapter markers, and other backslash tags.
 */
function stripUsfmMarkup(text: string): string {
  return (
    text
      // Remove zaln alignment markers (with or without attributes)
      .replace(/\\zaln-[se][^\\]*\\\*/g, "")
      .replace(/\\zaln-[se]\s*\\\*/g, "")
      // Strip \w word|attrs\w*  → keep just the word
      .replace(/\\w\s+(.*?)\|[^\\]+\\w\*/g, "$1")
      // Strip bare \w word\w*  → keep just the word
      .replace(/\\w\s+(.*?)\\w\*/g, "$1")
      // Remove verse markers \v 16 (already handled as superscripts by some tools)
      .replace(/\\v\s+\d+\s*/g, "")
      // Remove chapter markers
      .replace(/\\c\s+\d+\s*/g, "")
      // Remove paragraph/section markers (\p, \q1, \s, \m, etc.)
      .replace(/\\[a-zA-Z0-9]+\*?\s*/g, "")
      // Collapse multiple spaces / blank lines
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

/**
 * LLM-written translation brief for the study-stream UI path.
 * Prefer actionable guidance grounded in TN/challenges — not a resource-count blurb.
 * Matches the user's spoken language (from recent turns) / study language.
 */
export async function composeAnnotatedGuideReply(
  llm: LLMProvider,
  opts: {
    reference: string;
    language: string;
    tnCount: number;
    twCount: number;
    /** Curated challenges / notes to ground priority decisions. */
    challenges?: Array<{
      verse: string;
      phrase: string;
      noteText: string;
      sourceType?: string;
      at?: string;
    }>;
    /** Recent user/assistant turns so the model can match spoken language. */
    recentTurns?: Array<{ role: string; content: string }>;
    /** Optional Study/Translate/Check prompt bias from workflow mode. */
    workflowModeBias?: string;
    /**
     * When set, fold an optional secondary context-quiz offer (~N questions)
     * into this same reply after the main consultant question (no second LLM call).
     */
    optionalQuizQuestions?: number;
  },
): Promise<string> {
  const {
    reference,
    language,
    tnCount,
    twCount,
    challenges = [],
    recentTurns = [],
    workflowModeBias = "",
    optionalQuizQuestions,
  } = opts;

  const recent = recentTurns
    .slice(-6)
    .map((m) => {
      const clean = m.content
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim()
        .slice(0, 240);
      return `${m.role}: ${clean}`;
    })
    .filter((line) => !line.endsWith(": "))
    .join("\n");

  const challengeLines = challenges
    .slice(0, 8)
    .map((c, i) => {
      const at = c.at ? ` AT: "${c.at}"` : "";
      return `${i + 1}. [${c.verse}] "${c.phrase}" — ${c.noteText.slice(0, 160)}${at}`;
    })
    .join("\n");

  const budget =
    CHAT_WORD_BUDGETS.annotated_passage +
    (optionalQuizQuestions && optionalQuizQuestions >= 3 ? 40 : 0);
  const quizOfferInstruction =
    optionalQuizQuestions && optionalQuizQuestions >= 3
      ? `- After your ONE consultant question, add a short separator (\`---\`) and an *(Optional)* secondary soft offer for a brief context check of about ${optionalQuizQuestions} questions before translating. If they decline, they can continue with the note or a draft in Mi traducción. Never make the quiz the main ask.\n`
      : `- Do NOT push a quiz as the main next step. Quiz offers (if any) are handled separately by the system.\n`;
  const system =
    `You are Ezer, a Bible translation consultant in a study UI where scripture and resource cards appear below your message.\n` +
    `Guide them toward CANA quality (Consistent, Accurate, Natural, Clear) — do not lecture, dump notes, or grade unknown receptor-language form. Write a concise **translation brief**.\n` +
    `Cover these moves in order as natural prose (hard cap ≈ ${budget} words). Do NOT print section titles, English scaffolding labels, or numbered headers like "Discourse / structure" or "Coach, then ask":\n` +
    `- Remind them to read the text already in the resources panel (do not re-quote the full passage).\n` +
    `- 1–2 sentences on what this passage is doing (purpose, flow).\n` +
    `- At most **2–3** concrete translation decisions grounded ONLY in the notes/challenges below (ALWAYS paraphrase each note's point in everyday words — never stick on "abstract noun", "passive form", or other TN jargon; never invent guidance not in those notes; include verse + phrase). Save remaining decisions for later turns.\n` +
    `- End with exactly ONE consultant question: what feels hard, which phrase to explore, or invite a draft in Mi traducción. Do NOT ask "How did you translate X?" — ever; after they draft / ask for check, ask what their chosen word means in their language instead. Never instruct them to type a keyword.\n` +
    quizOfferInstruction +
    `${pacingPromptInstructions(budget, { priorityDecisions: true })}\n` +
    `Hard rules:\n` +
    `- Use plain language a beginner understands. ALWAYS paraphrase the loaded note's point: prefer "an idea you can't touch" / "idea / cosa que no se puede tocar" over "abstract noun" / "sustantivo abstracto"; "someone does the action to them" over "passive form"; "a word picture" / "manera de hablar" over unexplained "figure of speech". Never replace the note with a generic linguistics lecture from training data. Never require linguistic/theological jargon to progress.\n` +
    `- Do NOT answer with only counts like "5 notes and 11 terms". Counts may appear once as a brief aside, never as the whole reply.\n` +
    `- Do NOT claim full Translation Word articles were retrieved unless an article body is in the challenge list (they usually are not — key terms may appear as panel links only).\n` +
    `- Do NOT rewrite a model target-language translation. Never claim their wording "sounds right" in their language. Never praise or grade receptor wording they paste in chat.\n` +
    `- Bold the passage reference once. No HTML.\n` +
    `- Never echo prompt scaffolding labels into the reply.\n` +
    (workflowModeBias ? `${workflowModeBias}\n` : "") +
    `Facts:\n` +
    `- Passage: ${reference}\n` +
    `- Translation notes in panel: ${tnCount}\n` +
    `- Key-term links in panel: ${twCount}\n` +
    `- Source / conversation language code: ${language}\n` +
    (challengeLines
      ? `\nPriority material from Translation Notes / key terms:\n${challengeLines}\n`
      : `\nNo curated challenge list — still give a brief structure + ask what feels hard or which verse/note to open first.\n`) +
    `Language lock: Always reply in the source/conversation language (${language}). Target/receptor language is metadata only — never switch into it.`;
  const userContent = recent
    ? `Recent conversation:\n${recent}\n\nCompose the translation brief for ${reference} now.`
    : `Compose the translation brief for ${reference}.`;

  try {
    const raw = await llm.generate(
      [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      { maxTokens: maxTokensForWordBudget(budget) },
    );
    const text = raw?.trim() ?? "";
    if (text) {
      // When a quiz offer is folded in after the main question, do not append a
      // second coaching closer (the offer block often does not end with "?").
      let paced = enforceReplyBudget(text, {
        budget,
        language,
        closerKind: "brief",
        ensureCloser: !(optionalQuizQuestions && optionalQuizQuestions >= 3),
      }).text;
      if (
        optionalQuizQuestions &&
        optionalQuizQuestions >= 3 &&
        !/(quiz|cuestionario|chequeo|context check|opcional|optional)/i.test(
          paced,
        )
      ) {
        paced =
          paced.trimEnd() +
          `\n\n---\n${fallbackQuizOfferFooter(language, optionalQuizQuestions)}`;
      }
      return paced;
    }
  } catch (err) {
    console.error("[PassageAnnotator] composeAnnotatedGuideReply error:", err);
  }

  // Deterministic fallback — still a brief, not a count-only line.
  const es = language.toLowerCase().startsWith("es");
  const offerSuffix =
    optionalQuizQuestions && optionalQuizQuestions >= 3
      ? `\n\n---\n${fallbackQuizOfferFooter(language, optionalQuizQuestions)}`
      : "";
  if (challenges.length > 0) {
    const top = challenges
      .slice(0, 3)
      .map(
        (c, i) =>
          `${i + 1}. **${c.verse}** "${c.phrase}" — ${c.noteText.slice(0, 120)}`,
      );
    const brief = es
      ? `**${reference}** — lee el texto en el panel. Decisiones prioritarias:\n\n` +
        `${top.join("\n")}\n\n` +
        `¿Qué te resulta más difícil de «${challenges[0].phrase}», o quieres escribir un borrador en Mi traducción?`
      : `**${reference}** — read the text in the panel. Priority decisions:\n\n` +
        `${top.join("\n")}\n\n` +
        `What's hardest about "${challenges[0].phrase}", or would you like to write a draft in My translation?`;
    return brief + offerSuffix;
  }
  const brief = es
    ? `**${reference}** — el texto y las notas están listos en el panel. ¿Qué parte no sabes cómo traducir todavía, o quieres escribir un borrador en Mi traducción?`
    : `**${reference}** — the text and notes are ready in the panel. What don't you know how to translate yet, or would you like to write a draft in My translation?`;
  return brief + offerSuffix;
}

/**
 * Render the annotated passage response as markdown.
 *
 * When `useUIComponents` is true the numbered challenge list is omitted from
 * the text because the frontend will render an interactive `ChallengeCards`
 * component via the `ui` SSE event instead. Prefer `composeAnnotatedGuideReply`
 * for that path; this sync formatter is for non-UI / fallback only.
 */
export function formatAnnotatedResponse(
  result: AnnotatedPassageResult,
  reference: string,
  language = "en",
  passageContext?: Array<{
    scope: "book" | "chapter";
    title: string;
    body: string;
  }>,
  useUIComponents = false,
): string {
  const { passage, challenges } = result;
  const i18n = getI18n(language);

  if (challenges.length === 0) {
    // Format passage as a labelled blockquote for both display modes.
    // The raw passage text may contain a "BOOK CH:VS N text" prefix that needs
    // stripping before it is shown in the chat.
    const formattedBlock = passage
      ? `\n\n${formatScriptureBlock(passage)}`
      : "";
    const langSuffix = language && language !== "en" ? ` (${language})` : "";

    if (useUIComponents) {
      // Prefer composeAnnotatedGuideReply when an LLM is available.
      const es = language.toLowerCase().startsWith("es");
      return es
        ? `**${reference}${langSuffix}** — el texto está listo en el panel. ¿Qué parte te cuesta traducir?`
        : `**${reference}${langSuffix}** — the text is ready in the panel. Which part is hard for you to translate?`;
    }
    return `**${reference}${langSuffix}**${formattedBlock}\n\n*No specific translation challenges found.*`;
  }

  const tnChallenges = challenges.filter((c) => c.sourceType === "tn");
  const twChallenges = challenges.filter((c) => c.sourceType === "tw");

  if (useUIComponents) {
    // Minimal non-LLM fallback — ContextHarness uses composeAnnotatedGuideReply.
    const es = language.toLowerCase().startsWith("es");
    const top = tnChallenges
      .slice(0, 3)
      .map(
        (c, i) =>
          `${i + 1}. **${c.verse}** "${c.phrase}" — ${c.noteText.slice(0, 100)}`,
      );
    if (top.length > 0) {
      return es
        ? `**${reference}** — decisiones prioritarias (panel):\n\n${top.join("\n")}\n\n¿Qué parte te cuesta traducir — por ejemplo "${tnChallenges[0].phrase}"?`
        : `**${reference}** — priority decisions (panel):\n\n${top.join("\n")}\n\nWhich part is hard for you to translate — for example "${tnChallenges[0].phrase}"?`;
    }
    return es
      ? `**${reference}** — notas y términos listos en el panel. ¿Qué parte te cuesta traducir?`
      : `**${reference}** — notes and terms are ready in the panel. Which part is hard for you to translate?`;
  }

  // ── Full text mode (no workbench) ─────────────────────────────────────────

  // ── Primary scripture ─────────────────────────────────────────────────────
  const primaryLabel = result.sourceLabel ?? "ULT";
  const primaryBlock = `**${primaryLabel}** — ${reference}\n\n${formatScriptureBlock(passage)}`;

  // ── Supporting reads ──────────────────────────────────────────────────────
  const supportingBlocks = (result.otherScriptures ?? [])
    .map((s) => {
      const cleaned = stripUsfmMarkup(s.text);
      return `**${s.label}** — ${cleaned}`;
    })
    .join("\n\n");

  // ── Book / chapter context (collapsible) ──────────────────────────────────
  const MAX_CONTEXT_CHARS = 300;
  let contextBlock = "";
  if (passageContext && passageContext.length > 0) {
    const contextItems = passageContext.map((item) => {
      const body = item.body ?? "";
      const title = item.title ?? "";
      const truncated =
        body.length > MAX_CONTEXT_CHARS
          ? body.slice(0, MAX_CONTEXT_CHARS) + "…"
          : body;
      return `**${title}**\n${truncated}`;
    });
    contextBlock =
      `<details>\n<summary>${i18n.contextHeader}</summary>\n\n` +
      contextItems.join("\n\n") +
      `\n\n</details>`;
  }

  const parts: string[] = [primaryBlock];
  if (supportingBlocks) parts.push(supportingBlocks);
  if (contextBlock) parts.push(contextBlock);
  parts.push("---");

  {
    // ── Challenge sections (full text mode) ──────────────────────────────────
    const challengeSections: string[] = [];

    if (tnChallenges.length > 0) {
      const noteItems = tnChallenges.map((c) => {
        const badge = i18n.badges[c.category] ?? i18n.badges["other"];
        const at = c.at ? `\n   → *"${c.at}"*` : "";
        return `**${c.index}.** ${badge} — **"${c.phrase}"**\n   ${c.noteText}${at}`;
      });
      challengeSections.push(
        `${i18n.translationNotes}\n\n${noteItems.join("\n\n")}`,
      );
    }

    if (twChallenges.length > 0) {
      const twItems = twChallenges.map((c) => {
        return `**${c.index}.** 🔑 **"${c.phrase}"** — ${c.noteText}`;
      });
      challengeSections.push(`${i18n.keyTerms}\n\n${twItems.join("\n\n")}`);
    }

    const lastIndex = challenges[challenges.length - 1].index;
    parts.push(challengeSections.join("\n\n---\n\n"));
    parts.push("---");
    parts.push(i18n.whichPhrase(lastIndex));
  }

  return parts.join("\n\n");
}

/**
 * Build the system prompt for a phrase-drill LLM call.
 * Grounds the response in the exact resources provided — no improvisation.
 */
export function formatDrillSystem(
  challenge: Challenge,
  language = "en",
): string {
  const isKeyTerm = challenge.sourceType === "tw";

  const drillBudget = CHAT_WORD_BUDGETS.phrase_drill;
  const citationInstructions = isKeyTerm
    ? `- Lead with a direct answer to the user's question in 1–2 sentences — do not bury the answer at the end.
- Write conversationally, as an expert colleague talking to a translator. Do NOT use markdown headers (no ###, no bold **section titles**) — use flowing prose with inline citations instead.
- Draw on the Translation Word definition to explain what the term means and why precision matters for this passage, woven naturally into prose. If a Simplified Text (UST/GST) rendering is available, mention how it handles the term in passing.
- Hard cap ≈ ${drillBudget} words. Simple definitional questions deserve 2–3 sentences with inline evidence; do not write a structured essay.
- Cover one focused consulting point; STOP with ONE consultant question: what's hard about this term, or invite a draft in Mi traducción. Do not ask "How did you translate it?" — ever; meaning-probes come after they draft.`
    : `- Lead with a direct answer to the user's question in 1–2 sentences — do not bury the answer at the end.
- Write conversationally, as an expert colleague talking to a translator. Do NOT use markdown headers (no ###, no bold **section titles** like **"What is X?"**) — use flowing prose with inline citations instead.
- Use TN, Simplified Text (UST/GST), and TA only when each is genuinely relevant — you don't need to use all three. When citing the Translation Note, quote it verbatim inline (e.g. "The note says '…'"). When the simplified rendering clarifies meaning, weave it in naturally. When a TA principle applies, state it briefly in prose — always paraphrased in everyday words (never stick on "abstract noun" / "passive form").
- If an Alternate Translation is provided, include it naturally in the prose as an option — not "the correct" translation.
- Hard cap ≈ ${drillBudget} words. Simple definitional questions: 2–3 sentences with inline evidence. Complex multi-part questions: a short paragraph. Do NOT write a structured 4-paragraph essay.
- Cover one focused consulting point; STOP with ONE consultant question: what's hard about this phrase, or invite a draft in Mi traducción. Do not ask "How did you translate X?" — ever; meaning-probes come after they draft.`;

  const langNote =
    `\n\nCRITICAL — language lock: Always reply in the source/conversation language (${language}). ` +
    `Target/receptor language is metadata only — never switch into it, and never praise or grade receptor wording the user pastes.`;

  return `You are a Bible translation consultant explaining one specific challenge so the translator can examine their own choice — not rewriting their draft or grading unknown receptor-language form.

PHRASE: "${challenge.phrase}" (verse ${challenge.verse})
SOURCE TYPE: ${isKeyTerm ? "Translation Word (key term)" : `Translation Note (${challenge.category})`}

YOUR JOB:
${citationInstructions}

GROUNDING RULES — you MUST follow these:
1. Every claim must come from the TRANSLATION NOTE, TRANSLATION WORD, SIMPLIFIED TEXT (UST/GST), or TRANSLATION ACADEMY ARTICLE provided in the context block. Do NOT add information from your training data that is not in the provided resources.
2. Prefer the note and simplified text when a Translation Word article is missing. If an academy article is only available in a different language than the conversation language, briefly paraphrase the idea in the conversation language or skip it and stay with the note/GST.
3. When you quote a resource, say so explicitly in plain words: "The note says…", "La nota dice…", "El texto simplificado…". ALWAYS paraphrase the **loaded note's point** in everyday words — never stick on "abstract noun" / "passive form", and never replace the note with a generic linguistics lecture from training data. If the user doesn't understand a term, redefine *what the note says* simply.
4. If the original-language quote is provided, mention it once to help the translator connect the strategic-language phrase to the source: "This phrase translates the original '…'"
5. Do NOT invent alternate translations beyond what the AT suggestion provides.
6. Keep your response focused and practical — the translator needs to know what to DO. Never require linguistic labels to progress.
7. If the provided resources do not cover the user's question: say so briefly and point them to the panel / offer to load the relevant note — do not fill from training data.
8. **Lead with the answer**: Begin your response with 1–2 sentences that directly address the user's question. Then weave in supporting evidence from the provided resources. If relevant, close with one brief follow-up question for the translator.${langNote}`;
}
