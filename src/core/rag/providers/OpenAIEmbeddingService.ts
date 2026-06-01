/**
 * OpenAI EmbeddingService (optional paid escalation path).
 *
 * Requires: OPENAI_API_KEY environment variable.
 * Default model: text-embedding-3-small (1536 dim, ~$0.02 / 1M tokens).
 *
 * Batching: OpenAI accepts up to 2048 inputs per request.
 * GOTCHA: If you switch from WorkersAI (768 dim) to OpenAI (1536 dim),
 * you MUST delete and recreate the vector index. See GOTCHAS.md #9.
 */

import type { EmbeddingService } from "./EmbeddingService.js";

const BATCH_SIZE = 512;

export class OpenAIEmbeddingService implements EmbeddingService {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly dim: number;

  constructor(options?: {
    model?: string;
    apiKey?: string;
    dimension?: number;
  }) {
    this.model =
      options?.model ??
      process.env["EMBEDDINGS_MODEL"] ??
      "text-embedding-3-small";
    this.apiKey = options?.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    // Infer dimension from model name if not provided
    this.dim =
      options?.dimension ?? (this.model.includes("large") ? 3072 : 1536);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: batch }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI embeddings request failed: ${response.status} ${response.statusText}`,
        );
      }

      const json = (await response.json()) as {
        data: { embedding: number[]; index: number }[];
      };

      // Sort by index to preserve order
      const sorted = json.data.sort((a, b) => a.index - b.index);
      results.push(...sorted.map((d) => d.embedding));
    }

    return results;
  }

  dimensionality(): number {
    return this.dim;
  }

  modelId(): string {
    return `openai/${this.model}`;
  }
}
