/**
 * PromptFormatter — converts translation bundles and RAG results into
 * structured LLM-ready prompts.
 *
 * Public exports:
 *   SYSTEM_BASE                — shared system context about the uW ecosystem
 *   intentSystemFragment(intent) — short intent-specific instruction block
 *   renderEnrichedBundle(bundle) — context section from an EnrichedBundle
 *   PromptFormatter class       — backward-compatible bundle/RAG formatting
 */

import type { Bundle } from "./BundleCache.js";

import type { EnrichedBundle } from "../harness/budgeter.js";
import type { IntentType } from "../harness/intent.js";

export type PromptTemplate =
  | "default"
  | "translation"
  | "notes"
  | "analysis"
  | "chat";

export interface FormatOptions {
  template?: PromptTemplate;
  maxDocuments?: number;
  maxNotes?: number;
  maxArticles?: number;
  includeSources?: boolean;
  userPrompt?: string;
}

export interface FormattedPrompt {
  systemPrompt: string;
  userPrompt: string;
}

// ---------------------------------------------------------------------------
// Shared system base — exported so harness and old formatters share one source
// ---------------------------------------------------------------------------

export const SYSTEM_BASE = `You are Ezer, a Bible translation expert powered by the unfoldingWord Translation Helps MCP.
Your name means "helper" in Hebrew — fitting for your role assisting Mother Tongue Translators (MTTs) — people translating the Bible into their heart language.

## unfoldingWord Resource Ecosystem

The following resources are available through this system. Always explain which resource you are drawing from.

### Scripture Texts
- **ULT (unfoldingWord Literal Text)**: A word-for-word literal translation from Hebrew/Greek. Preserves original language structure, word order, and idioms. Helps translators understand the exact form of the original text. Contains alignment marks showing which English word maps to which original-language word.
- **UST (unfoldingWord Simplified Text)**: A meaning-based simplified translation. Rephrases complex constructions into plain language. Helps translators understand the *meaning* when the ULT is hard to follow.

### Translation Helps
- **Translation Notes (TN)**: Verse-by-verse notes written by biblical scholars. They explain:
  - Difficult phrases and idioms ("figures of speech")
  - Cultural and historical context
  - Alternative translation options with Alternate Translation (AT) examples
  - Grammatical structures (passive voice, rhetorical questions, metonymy, etc.)
  - Key theological concepts
  Each note references the original-language word or phrase it explains.

- **Translation Words (TW)**: A dictionary of key biblical and theological terms (e.g. "grace", "atonement", "covenant", "Son of Man"). Each article explains:
  - The meaning of the term in biblical context
  - How it is used across Scripture
  - Suggested ways to translate it into other languages
  When a TW word appears at a reference, it is flagged in the Translation Word Links (TWL).

- **Translation Word Links (TWL)**: A per-verse index showing which Translation Word articles apply to specific words in that verse. Use this to know *which terms* in a verse have TW articles.

- **Translation Academy (TA)**: A comprehensive training manual for translators covering:
  - Translation theory and methods (literal vs. dynamic equivalence)
  - How to handle figures of speech (metaphor, simile, hyperbole, etc.)
  - Dealing with grammar across languages (passive voice, pronouns, etc.)
  - Cultural equivalents and implicit information
  - How to check a translation
  TN notes often cite TA articles (e.g. [[rc://*/ta/man/translate/figs-metaphor]]).

- **Translation Questions (TQ)**: Comprehension questions for each passage to verify the translator understood the meaning correctly.

## How Translators Use These Resources Together
1. Compare **ULT** (literal form) and **UST** (meaning-based) side-by-side to understand both *what was said* and *what it means*.
2. Study **Translation Notes** for each verse to understand difficult phrases and see suggested Alternate Translation (AT) examples.
3. Look up **Translation Words** for theologically significant terms to understand their full biblical meaning and how to render them.
4. Consult **Translation Academy** articles (linked from TN SupportReferences) for the specific translation strategy needed.
5. Answer **Translation Questions** to verify the translator understood the passage before finalizing.

When both ULT and UST are provided, always reference both — they complement each other and together give the fullest picture for the translator.

## Instructions
- Ground every answer in the provided context (scripture text, notes, word links).
- When Translation Notes are provided, reference specific notes by their ID and the original-language phrase they explain.
- When Translation Word Links are provided, name the theologically significant terms in the verse.
- Cite sources using [Source: id] markers.
- Suggest concrete Alternate Translation options when the notes provide them.
- **Always respond in the same language the user is writing in.** If the user writes in Spanish, respond entirely in Spanish. If they write in Portuguese, respond in Portuguese, etc. Never switch to English unless the user does first.`;

// ---------------------------------------------------------------------------
// Intent-specific instruction blocks
// ---------------------------------------------------------------------------

const INTENT_FRAGMENTS: Record<IntentType, string> = {
  passage_overview: `## Your Task
You are helping a translator prepare to work through a multi-verse passage. Based on the full text provided above:

1. **Orient the passage** — in 2-3 sentences, describe the overall context and purpose of this section.
2. **Identify 3–5 natural sections** — give each a verse range and a one-sentence title/description (e.g., *v.1–4: Jesus enters Jerusalem*).
3. **Flag the top 3 translation challenges** — list the most important figures of speech, theological terms, or cultural elements a translator will need to handle carefully. Give the verse reference for each.
4. **Invite the translator** — end with: *"Which section would you like to start with? Say 'next' to begin with the first section."*

Do NOT provide detailed notes yet — this is the overview only. The translator will drill in verse by verse after choosing a section.`,

  passage_help: `## Your Task
Provide comprehensive translation help for this passage. Structure your response as follows:
1. **Compare ULT and UST** — explain what the literal form (ULT) says vs. the meaning-based form (UST). What does the difference reveal?
2. **Key notes from Translation Notes** — walk through the most important TN notes, quoting the original phrase and the suggested Alternate Translation (AT).
3. **Significant Translation Words** — identify the theologically important terms in this verse and what they mean.
4. **Translation strategies** — if figures of speech or difficult constructions are present, note the TA strategy to use.
5. **Practical recommendation** — end with a concrete suggestion for how to approach translating this passage.`,

  word_study: `## Your Task
Explain the Translation Word in depth. Cover:
- The core biblical meaning of this term
- How it is used across different passages
- Specific translation suggestions from the TW article
- How a translator should handle it in their target language`,

  methodology: `## Your Task
Explain the translation methodology or figure of speech from Translation Academy. Cover:
- What this figure of speech or translation challenge is
- Why it matters for translators
- Concrete strategies from the TA article on how to handle it
- Examples that illustrate the approach`,

  checking: `## Your Task
Help the user verify the translation using the comprehension questions. Cover:
- What each question is checking for
- What the correct understanding of the passage is
- How the ULT text supports that understanding
- Any nuances to watch for`,

  discovery: `## Your Task
Help the user discover available resources. List them clearly with:
- Available subjects/resource types
- Organization (usually unfoldingWord)
- How to use each resource type`,

  open_ended: `## Your Task
Answer the question using the translation resources available. Be thorough and ground your answer in the provided context.`,

  annotated_passage: `## Your Task
Annotate the scripture passage to help the translator identify challenging phrases. See PassageAnnotator for the actual handling — this fragment is a fallback only.`,

  phrase_drill: `## Your Task
Explain the specific translation challenge for the selected phrase in depth. See handlePhraseDrill for the actual handling — this fragment is a fallback only.`,

  checklist_step: `## Your Task
Present the next step in the translation checklist. Guide the translator through one focused topic at a time.`,

  language_answer: `## Your Task
Help the user select a strategic language for their translation work. Respond warmly and confirm the selection.`,
};

/**
 * Return a short intent-specific instruction block for the system prompt.
 */
export function intentSystemFragment(intent: IntentType | string): string {
  return INTENT_FRAGMENTS[intent as IntentType] ?? INTENT_FRAGMENTS["open_ended"];
}

// ---------------------------------------------------------------------------
// EnrichedBundle renderer — used by ContextHarness
// ---------------------------------------------------------------------------

/**
 * Render an EnrichedBundle into a context string for the LLM.
 * Includes article content for TW and TA when present.
 */
export function renderEnrichedBundle(bundle: EnrichedBundle): string {
  let context = "";

  // Render all fetched scripture translations (ULT, UST, GLT, GST…)
  if (bundle.scriptures && bundle.scriptures.length > 0) {
    for (const s of bundle.scriptures) {
      context += `## ${s.label} (${bundle.metadata.reference})\n`;
      context += `\`\`\`\n${s.text}\n\`\`\`\n\n`;
    }
  } else if (bundle.scripture?.versions?.length) {
    for (const v of bundle.scripture.versions) {
      const label = v.resourceType.toUpperCase();
      context += `## ${label} (${bundle.metadata.reference})\n`;
      context += `\`\`\`\n${v.text}\n\`\`\`\n\n`;
    }
  }

  if (bundle.notes.length > 0) {
    context += `## Translation Notes — ${bundle.metadata.reference} (${bundle.notes.length} notes)\n`;
    context += `Each note explains a specific phrase or concept. [Source: id] identifies each note.\n\n`;
    for (const note of bundle.notes) {
      const n = note as unknown as { id: string; text: string; supportReference?: string };
      context += `- [Source: ${n.id}] ${n.text}`;
      if (n.supportReference) {
        context += ` *(See TA: ${n.supportReference})*`;
      }
      context += "\n";
    }
    context += "\n";
  }

  if (bundle.tw.length > 0) {
    context += `## Translation Words — Significant Terms (${bundle.tw.length})\n\n`;
    for (const tw of bundle.tw) {
      const title = tw.title ?? tw.path.split("/").pop() ?? tw.path;
      context += `### ${title} [Source: ${tw.path}]\n`;
      if (tw.article) {
        context += `${tw.article.trim()}\n\n`;
      } else {
        context += `*(Article path: ${tw.path} — use fetch_translation_word to retrieve full article)*\n\n`;
      }
    }
  }

  if (bundle.ta.length > 0) {
    context += `## Translation Academy Articles (${bundle.ta.length})\n\n`;
    for (const ta of bundle.ta) {
      const title = ta.title ?? ta.path.split("/").pop() ?? ta.path;
      context += `### ${title} [Source: ${ta.path}]\n`;
      if (ta.article) {
        context += `${ta.article.trim()}\n\n`;
      } else {
        context += `*(Article path: ${ta.path})*\n\n`;
      }
    }
  }

  if (bundle.tq && bundle.tq.length > 0) {
    context += `## Translation Questions — ${bundle.metadata.reference} (${bundle.tq.length})\n`;
    context += `These comprehension questions verify the translator understood the passage.\n\n`;
    for (const q of bundle.tq) {
      context += `- **Q (v.${q.verse}):** ${q.question}`;
      if (q.response) context += `\n  **A:** ${q.response}`;
      context += "\n";
    }
    context += "\n";
  }

  return context;
}

// ---------------------------------------------------------------------------
// Backward-compatible PromptFormatter class
// ---------------------------------------------------------------------------

export class PromptFormatter {
  formatBundle(bundle: Bundle, opts: FormatOptions = {}): FormattedPrompt {
    const maxNotes = opts.maxNotes ?? 10;
    const maxArticles = opts.maxArticles ?? 5;

    let context = "";

    if (bundle.scripture.versions?.length) {
      for (const v of bundle.scripture.versions) {
        const label = v.resourceType.toUpperCase();
        context += `## ${label} Scripture Text (${bundle.metadata.reference})\n`;
        context += `\`\`\`\n${v.text}\n\`\`\`\n\n`;
      }
    }

    if (bundle.notes.length > 0) {
      context += `## Translation Notes — ${bundle.metadata.reference} (${bundle.notes.length} notes)\n`;
      context += `Each note explains a specific phrase or concept in this verse. `;
      context += `The phrase in bold is the original-language word or ULT phrase being explained.\n\n`;
      bundle.notes.slice(0, maxNotes).forEach((note) => {
        context += `- [Source: ${note.id}] ${note.text}\n`;
      });
      context += "\n";
    }

    if (bundle.tw.length > 0) {
      context += `## Translation Word Links — Theologically Significant Terms (${bundle.tw.length})\n`;
      context += `These terms in this verse have Translation Word articles. Each is a key biblical/theological concept.\n\n`;
      bundle.tw.slice(0, maxArticles).forEach((tw) => {
        const raw = tw as unknown as { title?: string; origWords?: string; wordPath?: string };
        const title = raw.title ?? raw.origWords ?? tw.path;
        const path = raw.wordPath ?? tw.path;
        context += `- **${title}** — TW article path: ${path} [Source: ${path}]\n`;
      });
      context += "\n";
    }

    if (bundle.ta.length > 0) {
      context += `## Translation Academy Articles (${bundle.ta.length})\n`;
      context += `These Translation Academy articles give guidance on the translation strategies relevant to this passage.\n\n`;
      bundle.ta.slice(0, maxArticles).forEach((ta) => {
        context += `- **${ta.title}** [Source: ${ta.path}]\n`;
      });
      context += "\n";
    }

    const systemPrompt = `${SYSTEM_BASE}\n\n${context}`;
    const userPrompt =
      opts.userPrompt ??
      `Please provide translation help for ${bundle.metadata.reference} in ${bundle.metadata.language}.`;

    return { systemPrompt, userPrompt };
  }

  formatReport(
    bundle: Bundle,
    userPrompt: string,
    _opts: FormatOptions = {},
  ): FormattedPrompt {
    const { systemPrompt } = this.formatBundle(bundle, {
      userPrompt,
      template: "translation",
    });
    return { systemPrompt, userPrompt };
  }
}

export function createPromptFormatter(): PromptFormatter {
  return new PromptFormatter();
}
