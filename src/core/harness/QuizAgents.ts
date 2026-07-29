/**
 * QuizAgents — generate and grade an interactive context quiz for a passage.
 *
 * Questions are grounded in scripture text, genre/text-type, and translation
 * notes. The full quiz is generated once and embedded in a hidden
 * <!-- QUIZ:idx/total [...] --> marker; Path Q reveals/grades one question
 * per turn.
 */

import type { LLMProvider } from "../rag/providers/LLMProvider.js";
import type { EnrichedBundle } from "./budgeter.js";
import type { QuizItem } from "./intent.js";
import { formatQuizKindSuffix, type QuizKind } from "./quizKind.js";

// ---------------------------------------------------------------------------
// Marker + footer helpers
// ---------------------------------------------------------------------------

/** Build the hidden history marker that round-trips quiz state. */
export function buildQuizMarker(
  index: number,
  questions: QuizItem[],
  kind: QuizKind = "context",
): string {
  const kindSuffix = formatQuizKindSuffix(kind);
  return `<!-- QUIZ:${index}/${questions.length}${kindSuffix} ${JSON.stringify(questions)} -->`;
}

/**
 * Panel-mode marker — the quiz renders in the resources panel and this
 * marker only carries the answer key for the panel Submit (Path QP).
 * Unlike `QUIZ:idx`, it must NOT turn subsequent chat messages into
 * Path Q answers (see extractQuizFromHistory / reinforceQuizSession).
 *
 * Optional `kind` distinguishes readiness (`context`) from on-demand
 * practice (`passage` / `practice`) so Path QP does not emit READY for
 * practice quizzes. Omitted / `context` keeps the legacy marker shape.
 */
export function buildQuizPanelMarker(
  questions: QuizItem[],
  kind: QuizKind = "context",
): string {
  const kindSuffix = formatQuizKindSuffix(kind);
  return `<!-- QUIZ:panel/${questions.length}${kindSuffix} ${JSON.stringify(questions)} -->`;
}

/**
 * Terminal marker — ends an active quiz session so later turns do not keep
 * treating user messages as Path Q answers. Must be more recent in history
 * than any `<!-- QUIZ:idx/total [...] -->` marker.
 */
export function buildQuizClearedMarker(): string {
  return `<!-- QUIZ:cleared -->`;
}

/**
 * Deterministic optional secondary quiz offer — used when the LLM formulator
 * fails or when the annotated-brief path falls back without a formulated offer.
 * Prefer folding the offer into `composeAnnotatedGuideReply` or
 * `formulateQuizOfferFooter` at call sites.
 */
export function fallbackQuizOfferFooter(
  language: string,
  total: number,
): string {
  const code = language.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  if (code === "es") {
    return `*(Opcional)* Si quieres, también podemos hacer un breve chequeo de contexto (${total} preguntas) antes de traducir. Si no, seguimos con la nota o un borrador en Mi traducción.`;
  }
  return `*(Optional)* If you'd like, we can also do a short context check (${total} questions) before translating. Otherwise, continue with the note or a draft in My translation.`;
}

/** @deprecated Use fallbackQuizOfferFooter / formulateQuizOfferFooter. */
export const quizOfferFooter = fallbackQuizOfferFooter;

/**
 * Deterministic soft opt-out hint — only shown with question 1.
 * Prefer `formulateQuizProgressFooter` at call sites.
 */
export function fallbackQuizProgressFooter(
  language: string,
  askedIndex: number,
  _total: number,
): string {
  // Progress is shown via the **N/M** prefix on the question itself.
  // Soft opt-out hint only on the first question; later turns stay clean.
  if (askedIndex !== 1) return "";
  const code = language.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  if (code === "es") {
    return `*(Si prefieres omitir el cuestionario, dímelo.)*`;
  }
  return `*(If you'd rather skip the quiz, just say so.)*`;
}

/** @deprecated Use fallbackQuizProgressFooter / formulateQuizProgressFooter. */
export const quizProgressFooter = fallbackQuizProgressFooter;

/** Deterministic wrap-up after the last question — used when LLM formulator fails. */
export function fallbackQuizCompleteMessage(language: string): string {
  const code = language.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  if (code === "es") {
    return "¡Buen trabajo! Ya tienes el contexto del pasaje. Lee el texto en el panel: ¿qué te resulta más difícil de traducir, o quieres escribir un borrador en Mi traducción?";
  }
  return "Nice work — you've got the context for this passage. Read the text in the panel: what's hardest to translate, or would you like to write a draft in My translation?";
}

/** @deprecated Use fallbackQuizCompleteMessage / formulateQuizCompleteMessage. */
export const quizCompleteMessage = fallbackQuizCompleteMessage;

/** Deterministic skip acknowledgement — used when LLM formulator fails. */
export function fallbackQuizSkippedMessage(language: string): string {
  const code = language.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  if (code === "es") {
    return "De acuerdo, omitimos el cuestionario. Las notas y el texto están listos en el panel. ¿Qué parte no sabes cómo traducir todavía?";
  }
  return "Okay, skipping the quiz. The notes and text are ready in the panel. What don't you know how to translate yet?";
}

/** @deprecated Use fallbackQuizSkippedMessage / formulateQuizSkippedMessage. */
export const quizSkippedMessage = fallbackQuizSkippedMessage;

// ---------------------------------------------------------------------------
// Context-note section parsing
// ---------------------------------------------------------------------------

/** One meaningful section of a book/chapter intro note. */
export interface NoteSection {
  title: string;
  content: string;
}

/** Hard cap on quiz length — coverage over depth, but keep the quiz doable. */
export const MAX_QUIZ_QUESTIONS = 12;

/** Minimum cleaned-content length for a section to be quiz-worthy. */
const MIN_SECTION_CHARS = 60;

/** Strip TN link markup so section content reads as plain prose. */
function cleanNoteMarkup(text: string): string {
  return (
    text
      // (See: [[rc://*/ta/man/translate/...]]) → drop entirely
      .replace(/\(\s*See:?\s*\[\[rc:\/\/[^\]]*\]\]\s*\)/gi, "")
      .replace(/\[\[rc:\/\/[^\]]*\]\]/g, "")
      // [1:1-16](../01/01.md) → 1:1-16
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Parse the markdown structure of a Door43 TN intro note (book or chapter)
 * into meaningful sections.
 *
 * Real intro-note shape (e.g. TIT front:intro / 1:intro):
 *   `#` document title (skipped),
 *   `##` group or section headings ("Part 1: General Introduction",
 *        "Structure and Formatting"),
 *   `###` subsection headings ("Who wrote the book of Titus?", "Elders").
 *
 * A heading becomes a section when it has direct body content; pure group
 * headings (a `##` immediately followed by `###`) carry no content and are
 * dropped. Bold-only lines (`**Title**`) are treated as pseudo-headings.
 * Trivial/empty sections are skipped.
 */
export function parseNoteSections(markdown: string): NoteSection[] {
  const sections: NoteSection[] = [];
  let current: { title: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const content = cleanNoteMarkup(current.lines.join("\n"));
    if (content.length >= MIN_SECTION_CHARS) {
      sections.push({ title: current.title, content });
    }
    current = null;
  };

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    // `#` document title — not a section.
    if (/^#\s+/.test(line)) {
      flush();
      continue;
    }
    const heading = /^#{2,4}\s+(.+)$/.exec(line);
    const boldOnly = /^\*\*([^*]+)\*\*:?\s*$/.exec(line);
    if (heading || boldOnly) {
      flush();
      const title = cleanNoteMarkup(
        (heading?.[1] ?? boldOnly?.[1] ?? "").trim(),
      );
      if (title) current = { title, lines: [] };
      continue;
    }
    if (current) current.lines.push(rawLine);
  }
  flush();
  return sections;
}

/**
 * Collect sections across all context notes in the bundle (book intro first,
 * then chapter intro — insertion order). Notes without markdown headings
 * (verse-scoped TN) contribute nothing, so callers fall back to the legacy
 * note-list generation path.
 */
export function collectNoteSections(bundle: EnrichedBundle): NoteSection[] {
  const sections: NoteSection[] = [];
  const seen = new Set<string>();
  for (const n of bundle.notes) {
    const text = typeof n.text === "string" ? n.text : "";
    if (!/(^|\n)#{1,4}\s+/.test(text)) continue;
    for (const s of parseNoteSections(text)) {
      const key = s.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sections.push(s);
    }
  }
  return sections.slice(0, MAX_QUIZ_QUESTIONS);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function desiredQuestionCount(bundle: EnrichedBundle): number {
  // Scale 3–5 by approximate verse span / note density.
  const verseHints = new Set<string>();
  for (const n of bundle.notes) {
    if (n.verse) verseHints.add(String(n.verse));
  }
  const noteCount = bundle.notes.length;
  const verseCount = verseHints.size || Math.max(1, Math.ceil(noteCount / 3));
  if (verseCount <= 2 && noteCount <= 4) return 3;
  if (verseCount >= 6 || noteCount >= 12) return 5;
  return 4;
}

function buildQuizContext(bundle: EnrichedBundle, reference: string): string {
  let ctx = `# Passage: ${reference}\n\n`;

  if (bundle.scriptures.length > 0) {
    ctx += `## Scripture\n`;
    for (const s of bundle.scriptures.slice(0, 2)) {
      const text = s.text.trim().slice(0, 2500);
      ctx += `### ${s.label}\n\`\`\`\n${text}\n\`\`\`\n\n`;
    }
  } else if (bundle.scripture?.versions[0]?.text) {
    ctx += `## Scripture\n\`\`\`\n${bundle.scripture.versions[0].text.trim().slice(0, 2500)}\n\`\`\`\n\n`;
  }

  if (bundle.notes.length > 0) {
    ctx += `## Translation Notes (use as the main source of challenge questions)\n`;
    for (const n of bundle.notes.slice(0, 20)) {
      const quote = n.quote ? ` [${n.quote}]` : "";
      const verse = n.verse ? `v.${n.verse}` : "";
      ctx += `- ${verse}${quote}: ${n.text.trim().slice(0, 280)}\n`;
    }
    ctx += "\n";
  }

  return ctx;
}

const GENERATE_SYSTEM = `You create a short context quiz for a Bible translator before they translate a passage.

Goals:
- Help the translator confirm they understand the passage context for its text type (narrative, teaching, letter, poetry, list, dialogue, etc.).
- Ground questions in the scripture AND the translation notes (who/what/why, genre implications, issues the notes flag).
- Do NOT ask about how to word a translation yet — only context comprehension.
- Write EVERY question, answer, and option in the user's language (BCP-47 code given).
- Use everyday words a beginner understands — no unexplained linguistic jargon.
- Keep questions answerable in 1–2 short sentences.
- Provide a clear expected answer for grading.
- For each question also provide 3–4 short multiple-choice "options". Exactly ONE option must be correct and must be IDENTICAL to "a". The other options must be plausible but clearly wrong according to the notes. Keep each option under 15 words.

Return ONLY valid JSON (no markdown fences):
{"questions":[{"q":"...","a":"...","options":["...","...","..."]},...]}`;

const GENERATE_SECTIONS_SYSTEM = `You create a context quiz for a Bible translator from the intro notes of a book/chapter. The notes are split into NUMBERED SECTIONS.

Rules:
- Generate AT LEAST ONE question for EVERY section — the quiz must cover the whole context note. Never skip a section.
- Tag each question with the section number it covers: "section": N.
- A rich section may get a second question, but coverage of all sections comes first.
- Ground every question, answer, and wrong option ONLY in the section content given.
- Do NOT ask about how to word a translation yet — only context comprehension.
- Write EVERY question, answer, and option in the user's language (BCP-47 code given).
- Use everyday words a beginner understands — no unexplained linguistic jargon.
- Provide a clear expected answer for grading.
- For each question provide 3–4 short multiple-choice "options". Exactly ONE option must be correct and must be IDENTICAL to "a". The other options must be plausible but clearly wrong according to the notes. Keep each option under 15 words.

Return ONLY valid JSON (no markdown fences):
{"questions":[{"section":1,"q":"...","a":"...","options":["...","...","..."]},...]}`;

/** Render the numbered section list for the section-driven prompt. */
function buildSectionContext(
  sections: NoteSection[],
  reference: string,
): string {
  let ctx = `# Context notes for: ${reference}\n\n`;
  sections.forEach((s, i) => {
    ctx += `## Section ${i + 1}: ${s.title}\n${s.content.slice(0, 700)}\n\n`;
  });
  return ctx;
}

/** First usable statement of a section, trimmed for option display. */
function keyStatement(content: string, maxChars = 100): string {
  const line =
    content
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
      .find((l) => l.length >= 15) ?? content.trim();
  const sentence = line.split(/(?<=[.!?])\s+/)[0] ?? line;
  if (sentence.length <= maxChars) return sentence;
  const cut = sentence.slice(0, maxChars);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}…`;
}

/**
 * Deterministic recall question for a section the LLM missed — the correct
 * option is a statement from the missed section; distractors are statements
 * from other sections (note-grounded, plausible but wrong).
 */
export function buildSectionBackfillQuestion(
  section: NoteSection,
  allSections: NoteSection[],
  language: string,
): QuizItem {
  const es = language.trim().toLowerCase().startsWith("es");
  const q = es
    ? `Según las notas de contexto, ¿cuál afirmación corresponde a la sección «${section.title}»?`
    : `According to the context notes, which statement matches the "${section.title}" section?`;
  const a = keyStatement(section.content);
  const distractors = allSections
    .filter((s) => s !== section && s.title !== section.title)
    .map((s) => keyStatement(s.content))
    .filter((d) => d.toLowerCase() !== a.toLowerCase())
    .slice(0, 3);
  const options = normalizeQuizOptions(a, [a, ...distractors]);
  return options ? { q, a, options } : { q, a };
}

type SectionTaggedItem = QuizItem & { section: number };

/** Parse + normalize a section-tagged LLM quiz payload. */
function parseSectionQuizPayload(
  raw: string,
  sectionCount: number,
): SectionTaggedItem[] {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  let parsed: {
    questions?: Array<QuizItem & { options?: unknown; section?: unknown }>;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
  } catch {
    return [];
  }
  return (parsed.questions ?? [])
    .filter(
      (item) =>
        item && typeof item.q === "string" && typeof item.a === "string",
    )
    .map((item) => {
      const a = item.a.trim();
      const options = normalizeQuizOptions(a, item.options);
      const section =
        typeof item.section === "number" &&
        item.section >= 1 &&
        item.section <= sectionCount
          ? Math.floor(item.section)
          : 0;
      return {
        q: item.q.trim(),
        a,
        ...(options ? { options } : {}),
        section,
      };
    })
    .filter((item) => item.q.length > 0 && item.a.length > 0);
}

/**
 * Keep ≤2 questions per section and enforce the overall cap while preserving
 * one-question-per-section coverage: extras are dropped before coverage.
 */
function capWithCoverage(
  items: SectionTaggedItem[],
  cap: number,
): SectionTaggedItem[] {
  const primary: SectionTaggedItem[] = [];
  const extras: SectionTaggedItem[] = [];
  const perSection = new Map<number, number>();
  for (const item of items) {
    const used = perSection.get(item.section) ?? 0;
    if (item.section > 0 && used === 0) primary.push(item);
    else if (used < 2) extras.push(item);
    else continue;
    perSection.set(item.section, used + 1);
  }
  const kept = primary.slice(0, cap);
  for (const extra of extras) {
    if (kept.length >= cap) break;
    kept.push(extra);
  }
  // Stable section order (backfill/extras appended out of order).
  return kept.sort((x, y) => (x.section || 99) - (y.section || 99));
}

/**
 * Section-driven generation: ≥1 question per section of the context note.
 * Coverage is validated; missing sections get one LLM retry, then a
 * deterministic note-grounded backfill question.
 */
async function generateSectionQuiz(
  sections: NoteSection[],
  reference: string,
  language: string,
  llm: LLMProvider,
): Promise<QuizItem[]> {
  const context = buildSectionContext(sections, reference);
  const ask = (extra: string) =>
    llm.generate(
      [
        { role: "system", content: GENERATE_SECTIONS_SYSTEM },
        {
          role: "user",
          content:
            `${context}\n` +
            `Language for questions/answers: ${language}\n` +
            `Generate one question for each of these ${sections.length} sections (sections 1 to ${sections.length}). ` +
            `At least ${sections.length} questions, at most ${MAX_QUIZ_QUESTIONS} total.` +
            `${extra} Return JSON only.`,
        },
      ],
      { maxTokens: 3200, temperature: 0.4 },
    );

  let items: SectionTaggedItem[] = [];
  try {
    items = parseSectionQuizPayload(await ask(""), sections.length);
  } catch {
    items = [];
  }

  const covered = new Set(items.map((i) => i.section));
  const missing = sections.map((_, i) => i + 1).filter((n) => !covered.has(n));

  // One retry when coverage is incomplete, naming the missed sections.
  if (missing.length > 0) {
    try {
      const retry = parseSectionQuizPayload(
        await ask(
          ` Your previous attempt missed section(s) ${missing.join(", ")} — every section MUST have a question.`,
        ),
        sections.length,
      );
      if (retry.length > 0) items = retry;
    } catch {
      // keep first-pass items
    }
  }

  // Deterministic backfill for any still-missing section.
  const finalCovered = new Set(items.map((i) => i.section));
  for (let n = 1; n <= sections.length; n++) {
    if (finalCovered.has(n)) continue;
    items.push({
      ...buildSectionBackfillQuestion(sections[n - 1], sections, language),
      section: n,
    });
  }

  return capWithCoverage(items, MAX_QUIZ_QUESTIONS).map(
    ({ section: _section, ...item }) => item,
  );
}

/**
 * Validate / normalize an LLM-produced options array for one question.
 * Ensures the expected answer is present, options are unique non-empty
 * strings, and the list has 3–4 entries. Returns undefined when unusable
 * (question degrades to open-ended for chat Path Q).
 */
export function normalizeQuizOptions(
  expected: string,
  raw: unknown,
): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const options: string[] = [];
  for (const o of raw) {
    if (typeof o !== "string") continue;
    const t = o.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(t);
  }
  const expectedTrim = expected.trim();
  if (!seen.has(expectedTrim.toLowerCase())) {
    options.unshift(expectedTrim);
  }
  if (options.length < 3) return undefined;
  // Cap at 4 but never drop the correct answer.
  if (options.length > 4) {
    const kept = options.slice(0, 4);
    if (!kept.some((o) => o.toLowerCase() === expectedTrim.toLowerCase())) {
      kept[kept.length - 1] = expectedTrim;
    }
    return kept;
  }
  return options;
}

/**
 * Generate context-comprehension Q+A pairs for the passage.
 *
 * When the bundle carries structured intro notes (book/chapter context from
 * get_passage_context), the quiz is section-driven: ≥1 question per section
 * of the note so the quiz covers the whole context (capped at
 * MAX_QUIZ_QUESTIONS). Otherwise falls back to the legacy 3–5 question path
 * over verse-scoped notes. Returns [] on failure so callers can degrade
 * gracefully (no offer).
 */
export async function generateQuiz(
  bundle: EnrichedBundle,
  reference: string,
  language: string,
  llm: LLMProvider,
): Promise<QuizItem[]> {
  const sections = collectNoteSections(bundle);
  if (sections.length >= 2) {
    try {
      const items = await generateSectionQuiz(
        sections,
        reference,
        language,
        llm,
      );
      if (items.length > 0) return items;
    } catch {
      // fall through to the legacy path
    }
  }

  const count = desiredQuestionCount(bundle);
  const context = buildQuizContext(bundle, reference);
  if (
    !context.includes("## Scripture") &&
    !context.includes("## Translation Notes")
  ) {
    return [];
  }

  try {
    const raw = await llm.generate(
      [
        { role: "system", content: GENERATE_SYSTEM },
        {
          role: "user",
          content:
            `${context}\n` +
            `Language for questions/answers: ${language}\n` +
            `Create exactly ${count} questions (between 3 and 5). Return JSON only.`,
        },
      ],
      { maxTokens: 1400, temperature: 0.4 },
    );

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as {
      questions?: Array<QuizItem & { options?: unknown }>;
    };
    const items = (parsed.questions ?? [])
      .filter(
        (item) =>
          item && typeof item.q === "string" && typeof item.a === "string",
      )
      .map((item) => {
        const a = item.a.trim();
        const options = normalizeQuizOptions(a, item.options);
        return options
          ? { q: item.q.trim(), a, options }
          : { q: item.q.trim(), a };
      })
      .filter((item) => item.q.length > 0 && item.a.length > 0)
      .slice(0, 5);

    return items.length >= 3 ? items : items.length > 0 ? items : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export type GradeVerdict = "correct" | "partial" | "wrong";

export interface GradeResult {
  verdict: GradeVerdict;
  /** Feedback in the user's language; always states the right answer when wrong/partial. */
  feedback: string;
}

const GRADE_SYSTEM = `You grade a translator's short answer to a Bible context quiz question.

Rules:
- Be encouraging and brief (1–3 sentences) unless this is the final question (see user message).
- verdict must be one of: "correct", "partial", "wrong".
- If verdict is not "correct", ALWAYS state the right answer clearly.
- Write feedback in the source/conversation language (BCP-47 code given) — never switch into a receptor/target language.
- Do not invent passage facts beyond the expected answer and the user's reply.
- When this is NOT the final question: Do NOT invite them to skip remaining questions or jump to drafting — the host will ask the next quiz question automatically.
- When this IS the final question: after the grade feedback, continue in the same reply with a short wrap-up that affirms they have the passage context, points them to the text in the resources panel, and ends with exactly ONE question (what's hardest to translate, or invite a draft in Mi traducción / My translation). Still return a single "feedback" string containing grade + wrap-up.

Return ONLY valid JSON (no markdown fences):
{"verdict":"correct|partial|wrong","feedback":"..."}`;

export interface GradeAnswerOptions {
  /** When true, fold the post-quiz wrap-up into the feedback (one LLM call). */
  isFinal?: boolean;
}

/**
 * Grade a user's answer against the expected answer.
 * On the final question, fold the wrap-up invitation into the same feedback.
 */
export async function gradeAnswer(
  question: string,
  expected: string,
  userAnswer: string,
  language: string,
  llm: LLMProvider,
  opts?: GradeAnswerOptions,
): Promise<GradeResult> {
  const isFinal = Boolean(opts?.isFinal);
  try {
    const raw = await llm.generate(
      [
        { role: "system", content: GRADE_SYSTEM },
        {
          role: "user",
          content:
            `Language: ${language}\n` +
            `Question: ${question}\n` +
            `Expected answer: ${expected}\n` +
            `User answer: ${userAnswer}\n` +
            `Final question of quiz: ${isFinal ? "yes" : "no"}\n` +
            `Return JSON only.`,
        },
      ],
      { maxTokens: isFinal ? 320 : 220, temperature: 0.2 },
    );

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackGrade(expected, language, isFinal);
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      verdict?: string;
      feedback?: string;
    };
    const verdict: GradeVerdict =
      parsed.verdict === "correct" ||
      parsed.verdict === "partial" ||
      parsed.verdict === "wrong"
        ? parsed.verdict
        : "partial";
    let feedback =
      typeof parsed.feedback === "string" && parsed.feedback.trim()
        ? parsed.feedback.trim()
        : fallbackGrade(expected, language, isFinal).feedback;
    // If the model graded the final question but omitted a wrap-up closer, append fallback.
    if (
      isFinal &&
      !/[？?]\s*$/.test(feedback.replace(/<!--[\s\S]*?-->/g, "").trim())
    ) {
      feedback = `${feedback}\n\n${fallbackQuizCompleteMessage(language)}`;
    }
    return { verdict, feedback };
  } catch {
    return fallbackGrade(expected, language, isFinal);
  }
}

function fallbackGrade(
  expected: string,
  language: string,
  isFinal = false,
): GradeResult {
  const code = language.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  const grade =
    code === "es"
      ? `Buena tentativa. La respuesta esperada es: ${expected}`
      : `Nice try. The expected answer is: ${expected}`;
  return {
    verdict: "partial",
    feedback: isFinal
      ? `${grade}\n\n${fallbackQuizCompleteMessage(language)}`
      : grade,
  };
}

// ---------------------------------------------------------------------------
// Panel-quiz result feedback (one coherent reply for a full submission)
// ---------------------------------------------------------------------------

const RESULT_FEEDBACK_SYSTEM = `You are Ezer, an encouraging Bible translation consultant. The user just submitted a multiple-choice context quiz from the resources panel and it has ALREADY been graded deterministically — do NOT re-grade.

Write ONE warm, coherent reply in the user's language:
- Open by acknowledging what they got right (be specific about the ideas, not question numbers).
- For each miss, gently give the correct idea in plain words, grounded in the expected answer provided. Never scold.
- If they passed (majority correct — score says PASSED), affirm they understand the context and invite them onward (what's hard to translate, or draft in Mi traducción / My translation).
- If they did NOT pass (score says NOT PASSED): encourage them to re-read the context notes in the resources panel, then ask ONE clear confirmation question whether they are ready to try a fresh quiz. Do NOT claim they passed. Do NOT only report a score.
- 4–8 short sentences. Plain words, no jargon, no markdown headings, no numbered interrogation.
- End with exactly ONE gentle question.
- Never mention readiness systems, markers, or technical internals.`;

/**
 * Compose Ezer's single encouraging chat reply for a graded panel-quiz
 * submission. Falls back to deterministic feedback when the LLM call fails
 * (caller supplies the fallback text).
 */
export async function generateQuizResultFeedback(
  results: Array<{
    q: string;
    expected: string;
    chosen: string | null;
    correct: boolean;
  }>,
  reference: string,
  language: string,
  llm: LLMProvider,
): Promise<string | null> {
  try {
    const lines = results
      .map(
        (r, i) =>
          `${i + 1}. Q: ${r.q}\n   Expected: ${r.expected}\n   User chose: ${r.chosen ?? "(unanswered)"}\n   Graded: ${r.correct ? "CORRECT" : "WRONG"}`,
      )
      .join("\n");
    const correct = results.filter((r) => r.correct).length;
    const total = results.length;
    const passed = total > 0 && correct * 2 > total;
    const text = await llm.generate(
      [
        { role: "system", content: RESULT_FEEDBACK_SYSTEM },
        {
          role: "user",
          content:
            `Language: ${language}\nPassage: ${reference}\n` +
            `Score: ${correct}/${total} — ${passed ? "PASSED" : "NOT PASSED"} ` +
            `(pass = strictly more than half correct)\n\n${lines}`,
        },
      ],
      { maxTokens: 400, temperature: 0.5 },
    );
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
