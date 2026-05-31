/**
 * LLMProvider interface + provider registry.
 *
 * Implementations:
 *   FakeLLMProvider.ts      — echo/template responses, $0 (dev/test)
 *   OpenAILLMProvider.ts    — paid, highest quality
 *   WorkersAILLMProvider.ts — free tier via CF Workers AI
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  /** requestId for observability */
  requestId?: string;
}

export interface LLMProvider {
  /**
   * Generate a completion given a list of messages.
   */
  generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<string>;

  /** Human-readable model identifier for observability. */
  modelId(): string;
}
