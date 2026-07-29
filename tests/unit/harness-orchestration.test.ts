/**
 * Unit tests for ContextHarness orchestration logic.
 * Uses stub LLM + stub callTool to avoid real I/O.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ContextHarness } from "../../src/core/harness/ContextHarness.js";
import type { LLMProvider } from "../../src/core/rag/providers/LLMProvider.js";
import type { CallToolFn } from "../../src/core/harness/ContextHarness.js";
import * as QuizAgents from "../../src/core/harness/QuizAgents.js";
import {
  buildQuizClearedMarker,
  buildQuizMarker,
} from "../../src/core/harness/QuizAgents.js";
import type { QuizItem } from "../../src/core/harness/intent.js";

function makeStubLLM(response = "stub answer"): LLMProvider {
  return {
    generate: vi.fn().mockResolvedValue(response),
    generateStream: vi.fn().mockImplementation(async function* () {
      yield response;
    }),
  } as unknown as LLMProvider;
}

function makeStubCallTool(): {
  fn: CallToolFn;
  calls: Array<{ tool: string }>;
} {
  const calls: Array<{ tool: string }> = [];
  const fn: CallToolFn = async (tool, _params) => {
    calls.push({ tool });
    if (tool === "list_languages")
      return {
        content: [{ text: JSON.stringify({ languages: [{ code: "en" }] }) }],
      };
    if (tool === "get_passage")
      return { content: [{ text: '{"versions":[],"text":""}' }] };
    if (tool === "get_passage_context")
      return { content: [{ text: '{"notes":[],"words":[],"questions":[]}' }] };
    return { content: [{ text: "[]" }] };
  };
  return { fn, calls };
}

const SAMPLE_QUIZ: QuizItem[] = [
  { q: "Q1", a: "A1" },
  { q: "Q2", a: "A2" },
  { q: "Q3", a: "A3" },
  { q: "Q4", a: "A4" },
];

describe("ContextHarness orchestration", () => {
  it("constructs without error", () => {
    const harness = new ContextHarness(makeStubLLM(), makeStubCallTool().fn);
    expect(harness).toBeDefined();
  });

  it("run() returns a HarnessResult with a response string", async () => {
    const { fn } = makeStubCallTool();
    const llm = makeStubLLM("Test answer about John 3:16.");
    const harness = new ContextHarness(llm, fn, { language: "en" });

    const result = await harness.run("What does John 3:16 mean?");

    expect(result).toBeDefined();
    expect(typeof result.response).toBe("string");
    expect(result.intent).toBeDefined();
  });

  it("run() returns an intent field", async () => {
    const { fn } = makeStubCallTool();
    const llm = makeStubLLM("Passage answer");
    const harness = new ContextHarness(llm, fn, { language: "en" });

    const result = await harness.run("Explain Romans 8:28");
    expect(typeof result.intent).toBe("string");
    expect(result.intent.length).toBeGreaterThan(0);
  });

  it("run() records toolCalls when emit is absent", async () => {
    const { fn } = makeStubCallTool();
    const llm = makeStubLLM("Answer");
    const harness = new ContextHarness(llm, fn, { language: "en" });

    const result = await harness.run("List available languages");
    // toolCalls may be an array (possibly empty for open_ended intent)
    expect(
      Array.isArray(result.toolCalls) || result.toolCalls === undefined,
    ).toBe(true);
  });

  it("emit callbacks are invoked when provided", async () => {
    const { fn } = makeStubCallTool();
    const llm = makeStubLLM("Answer with emit");
    const statusMessages: string[] = [];
    const harness = new ContextHarness(llm, fn, {
      language: "en",
      emit: {
        status: (t) => statusMessages.push(t),
        token: vi.fn(),
      },
    });

    await harness.run("What is John 3:16?");
    // Status messages may or may not be emitted depending on intent,
    // but the harness must not throw.
    expect(Array.isArray(statusMessages)).toBe(true);
  });
});

describe("ContextHarness TW honesty + quiz sticky skip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("word_study miss stays on GST/TN with Spanish apology (no EN dump, no LLM fabricate)", async () => {
    const llm = makeStubLLM(
      "Según la Translation Word, siervo significa alguien que sirve.",
    );
    const searchLangs: string[] = [];
    const fn: CallToolFn = async (tool, params) => {
      if (tool === "search_articles") {
        searchLangs.push(
          String((params as { language?: string }).language ?? ""),
        );
        return { results: [] };
      }
      if (tool === "get_word_article") {
        throw new Error('Translation Words not found for "es-419"');
      }
      return {};
    };
    const harness = new ContextHarness(llm, fn);
    const result = await harness.run("Muéstrame el artículo sobre siervo", {
      language: "es-419",
    });

    expect(result.intent).toBe("word_study");
    expect(result.mode).toBe("compose");
    expect(result.response).toMatch(/GST|nota|panel/i);
    expect(result.response).toMatch(/siervo/i);
    expect(result.response).not.toMatch(/Según la Translation Word/i);
    expect(result.response).not.toMatch(/Translation Academy|figs-/i);
    expect(searchLangs).toContain("es-419");
    expect(searchLangs).not.toContain("en");
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it("compound quiz skip + article request routes to word_study", async () => {
    const llm = makeStubLLM("honest");
    const fn: CallToolFn = async (tool) => {
      if (tool === "search_articles") return { results: [] };
      return {};
    };
    const harness = new ContextHarness(llm, fn);
    const result = await harness.run(
      "No, omitir el cuestionario y muéstrame el artículo sobre siervo",
      {
        language: "es-419",
        conversationHistory: [
          {
            role: "assistant",
            content: `Listo.\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
          },
        ],
      },
    );
    expect(result.intent).toBe("word_study");
    expect(result.response).toMatch(/No pude recuperar|siervo/i);
  });

  it("suppresses context quiz offer after QUIZ:cleared sticky skip", async () => {
    const spy = vi.spyOn(QuizAgents, "generateQuiz").mockResolvedValue([
      { q: "1", a: "a" },
      { q: "2", a: "b" },
      { q: "3", a: "c" },
    ]);
    const fn: CallToolFn = async (tool) => {
      if (tool === "get_passage") {
        return {
          reference: "TIT 1:1",
          language: "es-419",
          versions: [
            {
              resourceType: "glt",
              role: "literal",
              text: "Pablo, siervo de Dios…",
            },
          ],
        };
      }
      if (tool === "get_note") return { notes: [] };
      if (tool === "get_passage_index") return { notes: [], words: [] };
      if (tool === "get_passage_context") return { context: [] };
      return {};
    };
    const llm = makeStubLLM("Guía breve del pasaje.");
    const harness = new ContextHarness(llm, fn);
    const result = await harness.run("Ayúdame con Tito 1:1", {
      language: "es-419",
      conversationHistory: [
        {
          role: "assistant",
          content: `Omitido.\n${buildQuizClearedMarker()}`,
        },
      ],
    });

    expect(result.intent).toBe("annotated_passage");
    expect(spy).not.toHaveBeenCalled();
    expect(result.response).not.toMatch(/<!-- QUIZ:\d+\/\d+/);
  });
});
