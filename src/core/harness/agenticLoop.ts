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
          reference: { type: "string", description: "USFM reference, e.g. 'JHN 3:16'" },
          language: { type: "string", description: "BCP-47 language code, e.g. 'en'" },
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
        "Does NOT return the verse text — use get_passage for that. Call once when starting a passage.",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string", description: "USFM reference, e.g. 'JHN 3:16'" },
          language: { type: "string", description: "BCP-47 language code, e.g. 'en'" },
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
          reference: { type: "string", description: "USFM reference, e.g. 'JHN 3:16'" },
          language: { type: "string", description: "BCP-47 language code" },
          id: { type: "string", description: "Optional: specific note ID to fetch (e.g. 'vg6z')" },
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
          reference: { type: "string", description: "USFM reference, e.g. 'JHN 3:16'" },
          language: { type: "string", description: "BCP-47 language code" },
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
          path: { type: "string", description: "Word path, e.g. 'bible/kt/grace'" },
          language: { type: "string", description: "BCP-47 language code" },
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
          language: { type: "string", description: "BCP-47 language code" },
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
          language: { type: "string", description: "BCP-47 language code" },
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
        "Returns paths and titles — follow up with get_academy_article or get_word_article.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          language: { type: "string", description: "BCP-47 language code" },
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

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 4;

type ConversationMessage = { role: "user" | "assistant" | "system"; content: string };

export async function runAgenticLoop(
  userMessage: string,
  language: string,
  llm: LLMProvider,
  callTool: CallToolFn,
  /** Recent conversation history — gives the LLM context to decide which tools to call. */
  history?: ConversationMessage[],
): Promise<Omit<HarnessResult, "intent">> {
  // If the LLM doesn't support function-calling, fall back to plain generate
  const llmWithTools = llm as unknown as OpenAILLMWithTools;
  if (typeof llmWithTools.generateWithTools !== "function") {
    const response = await llm.generate([
      {
        role: "system",
        content: SYSTEM_BASE +
          "\n\nNote: You do not have live access to translation resources for this open-ended query. Answer from your training knowledge and note the limitation.",
      },
      { role: "user", content: userMessage },
    ]);
    return {
      response,
      citations: [],
      mode: "training-only",
      dataWarning:
        "Open-ended question — function-calling not available in this LLM provider. Response from training knowledge.",
    };
  }

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

  const messages: OpenAIMessage[] = [
    {
      role: "system",
      content:
        SYSTEM_BASE +
        `\n\nYou have access to MCP tools to fetch translation resources. ` +
        `Use them to answer the question with real data. ` +
        `Typical workflow: get_passage (scripture text) + get_passage_context (book/chapter background) → get_note / get_passage_index → get_academy_article / get_word_article. ` +
        `Use search_articles when you don't know the exact article path. ` +
        `Language context: ${language}.\n` +
        `IMPORTANT: The conversation history above gives you context. If the user is asking about a phrase, concept, or term ` +
        `mentioned in a previous response (e.g. a challenge phrase, a figure of speech like personification), ` +
        `use that context to call the right tool (e.g. get_note with phrase, get_academy_article with the TA path).`,
    },
    ...historyMessages,
    { role: "user", content: userMessage },
  ];

  const toolCallLog: Array<{ tool: string; params: unknown; result: unknown }> = [];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const result = await llmWithTools.generateWithTools(
      messages as Parameters<typeof llmWithTools.generateWithTools>[0],
      TOOL_SPECS,
    );

    if (result.finish_reason === "stop" || !result.tool_calls?.length) {
      return {
        response: result.content ?? "",
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
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        // Always inject language if missing
        if (!args["language"]) args["language"] = language;
        toolResult = await callTool(tc.function.name, args);
        toolCallLog.push({ tool: tc.function.name, params: args, result: toolResult });
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
    response: finalResponse,
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
  ): Promise<{ content: string | null; tool_calls?: OpenAIToolCall[]; finish_reason: string }>;
}

function buildCitationsFromLog(
  log: Array<{ tool: string; params: unknown; result: unknown }>,
): Array<{ path: string; title?: string }> {
  const citations: Array<{ path: string; title?: string }> = [];
  for (const entry of log) {
    const p = entry.params as Record<string, unknown>;
    if (entry.tool === "get_academy_article" || entry.tool === "get_word_article") {
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
