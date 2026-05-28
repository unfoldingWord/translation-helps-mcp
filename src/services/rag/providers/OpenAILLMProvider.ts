/**
 * OpenAI LLMProvider (optional paid escalation path).
 *
 * Requires: OPENAI_API_KEY environment variable.
 * Default model: gpt-4o-mini (~$0.15/1M input, $0.60/1M output).
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMGenerateOptions,
} from "./LLMProvider.js";

export class OpenAILLMProvider implements LLMProvider {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(options?: { model?: string; apiKey?: string }) {
    this.model = options?.model ?? process.env["LLM_MODEL"] ?? "gpt-4o-mini";
    this.apiKey = options?.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
  }

  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI chat completions failed: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    return json.choices[0]?.message?.content ?? "";
  }

  modelId(): string {
    return `openai/${this.model}`;
  }
}
