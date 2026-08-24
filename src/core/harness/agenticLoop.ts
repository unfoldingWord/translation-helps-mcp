/**
 * Agentic tool-calling loop for open_ended intent.
 *
 * Exposes MCP tools as OpenAI function-calling specs and runs a bounded
 * loop (max 4 iterations) letting the LLM decide which tools to call.
 *
 * RAG (rag_query) is offered as a LOCATOR only — the description directs
 * the model to follow up with typed fetchers rather than citing RAG chunks.
 */

import type { LLMProvider } from "../rag/providers/LLMProvider.js";
import type { CallToolFn } from "./ContextHarness.js";
import type { HarnessResult } from "./ContextHarness.js";
import { SYSTEM_BASE } from "../rag/PromptFormatter.js";
import { CHAT_WORD_BUDGETS, enforceReplyBudget } from "./chatPacing.js";

function paceOpenEndedReply(text: string, language: string): string {
  return enforceReplyBudget(text, {
    budget: CHAT_WORD_BUDGETS.open_ended,
    language,
    closerKind: "brief",
  }).text;
}

// ---------------------------------------------------------------------------
// Tool function specs (OpenAI format)
// ---------------------------------------------------------------------------

const TOOL_SPECS: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "get_passage",
      description:
        "Fetch the scripture TEXT for a passage — ALL versions in one call " +
        "(literal like ULT, simplified like UST, and original-language Greek/Hebrew). " +
        "Cheap and repeatable: call it whenever you need to read or re-read the verse text. " +
        "Call this first when the user mentions a Bible reference.",
      parameters: {
        type: "object",
        properties: {
          reference: {
            type: "string",
            description: "USFM reference, e.g. 'JHN 3:16'",
          },
          language: {
            type: "string",
            description:
              "User's resource language (BCP-47). Do not use en when the user asked for another language.",
          },
        },
        required: ["reference", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_passage_context",
      description:
        "STEP 1 (orient): Fetch the background AROUND a passage — book and chapter introductions " +
        "(themes, cultural background, overview) plus a summary of which resources exist for the language. " +
        "Also accepts a bare book name (e.g. 'TIT' or 'Titus') to get just the book overview. " +
        "Does NOT return the verse text — use get_passage for that. Call once when starting a passage.",
      parameters: {
        type: "object",
        properties: {
          reference: {
            type: "string",
            description:
              "USFM reference, e.g. 'JHN 3:16', or a bare book name/code, e.g. 'TIT', for the book overview only",
          },
          language: {
            type: "string",
            description:
              "User's resource language (BCP-47). Do not use en when the user asked for another language.",
          },
        },
        required: ["reference", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_note",
      description:
        "Fetch Translation Notes (TN) for a passage. Without an id, returns all notes for the reference. " +
        "Notes explain idioms, grammar, cultural context, and provide Alternate Translation (AT) examples. " +
        "Each note has a supportReference linking to a Translation Academy article and a quote from the original language.",
      parameters: {
        type: "object",
        properties: {
          reference: {
            type: "string",
            description: "USFM reference, e.g. 'JHN 3:16'",
          },
          language: {
            type: "string",
            description:
              "User's resource language (BCP-47). Do not use en when the user asked for another language.",
          },
          id: {
            type: "string",
            description: "Optional: specific note ID to fetch (e.g. 'vg6z')",
          },
        },
        required: ["reference", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_passage_index",
      description:
        "STEP 2 (survey): Get a compact index of translation notes and key terms for a passage — " +
        "NO article bodies, just IDs/paths and what each item is about. " +
        "Use this to understand what translation issues exist before drilling deeper. " +
        "Returns notes[] with taArticle paths and words[] with twArticle paths.",
      parameters: {
        type: "object",
        properties: {
          reference: {
            type: "string",
            description: "USFM reference, e.g. 'JHN 3:16'",
          },
          language: {
            type: "string",
            description:
              "User's resource language (BCP-47). Do not use en when the user asked for another language.",
          },
        },
        required: ["reference", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_word_article",
      description:
        "Get the full dictionary article for a Translation Word. " +
        "Provide the clean path (e.g. 'bible/kt/grace') from get_passage_index words[].twArticle.path. " +
        "Returns a Markdown article with meaning, biblical usage, and translation suggestions.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Word path, e.g. 'bible/kt/grace'",
          },
          language: {
            type: "string",
            description:
              "User's resource language (BCP-47). Do not use en when the user asked for another language.",
          },
        },
        required: ["path", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_academy_article",
      description:
        "Get a Translation Academy (TA) article by its path. " +
        "TA articles cover translation principles, figures of speech, grammar handling, and checking. " +
        "Get the path from get_passage_index notes[].taArticle.path or get_note supportReference. " +
        "Example paths: 'translate/figs-metaphor', 'translate/figs-rquestion', 'checking/accuracy'.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "TA article path, e.g. 'translate/figs-metaphor'",
          },
          language: {
            type: "string",
            description:
              "User's resource language (BCP-47). Do not use en when the user asked for another language.",
          },
        },
        required: ["path", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_questions",
      description:
        "Fetch comprehension questions (TQ) for a reference. " +
        "Questions verify that the translator understood the passage correctly.",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string", description: "USFM reference" },
          language: {
            type: "string",
            description:
              "User's resource language (BCP-47). Do not use en when the user asked for another language.",
          },
        },
        required: ["reference", "language"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_articles",
      description:
        "Semantic search across Translation Academy (TA) and Translation Words (TW) catalogs. " +
        "Use to locate articles when you don't know the exact path. " +
        "Pass the user's language so search hits that language's catalog. " +
        "Returns paths and titles — follow up with get_academy_article or get_word_article.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query",
          },
          language: {
            type: "string",
            description:
              "User's resource language (BCP-47). Do not use en when the user asked for another language.",
          },
          resourceTypes: {
            type: "array",
            items: { type: "string", enum: ["ta", "tw"] },
            description: "Filter by resource type (default: both)",
          },
          topK: { type: "number", description: "Max results (default 5)" },
        },
        required: ["query", "language"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// OpenAI function-calling types
// ---------------------------------------------------------------------------

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 4;

const CONVERSATIONAL_STYLE = `

RESPONSE STYLE — follow these rules strictly:
- Respond conversationally in flowing prose. Do NOT use markdown headers (##, ###) or structured bullet-point lists unless the user explicitly asks for a structured explanation or list.
- When you retrieve an article or resource, use it as a reference to inform your answer — do not reformat or copy its structure. Synthesize the key insight in 3–5 sentences and cite the source inline.
- Lead with the most direct answer to the user's question, then add supporting detail.
- Keep total response length proportional to question complexity: simple questions get 2–4 sentences, complex ones get a short paragraph (hard cap ≈ 180 words for drafting/overview/scholar answers).
- Consultant pedagogy (CANA): consult by questioning. For translation briefs / drafting / scholar answers: at most **2–3 priority decisions**, point to the resources panel, then ONE consultant question (what the word they chose means / more than one sense / what's hard / draft in Mi traducción). Never ask "How did you translate X?" — ask for meaning instead.
- On draft submit or "esto me costó…": acknowledge → ask what felt hard → exactly ONE meaning-based CANA probe per turn on a source item (the sequence continues across turns). Do NOT rewrite their draft or claim it "sounds right" in an unknown receptor language.
- TRANSLATION ACADEMY FIDELITY: When citing a Translation Academy article, quote the exact strategy names and descriptions from the article — do NOT rewrite, reorder, or generate new strategies that are not present in the source. Use the article's own wording for every strategy listed. If the article describes 2 strategies, present exactly those 2 strategies in the article's own words.`;

type ConversationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function runAgenticLoop(
  userMessage: string,
  /** Source language: Door43 tool fetches AND coach conversation locale. */
  language: string,
  llm: LLMProvider,
  callTool: CallToolFn,
  /** Recent conversation history — gives the LLM context to decide which tools to call. */
  history?: ConversationMessage[],
  /** Receptor label metadata only — never the coach reply language. */
  targetLanguage?: string,
): Promise<Omit<HarnessResult, "intent">> {
  const receptorHint = targetLanguage?.trim();
  // Build recent history context for the LLM (strip hidden HTML markers so the
  // LLM doesn't trip over <!-- CHALLENGES --> or <!-- PHRASE_DRILL --> comments).
  const historyMessages: OpenAIMessage[] = (history ?? [])
    .slice(-8)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.replace(/<!--[\s\S]*?-->/g, "").trim(),
    }))
    .filter((m) => m.content.length > 0);

  // If the LLM doesn't support function-calling, fall back to plain generate.
  // Keep conversation history so the model can still use resources already
  // quoted in prior turns (e.g. notes/passage from an annotated_passage turn).
  const llmWithTools = llm as unknown as OpenAILLMWithTools;
  if (typeof llmWithTools.generateWithTools !== "function") {
    const response = await llm.generate([
      {
        role: "system",
        content:
          SYSTEM_BASE +
          CONVERSATIONAL_STYLE +
          "\n\nNote: You do not have live access to translation resources for this open-ended query. Answer from your training knowledge and note the limitation. Use any scripture text, notes, or terms already present in the conversation history.",
      },
      ...historyMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: userMessage },
    ]);
    return {
      response: paceOpenEndedReply(response, language),
      citations: [],
      mode: "training-only",
      dataWarning:
        "Open-ended question — function-calling not available in this LLM provider. Response from training knowledge.",
    };
  }

  const languagePairHint = receptorHint
    ? `SOURCE / CONVERSATION LANGUAGE: ${language} — fetch Door43 tools in this language and reply entirely in this language. TARGET / RECEPTOR (metadata only): ${receptorHint} — do not reply in it; do not ask them to paste their draft.`
    : `SOURCE / CONVERSATION LANGUAGE: ${language}. Fetch tools and reply in this language. Do not ask for or evaluate receptor draft text.`;

  const messages: OpenAIMessage[] = [
    {
      role: "system",
      content:
        SYSTEM_BASE +
        CONVERSATIONAL_STYLE +
        `\n\nYou have access to MCP tools to fetch translation resources. ` +
        `Use them to answer the question with real data. ` +
        `Typical workflow: get_passage (scripture text) + get_passage_context (book/chapter background) → get_note / get_passage_index → get_academy_article / get_word_article. ` +
        `Use search_articles when you don't know the exact article path. ` +
        `${languagePairHint}\n` +
        `If a tool returns no data for the source language, retry the same call with language "en" and summarize findings in the source/conversation language (${language}). ` +
        `If a tool result contains an error field (e.g. notesError), tell the user the resource could not be reached right now — do not invent background from memory.\n` +
        `When the user asks for a Translation Word / dictionary article (e.g. "artículo sobre siervo", "TW article on servant"): ` +
        `ALWAYS call search_articles (resourceTypes: tw) then get_word_article with the returned path. ` +
        `Never claim the article is available unless get_word_article returned article text. If lookup fails, say so honestly.\n` +
        `When the user asks what to do next, for a translation overview, or for drafting help: give a short translation brief ` +
        `(structure + at most 2–3 priority decisions from notes), point to panel resources, and ONE consultant question (how they would translate a flagged phrase / more than one sense / what's hard / draft in Mi traducción) — do not answer with only resource counts or push a quiz.\n` +
        `When they ask for check questions or say what was hard ("esto me costó…"): acknowledge, ask what felt hard if needed, then exactly ONE meaning-based CANA probe per turn on a source item from TN/TW (never "How did you translate X?" — ask what their chosen word means) — do not ask for their receptor draft, rewrite it, or evaluate target-language surface form.\n` +
        `IMPORTANT: The conversation history above gives you context. If the user is asking about a phrase, concept, or term ` +
        `mentioned in a previous response (e.g. a challenge phrase, a figure of speech like personification), ` +
        `use that context to call the right tool (e.g. get_note with phrase, get_academy_article with the TA path, get_word_article for a TW term).`,
    },
    ...historyMessages,
    { role: "user", content: userMessage },
  ];

  const toolCallLog: Array<{ tool: string; params: unknown; result: unknown }> =
    [];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const result = await llmWithTools.generateWithTools(
      messages as Parameters<typeof llmWithTools.generateWithTools>[0],
      TOOL_SPECS,
    );

    if (result.finish_reason === "stop" || !result.tool_calls?.length) {
      return {
        response: paceOpenEndedReply(result.content ?? "", language),
        citations: buildCitationsFromLog(toolCallLog),
        mode: toolCallLog.length > 0 ? "compose" : "training-only",
        dataWarning:
          toolCallLog.length === 0
            ? "No structured resources retrieved."
            : undefined,
      };
    }

    // Execute tool calls
    messages.push({
      role: "assistant",
      content: result.content ?? "",
      tool_calls: result.tool_calls,
    });

    for (const tc of result.tool_calls) {
      let toolResult: unknown;
      try {
        const args = JSON.parse(tc.function.arguments) as Record<
          string,
          unknown
        >;
        // Always inject language if missing
        if (!args["language"]) args["language"] = language;
        toolResult = await callTool(tc.function.name, args);
        toolCallLog.push({
          tool: tc.function.name,
          params: args,
          result: toolResult,
        });
      } catch (err) {
        toolResult = { error: String(err) };
      }

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        tool_call_id: tc.id,
      });
    }
  }

  // Exhausted iterations — generate final answer from accumulated context
  messages.push({
    role: "user",
    content:
      "Based on the resources you retrieved above, please provide your final answer.",
  });

  const finalResponse = await llm.generate(
    messages.map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: m.content ?? "",
    })) as Parameters<typeof llm.generate>[0],
  );

  return {
    response: paceOpenEndedReply(finalResponse, language),
    citations: buildCitationsFromLog(toolCallLog),
    mode: toolCallLog.length > 0 ? "compose" : "training-only",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OpenAILLMWithTools {
  generateWithTools(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
  ): Promise<{
    content: string | null;
    tool_calls?: OpenAIToolCall[];
    finish_reason: string;
  }>;
}

function buildCitationsFromLog(
  log: Array<{ tool: string; params: unknown; result: unknown }>,
): Array<{ path: string; title?: string }> {
  const citations: Array<{ path: string; title?: string }> = [];
  for (const entry of log) {
    const p = entry.params as Record<string, unknown>;
    if (
      entry.tool === "get_academy_article" ||
      entry.tool === "get_word_article"
    ) {
      const path = String(p["path"] ?? "");
      if (path) citations.push({ path, title: path.split("/").pop() });
    } else if (
      entry.tool === "get_passage" ||
      entry.tool === "get_passage_context" ||
      entry.tool === "get_note" ||
      entry.tool === "get_passage_index" ||
      entry.tool === "get_questions"
    ) {
      const ref = String(p["reference"] ?? "");
      if (ref) citations.push({ path: `${entry.tool}/${ref}`, title: ref });
    }
  }
  return citations;
}
