/**
 * OpenAI LLMProvider (optional paid escalation path).
 *
 * Requires: OPENAI_API_KEY environment variable.
 * Default model: gpt-4o (~$2.50/1M input, $10/1M output).
 *
 * Exposes `generateWithTools()` for the agentic function-calling loop.
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMGenerateOptions,
} from "./LLMProvider.js";

// ---------------------------------------------------------------------------
// OpenAI API types
// ---------------------------------------------------------------------------

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatCompletionResponse {
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
// Provider
// ---------------------------------------------------------------------------

export class OpenAILLMProvider implements LLMProvider {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(options?: { model?: string; apiKey?: string }) {
    this.model = options?.model ?? process.env["LLM_MODEL"] ?? "gpt-4o";
    this.apiKey = options?.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
  }

  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<string> {
    const result = await this.chatCompletion(messages as OpenAIMessage[], undefined, options);
    return result.choices[0]?.message?.content ?? "";
  }

  /**
   * Function-calling variant used by the agentic loop.
   * Returns the first choice's message with optional tool_calls.
   */
  async generateWithTools(
    messages: OpenAIMessage[],
    tools: OpenAITool[],
    options?: LLMGenerateOptions,
  ): Promise<{
    content: string | null;
    tool_calls?: OpenAIToolCall[];
    finish_reason: string;
  }> {
    const result = await this.chatCompletion(messages, tools, options);
    const choice = result.choices[0];
    return {
      content: choice?.message?.content ?? null,
      tool_calls: choice?.message?.tool_calls,
      finish_reason: choice?.finish_reason ?? "stop",
    };
  }

  modelId(): string {
    return `openai/${this.model}`;
  }

  /**
   * Stream tokens from OpenAI using server-sent events.
   * Yields each text delta as it arrives; callers must consume the iterable.
   */
  async *generateStream(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): AsyncIterable<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 1024,
      stream: true,
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OpenAI streaming failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
      );
    }

    if (!response.body) {
      throw new Error("OpenAI streaming: response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by "\n\n"
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") return;
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string | null } }>;
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            } catch {
              // Ignore malformed frames
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async chatCompletion(
    messages: OpenAIMessage[],
    tools?: OpenAITool[],
    options?: LLMGenerateOptions,
  ): Promise<ChatCompletionResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 1024,
    };

    if (tools && tools.length > 0) {
      body["tools"] = tools;
      body["tool_choice"] = "auto";
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OpenAI chat completions failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
      );
    }

    return response.json() as Promise<ChatCompletionResponse>;
  }
}
