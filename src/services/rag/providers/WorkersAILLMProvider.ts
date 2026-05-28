/**
 * Cloudflare Workers AI LLMProvider (free-tier production default).
 *
 * Model: @cf/meta/llama-3.1-8b-instruct
 * Free tier: ~10K tokens/day (suitable for light traffic and dev/staging).
 *
 * Requires: CF Workers AI binding (ServiceContext.ai).
 * Only works inside Cloudflare Workers/Pages runtime.
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMGenerateOptions,
} from "./LLMProvider.js";
import type { WorkersAILike } from "../interfaces.js";

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export class WorkersAILLMProvider implements LLMProvider {
  private readonly model: string;

  constructor(
    private readonly ai: WorkersAILike,
    options?: { model?: string },
  ) {
    this.model = options?.model ?? process.env["LLM_MODEL"] ?? DEFAULT_MODEL;
  }

  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<string> {
    const response = await this.ai.run(this.model, {
      messages,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.3,
    });

    if (typeof response["response"] === "string") {
      return response["response"];
    }

    throw new Error(
      `Workers AI LLM response missing 'response' field for model ${this.model}`,
    );
  }

  modelId(): string {
    return `workersai/${this.model}`;
  }
}
