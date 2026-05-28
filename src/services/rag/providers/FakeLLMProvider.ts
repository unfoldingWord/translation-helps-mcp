/**
 * FakeLLMProvider — returns template responses for dev/test.
 *
 * Does not make any network calls. Useful for:
 *   - Unit tests that need deterministic LLM output
 *   - Local dev without API keys
 *   - CI pipelines (no cost, no latency)
 *
 * Returns the last user message prefixed with "[FAKE LLM]: ".
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMGenerateOptions,
} from "./LLMProvider.js";

export class FakeLLMProvider implements LLMProvider {
  async generate(
    messages: LLMMessage[],
    _options?: LLMGenerateOptions,
  ): Promise<string> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const preview = lastUser?.content.slice(0, 120) ?? "(no user message)";
    return `[FAKE LLM]: ${preview}`;
  }

  modelId(): string {
    return "fake/echo";
  }
}
