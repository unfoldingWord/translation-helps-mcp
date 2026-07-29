/**
 * Regression: TracingLLMProvider must forward generateWithTools so X-ray
 * debug mode does not strip function-calling from the agentic loop.
 */
import { describe, it, expect, vi } from "vitest";
import { TracingLLMProvider } from "../../src/core/rag/providers/TracingLLMProvider.js";
import type {
  LLMProvider,
  LLMMessage,
} from "../../src/core/rag/providers/LLMProvider.js";

describe("TracingLLMProvider", () => {
  it("forwards generateWithTools to the inner provider and emits a trace", async () => {
    const toolResult = {
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function" as const,
          function: {
            name: "get_passage",
            arguments: '{"reference":"TIT 2:12","language":"en"}',
          },
        },
      ],
      finish_reason: "tool_calls",
    };

    const inner = {
      modelId: () => "openai/gpt-4.1",
      generate: vi.fn(async () => "plain"),
      generateWithTools: vi.fn(async () => toolResult),
    } as unknown as LLMProvider & {
      generateWithTools: ReturnType<typeof vi.fn>;
    };

    const traces: unknown[] = [];
    const wrapper = new TracingLLMProvider(
      inner,
      (ev) => traces.push(ev),
      "contextual",
    );

    expect(typeof wrapper.generateWithTools).toBe("function");

    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "help with Titus 2:12" },
    ];
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "get_passage",
          description: "Fetch scripture",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    const result = await wrapper.generateWithTools(messages, tools);

    expect(result).toEqual(toolResult);
    expect(inner.generateWithTools).toHaveBeenCalledOnce();
    expect(traces).toHaveLength(1);
    const ev = traces[0] as {
      type: string;
      label: string;
      response: string;
      streaming: boolean;
    };
    expect(ev.type).toBe("llm_call");
    expect(ev.label).toBe("contextual");
    expect(ev.streaming).toBe(false);
    expect(ev.response).toContain("[tool_call get_passage");
    expect(ev.response).toContain("TIT 2:12");
  });

  it("still wraps plain generate()", async () => {
    const inner: LLMProvider = {
      modelId: () => "openai/gpt-4.1",
      async generate(_messages: LLMMessage[]) {
        return "hello";
      },
    };
    const traces: unknown[] = [];
    const wrapper = new TracingLLMProvider(inner, (ev) => traces.push(ev));
    const out = await wrapper.generate([{ role: "user", content: "hi" }]);
    expect(out).toBe("hello");
    expect(traces).toHaveLength(1);
  });
});
