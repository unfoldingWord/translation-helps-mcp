/**
 * PassageOverviewAgents — parallel specialist sub-agents for passage_overview intent.
 *
 * Instead of cramming all resources into one prompt (which forces budget truncation),
 * three agents run in parallel, each owning one resource domain completely:
 *
 *   ScriptureAgent    — all translation versions, identifies sections + structure
 *   NotesAgent        — ALL Translation Notes, identifies challenges + ATs
 *   WordsAcademyAgent — ALL Translation Words + Academy articles, key terms + strategies
 *
 * An Orchestrator agent then receives their summaries and synthesizes a coherent
 * chapter orientation with navigation map.
 *
 * No budget caps are applied here. Each agent gets the full dataset for its domain.
 */

import type { LLMProvider } from "../rag/providers/LLMProvider.js";
import type { EnrichedBundle, ScriptureText } from "./budgeter.js";
import { DEFAULT_WORKFLOW_MODE, type WorkflowMode } from "./workflowMode.js";
// Minimal emit interface — mirrors HarnessEmit to avoid circular imports.
interface OverviewEmit {
  status(text: string): void;
  token(delta: string): void;
  thinking?(label: string, state: "working" | "done"): void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubAgentResult {
  summary: string;
  citations: Array<{ path: string; title?: string }>;
}

export interface OverviewPipelineResult {
  response: string;
  citations: Array<{ path: string; title?: string }>;
}

// ---------------------------------------------------------------------------
// Scripture Agent
// ---------------------------------------------------------------------------

const SCRIPTURE_AGENT_SYSTEM = `You are a Bible text analyst preparing a translation overview.
You will receive scripture translations (ULT = literal, UST = simplified, and possibly others).

Your task — be concise and structured:

1. **Identify 3–5 natural sections** with verse ranges and a one-line description each.
   - Consider narrative shifts, topic changes, or natural paragraph breaks.
   - Format: **v.X–Y: [Title]** — [one sentence description]

2. **Describe the overall structure** (1–2 sentences): Is it narrative, dialogue, teaching, poetry, list?

3. **Note 3 key recurring themes or concepts** the translator should keep in mind throughout.

Do NOT provide translation advice — that is another agent's job. Focus on structure and content.`;

async function runScriptureAgent(
  scriptures: ScriptureText[],
  reference: string,
  llm: LLMProvider,
): Promise<SubAgentResult> {
  if (scriptures.length === 0) {
    return {
      summary: "(No scripture text available for analysis.)",
      citations: [],
    };
  }

  let context = `# Scripture Translations for ${reference}\n\n`;
  for (const s of scriptures) {
    context += `## ${s.label}\n\`\`\`\n${s.text.trim()}\n\`\`\`\n\n`;
  }

  const citations = scriptures.map((s) => ({
    path: `scripture/${s.resourceType}/${reference}`,
    title: s.label,
  }));

  const summary = await llm.generate([
    { role: "system", content: SCRIPTURE_AGENT_SYSTEM },
    {
      role: "user",
      content: `${context}\nPlease analyze ${reference} as described.`,
    },
  ]);

  return { summary, citations };
}

// ---------------------------------------------------------------------------
// Notes Agent
// ---------------------------------------------------------------------------

const NOTES_AGENT_SYSTEM = `You are a Translation Notes analyst preparing a translation overview.
You will receive ALL Translation Notes for a Bible passage — possibly 20–80+ notes.

Your task — be concise and structured:

1. **Select the 7 most important notes** (highest impact for the translator). Prioritize:
   - Notes explaining figures of speech (metaphors, euphemisms, hyperbole, etc.)
   - Notes on theologically significant phrases
   - Notes with helpful Alternate Translations (AT)
   - Notes on cultural context that may be misunderstood

   For each selected note: **[verse ref] "[phrase]"** — [brief explanation]. AT: "[alternate translation]" (if provided).

2. **Categorise ALL notes by type** (count only):
   - Figures of speech: N
   - Theological terms: N
   - Cultural/historical context: N
   - Grammar/syntax issues: N
   - Other: N

3. **Flag 2–3 verses** that have the highest note density or most complex challenges.

Stay factual. Reference the notes as given; do not add interpretation.
RESOURCE GROUNDING: Draw only from the note texts provided. Do not invent translation principles, figures of speech, or abstract-noun guidance from training knowledge that is not in these notes.`;

async function runNotesAgent(
  notes: Array<Record<string, unknown>>,
  reference: string,
  llm: LLMProvider,
): Promise<SubAgentResult> {
  if (notes.length === 0) {
    return {
      summary: "(No Translation Notes available for this passage.)",
      citations: [],
    };
  }

  let context = `# Translation Notes for ${reference} (${notes.length} total)\n\n`;
  for (const note of notes) {
    const id = String(note["id"] ?? "");
    const verse = String(note["verse"] ?? extractVerseFromId(id));
    const text = String(note["text"] ?? "");
    const supportRef = String(
      note["supportReference"] ?? note["externalReference"] ?? "",
    );
    context += `- **v.${verse}** [${id}]: ${text}`;
    if (supportRef) context += ` *(TA: ${supportRef})*`;
    context += "\n";
  }

  const citations: Array<{ path: string; title?: string }> = notes
    .slice(0, 5)
    .map((n) => ({
      path: `tn/${reference}/${String(n["id"] ?? "")}`,
      title: "Translation Note",
    }));

  const summary = await llm.generate([
    { role: "system", content: NOTES_AGENT_SYSTEM },
    {
      role: "user",
      content: `${context}\nPlease analyze these notes for ${reference} as described.`,
    },
  ]);

  return { summary, citations };
}

// ---------------------------------------------------------------------------
// Words + Academy Agent
// ---------------------------------------------------------------------------

const WORDS_ACADEMY_AGENT_SYSTEM = `You are a biblical terminology and translation strategy analyst preparing a translation overview.
You will receive Translation Word (TW) articles and Translation Academy (TA) articles for a Bible passage.

Your task — be concise and structured:

1. **Top 5 theologically/linguistically significant terms** (from TW articles):
   - **[term]**: [core meaning in 1–2 sentences] — Translation challenge: [brief note on how to render it]

2. **Top 3 translation strategies needed** (from TA articles):
   - **[strategy name]**: [why it applies to this passage, with 1 example from the text]

3. **Terms likely to have no equivalent** in many target languages (list only, with brief reason).

4. **Terms that appear multiple times** across the passage (list with count if obvious from context).

Be factual. Draw only from the provided articles.
RESOURCE GROUNDING: Do not invent term definitions or translation strategies from training knowledge. If an article body is missing, say so — do not fill the gap from general knowledge.`;

async function runWordsAcademyAgent(
  tw: Array<Record<string, unknown>>,
  ta: Array<Record<string, unknown>>,
  reference: string,
  llm: LLMProvider,
): Promise<SubAgentResult> {
  if (tw.length === 0 && ta.length === 0) {
    return {
      summary:
        "(No Translation Words or Academy articles available for this passage.)",
      citations: [],
    };
  }

  let context = `# Translation Words for ${reference} (${tw.length} terms)\n\n`;
  for (const t of tw) {
    const title = String(t["title"] ?? t["path"] ?? "");
    const article = String(t["article"] ?? "");
    context += `## ${title} [${t["path"]}]\n`;
    if (article) {
      // Include full article — no truncation
      context += `${article.trim()}\n\n`;
    } else {
      context += `*(Article not yet fetched)*\n\n`;
    }
  }

  if (ta.length > 0) {
    context += `\n# Translation Academy Articles for ${reference} (${ta.length} articles)\n\n`;
    for (const a of ta) {
      const title = String(a["title"] ?? a["path"] ?? "");
      const article = String(a["article"] ?? "");
      context += `## ${title} [${a["path"]}]\n`;
      if (article) {
        context += `${article.trim()}\n\n`;
      }
    }
  }

  const citations: Array<{ path: string; title?: string }> = [
    ...tw.slice(0, 3).map((t) => ({
      path: String(t["path"] ?? ""),
      title: String(t["title"] ?? ""),
    })),
    ...ta.slice(0, 2).map((a) => ({
      path: String(a["path"] ?? ""),
      title: String(a["title"] ?? ""),
    })),
  ];

  const summary = await llm.generate([
    { role: "system", content: WORDS_ACADEMY_AGENT_SYSTEM },
    {
      role: "user",
      content: `${context}\nPlease analyze the terms and strategies for ${reference} as described.`,
    },
  ]);

  return { summary, citations };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Build the orchestrator system prompt for the study language.
 * Structural tokens (☐ N., ✅) stay verbatim; session progress is injected as a
 * hidden <!-- CHECKLIST --> marker by ContextHarness — do NOT emit [Step N/M].
 *
 * `workflowMode` biases the session: Study frames a panel-first *study path*
 * (understanding, not drafting); Translate/Check keep the translation path.
 */
function buildOrchestratorSystem(
  language: string,
  workflowMode: WorkflowMode = DEFAULT_WORKFLOW_MODE,
): string {
  const lang = language?.trim() || "en";
  const study = workflowMode === "study";
  const pathHeading = study
    ? "Your study path for"
    : "Your translation path for";
  const orientationLine = study
    ? `(Write 1–2 real sentences inviting the translator to read the chapter introduction in the Context tab AND the scripture in the Scripture section of the resources panel beside the chat — in ${lang}. Do not output instructional brackets. NEVER paste, quote, or paraphrase intro notes or the passage text; both are already in the panel.)`
    : `(Write 1–2 real sentences orienting the translator: point them to the chapter intro (Context tab) and text in the resources panel — in ${lang}. Do not output instructional brackets. Do not re-quote or paraphrase the full intro notes or passage.)`;
  const stepFiveHint = study
    ? `usually key ideas, key terms, or a comprehension check — NOT drafting`
    : `usually key terms, draft in Mi traducción, or comprehension check`;
  const closingQuestion = study
    ? `End with exactly ONE simple orientation question in ${lang} about the passage itself (what they notice in the text in the panel, which section to explore, what stands out) — NEVER a drafting prompt, NEVER "how would you translate/render/divide this in your translation".`
    : `End with exactly ONE clear consultant question in ${lang}: how they would render a flagged source item, what feels hard, continue to step 2 by name, pick a section, or invite a first draft in Mi traducción.`;
  const modeGuidance = study
    ? `ACTIVE MODE — STUDY: The user explicitly chose to STUDY this passage before drafting. Frame every step around understanding the source — context/setting, sections and flow, key ideas, key terms, comprehension. Do NOT frame steps as drafting or translation-decision tasks, and do not push Mi traducción this turn.`
    : `ACTIVE MODE — ${workflowMode.toUpperCase()}: The user is working toward a draft. Steps guide translation decisions on the source text.`;
  return `You are a Bible translation consultant leading a translator through a structured lesson — not a lecturer dumping notes, and not a grader of unknown receptor-language form.
Three specialist agents have analyzed the passage. Use their reports to build a guided session.

${modeGuidance}

LANGUAGE: Write ALL human-readable text in the user's study language (${lang}).
The specialist reports below are in English — translate/adapt their content into ${lang}.
Do NOT write English labels, headers, or instructions unless ${lang} is English.

Your response MUST follow this exact structure — no exceptions:

---
${orientationLine}

**(Localized equivalent of "${pathHeading}") [passage reference]:**
☐ 1. (brief step title in ${lang})
☐ 2. (brief step title in ${lang})
☐ 3. (brief step title in ${lang})
☐ 4. (brief step title in ${lang})
☐ 5. (brief step title in ${lang} — ${stepFiveHint})
(Add a 6th only if genuinely necessary. 4–6 steps total.)

---
**(Localized "Step 1") — (same title as ☐ 1 above)**

(Present ONLY this step. 80–120 words MAX. Be a consultant: direct, helpful, concrete — in ${lang}.
For a section step: name the sections with verse ranges, one sentence each.
For a challenge: state the problem, offer the AT from the notes as an option (not "the correct" translation), keep it tight.
For a term: give the core meaning + one translation suggestion from the source helps.)

${closingQuestion}
Never instruct them to type a keyword like "next". Never rewrite their draft or claim it "sounds right" in their language.

CRITICAL RULES:
- NEVER echo instructional parentheses, bracketed placeholders, or template meta-text. Example of FORBIDDEN output: "[1-2 sentence orientation to the passage — context, purpose, genre]". Replace every slot with real content in ${lang}.
- Keep these tokens EXACTLY as written (they are parsed by the app): ☐ N.  ✅
- Do NOT write [Step N/M], [Paso N/M], "say next", "di next", or any keyword trigger. The app tracks progress invisibly.
- Visible headings like "Paso 1" / "Step 1" MAY be localized.
- Do NOT present Steps 2–N. They come in subsequent turns.
- Keep Step 1 under 120 words. Quality over quantity.
- The checklist is the path. The step content is the lesson.
- Never rewrite a full model translation for them unless they explicitly ask.
- Never add a batch-session footer — it is appended programmatically.`;
}

async function runOrchestratorAgent(
  scriptureResult: SubAgentResult,
  notesResult: SubAgentResult,
  wordsResult: SubAgentResult,
  reference: string,
  language: string,
  llm: LLMProvider,
  workflowMode: WorkflowMode = DEFAULT_WORKFLOW_MODE,
): Promise<string> {
  const prompt = buildOrchestratorPrompt(
    scriptureResult,
    notesResult,
    wordsResult,
    reference,
    language,
  );
  return llm.generate([
    {
      role: "system",
      content: buildOrchestratorSystem(language, workflowMode),
    },
    { role: "user", content: prompt },
  ]);
}

/**
 * Streaming variant of the orchestrator — yields tokens directly to emit.token
 * when the provider supports generateStream, otherwise falls back to generate().
 */
async function runOrchestratorAgentStream(
  scriptureResult: SubAgentResult,
  notesResult: SubAgentResult,
  wordsResult: SubAgentResult,
  reference: string,
  language: string,
  llm: LLMProvider,
  emit: OverviewEmit,
  workflowMode: WorkflowMode = DEFAULT_WORKFLOW_MODE,
): Promise<string> {
  const messages = [
    {
      role: "system" as const,
      content: buildOrchestratorSystem(language, workflowMode),
    },
    {
      role: "user" as const,
      content: buildOrchestratorPrompt(
        scriptureResult,
        notesResult,
        wordsResult,
        reference,
        language,
      ),
    },
  ];

  if (llm.generateStream) {
    let full = "";
    for await (const chunk of llm.generateStream(messages)) {
      emit.token(chunk);
      full += chunk;
    }
    return full;
  }

  // Fallback: buffer then emit all tokens at once
  const response = await llm.generate(messages);
  for (const char of response) emit.token(char);
  return response;
}

function buildOrchestratorPrompt(
  scriptureResult: SubAgentResult,
  notesResult: SubAgentResult,
  wordsResult: SubAgentResult,
  reference: string,
  language: string,
): string {
  const lang = language?.trim() || "en";
  return `# Sub-Agent Reports for ${reference}

## [SCRIPTURE AGENT]
${scriptureResult.summary}

## [NOTES AGENT]
${notesResult.summary}

## [WORDS + ACADEMY AGENT]
${wordsResult.summary}

Build the guided checklist session for ${reference} as instructed.
Write the entire response in the study language (${lang}).
Show the full checklist upfront, then present ONLY Step 1 in full.
Never echo template placeholders — fill every slot with real ${lang} content.`;
}

// ---------------------------------------------------------------------------
// Main pipeline entry point
// ---------------------------------------------------------------------------

/**
 * Run the full passage-overview sub-agent pipeline.
 *
 * Takes the fully-assembled (uncapped) bundle from ContextHarness,
 * distributes data to three parallel specialist agents, then synthesizes
 * with an orchestrator.
 *
 * When `emit` is provided:
 *  - Each agent emits a `thinking` event immediately when started, and
 *    another `thinking(label, 'done')` event as soon as it resolves.
 *  - The orchestrator streams tokens directly via emit.token (eliminating
 *    the 15–30 s dead window on overview requests).
 */
export async function runOverviewPipeline(
  bundle: EnrichedBundle,
  reference: string,
  language: string,
  llm: LLMProvider,
  emit?: OverviewEmit,
  workflowMode: WorkflowMode = DEFAULT_WORKFLOW_MODE,
): Promise<OverviewPipelineResult> {
  // Sub-agents stay English (intermediate analysis only).
  // The orchestrator localizes the user-facing checklist into `language`.

  // Cast notes and tw/ta to the shape sub-agents expect
  const notes = bundle.notes as unknown as Array<Record<string, unknown>>;
  const tw = bundle.tw as unknown as Array<Record<string, unknown>>;
  const ta = bundle.ta as unknown as Array<Record<string, unknown>>;

  // Announce all three agents as "working" immediately (before any await)
  emit?.thinking?.("Scripture structure", "working");
  emit?.thinking?.("Translation notes", "working");
  emit?.thinking?.("Key terms & academy", "working");

  // Fan-out: launch all three agents and emit 'done' as each one settles.
  // Using Promise.all preserves the parallel execution while letting us emit
  // progress as each agent resolves rather than waiting for all three.
  const agents: Array<{
    label: string;
    promise: Promise<SubAgentResult>;
  }> = [
    {
      label: "Scripture structure",
      promise: runScriptureAgent(bundle.scriptures, reference, llm),
    },
    {
      label: "Translation notes",
      promise: runNotesAgent(notes, reference, llm),
    },
    {
      label: "Key terms & academy",
      promise: runWordsAcademyAgent(tw, ta, reference, llm),
    },
  ];

  const [scriptureResult, notesResult, wordsResult] = await Promise.all(
    agents.map(({ label, promise }) =>
      promise.then((r) => {
        emit?.thinking?.(label, "done");
        return r;
      }),
    ),
  );

  // Synthesize — stream tokens if emit is available
  emit?.status("Synthesizing overview\u2026");
  let response: string;
  if (emit) {
    response = await runOrchestratorAgentStream(
      scriptureResult,
      notesResult,
      wordsResult,
      reference,
      language,
      llm,
      emit,
      workflowMode,
    );
  } else {
    response = await runOrchestratorAgent(
      scriptureResult,
      notesResult,
      wordsResult,
      reference,
      language,
      llm,
      workflowMode,
    );
  }

  // Merge citations from all agents
  const citations = [
    ...scriptureResult.citations,
    ...notesResult.citations,
    ...wordsResult.citations,
  ];

  return { response, citations };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Try to extract a verse number from a note id like "1-ij79" or "ij79". */
function extractVerseFromId(id: string): string {
  const m = id.match(/^(\d+)[/-]/);
  return m ? m[1] : "?";
}
