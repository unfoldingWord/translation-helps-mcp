/**
 * TracingLLMProvider — wraps any LLMProvider and emits a trace event for every call.
 * Only used when debug mode is active; zero overhead otherwise.
 *
 * IMPORTANT: Must forward `generateWithTools` when the inner provider has it.
 * The agentic loop duck-types on that method; dropping it silently degrades
 * open-ended follow-ups to training-only mode (debug-mode Heisenbug).
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMGenerateOptions,
} from "./LLMProvider.js";
import type { TraceEvent } from "../../harness/traceEvents.js";

export type TraceCallback = (ev: TraceEvent) => void;

/** Minimal shapes for OpenAI-style function-calling (matches OpenAILLMProvider). */
interface ToolCallMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

interface GenerateWithToolsResult {
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  finish_reason: string;
}

interface LLMWithTools {
  generateWithTools(
    messages: ToolCallMessage[],
    tools: OpenAITool[],
    options?: LLMGenerateOptions,
  ): Promise<GenerateWithToolsResult>;
}

function formatToolCallsResponse(result: GenerateWithToolsResult): string {
  const parts: string[] = [];
  if (result.content) parts.push(result.content);
  if (result.tool_calls?.length) {
    for (const tc of result.tool_calls) {
      parts.push(`[tool_call ${tc.function.name} ${tc.function.arguments}]`);
    }
  }
  if (parts.length === 0) {
    parts.push(`[finish_reason=${result.finish_reason}]`);
  }
  return parts.join("\n");
}

export class TracingLLMProvider implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly onTrace: TraceCallback,
    private readonly label?: string,
  ) {}

  modelId(): string {
    return this.inner.modelId();
  }

  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<string> {
    const start = Date.now();
    const label = options?.requestId ?? this.label ?? "generate";
    try {
      const response = await this.inner.generate(messages, options);
      this.onTrace({
        type: "llm_call",
        label,
        model: this.inner.modelId(),
        messages,
        response,
        streaming: false,
        ms: Date.now() - start,
      });
      return response;
    } catch (err) {
      this.onTrace({
        type: "llm_call",
        label,
        model: this.inner.modelId(),
        messages,
        streaming: false,
        ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Forward function-calling to the inner provider so the agentic loop still
   * works when this wrapper is installed for X-ray debug mode.
   */
  async generateWithTools(
    messages: ToolCallMessage[],
    tools: OpenAITool[],
    options?: LLMGenerateOptions,
  ): Promise<GenerateWithToolsResult> {
    const innerWithTools = this.inner as unknown as LLMWithTools;
    if (typeof innerWithTools.generateWithTools !== "function") {
      throw new Error(
        `TracingLLMProvider: inner provider ${this.inner.modelId()} does not support generateWithTools`,
      );
    }

    const start = Date.now();
    const label = options?.requestId ?? this.label ?? "generateWithTools";
    // Trace uses LLMMessage[]; tool-loop messages are a superset — cast for the event.
    const traceMessages = messages as unknown as LLMMessage[];
    try {
      const result = await innerWithTools.generateWithTools(
        messages,
        tools,
        options,
      );
      this.onTrace({
        type: "llm_call",
        label,
        model: this.inner.modelId(),
        messages: traceMessages,
        response: formatToolCallsResponse(result),
        streaming: false,
        ms: Date.now() - start,
      });
      return result;
    } catch (err) {
      this.onTrace({
        type: "llm_call",
        label,
        model: this.inner.modelId(),
        messages: traceMessages,
        streaming: false,
        ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  generateStream(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): AsyncIterable<string> {
    if (!this.inner.generateStream) {
      // Fall back to generate() if the inner provider doesn't support streaming
      const generate = (msgs: LLMMessage[], opts?: LLMGenerateOptions) =>
        this.generate(msgs, opts);
      return (async function* () {
        yield await generate(messages, options);
      })();
    }

    const inner = this.inner;
    const onTrace = this.onTrace;
    const label = options?.requestId ?? this.label ?? "generateStream";
    const model = this.inner.modelId();

    return (async function* () {
      const start = Date.now();
      const chunks: string[] = [];
      try {
        for await (const delta of inner.generateStream!(messages, options)) {
          chunks.push(delta);
          yield delta;
        }
        onTrace({
          type: "llm_call",
          label,
          model,
          messages,
          response: chunks.join(""),
          streaming: true,
          ms: Date.now() - start,
        });
      } catch (err) {
        onTrace({
          type: "llm_call",
          label,
          model,
          messages,
          streaming: true,
          ms: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    })();
  }
}
