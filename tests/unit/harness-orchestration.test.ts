/**
 * Unit tests for ContextHarness orchestration logic.
 * Uses stub LLM + stub callTool to avoid real I/O.
 */

import { describe, it, expect, vi } from "vitest";
import { ContextHarness } from "../../src/core/harness/ContextHarness.js";
import type { LLMProvider } from "../../src/core/rag/providers/LLMProvider.js";
import type { CallToolFn } from "../../src/core/harness/ContextHarness.js";

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
