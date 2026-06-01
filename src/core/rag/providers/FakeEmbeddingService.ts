/**
 * Fake EmbeddingService — deterministic, zero cost, for dev/test.
 *
 * Produces vectors by hashing the input text. Embeddings are NOT
 * semantically meaningful; they are stable for a given text so tests
 * are reproducible.
 *
 * Uses dimension=768 to match WorkersAIEmbeddingService default.
 */

import type { EmbeddingService } from "./EmbeddingService.js";

const DIMENSION = 768;

function deterministicVector(text: string, dim: number): number[] {
  const vec = new Array<number>(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Distribute across dimensions
    vec[i % dim] = (vec[i % dim] + code / 255) % 1.0;
  }
  // Normalize to unit vector
  const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / magnitude);
}

export class FakeEmbeddingService implements EmbeddingService {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => deterministicVector(t, DIMENSION));
  }

  dimensionality(): number {
    return DIMENSION;
  }

  modelId(): string {
    return "fake/deterministic-768";
  }
}
