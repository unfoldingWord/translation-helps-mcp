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
    return { summary: "(No scripture text available for analysis.)", citations: [] };
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
    { role: "user", content: `${context}\nPlease analyze ${reference} as described.` },
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

Stay factual. Reference the notes as given; do not add interpretation.`;

async function runNotesAgent(
  notes: Array<Record<string, unknown>>,
  reference: string,
  llm: LLMProvider,
): Promise<SubAgentResult> {
  if (notes.length === 0) {
    return { summary: "(No Translation Notes available for this passage.)", citations: [] };
  }

  let context = `# Translation Notes for ${reference} (${notes.length} total)\n\n`;
  for (const note of notes) {
    const id = String(note["id"] ?? "");
    const verse = String(note["verse"] ?? extractVerseFromId(id));
    const text = String(note["text"] ?? "");
    const supportRef = String(note["supportReference"] ?? note["externalReference"] ?? "");
    context += `- **v.${verse}** [${id}]: ${text}`;
    if (supportRef) context += ` *(TA: ${supportRef})*`;
    context += "\n";
  }

  const citations: Array<{ path: string; title?: string }> = notes
    .slice(0, 5)
    .map((n) => ({ path: `tn/${reference}/${String(n["id"] ?? "")}`, title: "Translation Note" }));

  const summary = await llm.generate([
    { role: "system", content: NOTES_AGENT_SYSTEM },
    { role: "user", content: `${context}\nPlease analyze these notes for ${reference} as described.` },
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

Be factual. Draw only from the provided articles.`;

async function runWordsAcademyAgent(
  tw: Array<Record<string, unknown>>,
  ta: Array<Record<string, unknown>>,
  reference: string,
  llm: LLMProvider,
): Promise<SubAgentResult> {
  if (tw.length === 0 && ta.length === 0) {
    return {
      summary: "(No Translation Words or Academy articles available for this passage.)",
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
    ...tw.slice(0, 3).map((t) => ({ path: String(t["path"] ?? ""), title: String(t["title"] ?? "") })),
    ...ta.slice(0, 2).map((a) => ({ path: String(a["path"] ?? ""), title: String(a["title"] ?? "") })),
  ];

  const summary = await llm.generate([
    { role: "system", content: WORDS_ACADEMY_AGENT_SYSTEM },
    { role: "user", content: `${context}\nPlease analyze the terms and strategies for ${reference} as described.` },
  ]);

  return { summary, citations };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const ORCHESTRATOR_SYSTEM = `You are a Bible translation coach leading a translator through a structured lesson.
Three specialist agents have analyzed the passage. Use their reports to build a guided session.

Your response MUST follow this exact format — no exceptions:

---
[1-2 sentence orientation to the passage — context, purpose, genre]

**Your translation path for [reference]:**
☐ 1. [brief step title, e.g. "Passage structure and sections"]
☐ 2. [brief step title, e.g. "Challenge: 'born again' (v.3, 7)"]
☐ 3. [brief step title]
☐ 4. [brief step title]
☐ 5. [brief step title — usually key terms or comprehension check]
[Add a 6th only if genuinely necessary. 4–6 steps total.]

---
**Step 1 — [same title as ☐ 1 above]**

[Present ONLY this step. 80–120 words MAX. Be direct, helpful, concrete.
For a section step: name the sections with verse ranges, one sentence each.
For a challenge: state the problem, give the recommended AT from the notes, keep it tight.
For a term: give the core meaning + one translation suggestion.]

[End with ONE short question or prompt that invites the translator to engage — e.g.,
"Which section feels most unfamiliar?" or "Does your language have a word for this concept?"]

---
*[Step 1/N] — Say **"next"** when ready to continue.*

RULES:
- Do NOT present Steps 2–N. They come in subsequent turns.
- Keep Step 1 under 120 words. Quality over quantity.
- The checklist is the path. The step content is the lesson.
- Never add the batch-session footer — it is appended programmatically.`;

async function runOrchestratorAgent(
  scriptureResult: SubAgentResult,
  notesResult: SubAgentResult,
  wordsResult: SubAgentResult,
  reference: string,
  llm: LLMProvider,
): Promise<string> {
  const prompt = buildOrchestratorPrompt(scriptureResult, notesResult, wordsResult, reference);
  return llm.generate([
    { role: "system", content: ORCHESTRATOR_SYSTEM },
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
  llm: LLMProvider,
  emit: OverviewEmit,
): Promise<string> {
  const messages = [
    { role: "system" as const, content: ORCHESTRATOR_SYSTEM },
    { role: "user" as const, content: buildOrchestratorPrompt(scriptureResult, notesResult, wordsResult, reference) },
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
): string {
  return `# Sub-Agent Reports for ${reference}

## [SCRIPTURE AGENT]
${scriptureResult.summary}

## [NOTES AGENT]
${notesResult.summary}

## [WORDS + ACADEMY AGENT]
${wordsResult.summary}

Build the guided checklist session for ${reference} as instructed. Remember: show the full checklist upfront, then present ONLY Step 1 in full.`;
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
): Promise<OverviewPipelineResult> {
  void language; // reserved for future multilingual sub-agents

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
    { label: "Scripture structure", promise: runScriptureAgent(bundle.scriptures, reference, llm) },
    { label: "Translation notes",   promise: runNotesAgent(notes, reference, llm) },
    { label: "Key terms & academy", promise: runWordsAcademyAgent(tw, ta, reference, llm) },
  ];

  const [scriptureResult, notesResult, wordsResult] = await Promise.all(
    agents.map(({ label, promise }) =>
      promise.then((r) => {
        emit?.thinking?.(label, "done");
        return r;
      })
    )
  );

  // Synthesize — stream tokens if emit is available
  emit?.status("Synthesizing overview\u2026");
  let response: string;
  if (emit) {
    response = await runOrchestratorAgentStream(
      scriptureResult, notesResult, wordsResult, reference, llm, emit,
    );
  } else {
    response = await runOrchestratorAgent(
      scriptureResult, notesResult, wordsResult, reference, llm,
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
