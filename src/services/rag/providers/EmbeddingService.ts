/**
 * EmbeddingService interface + provider registry.
 *
 * Implementations live in sibling files:
 *   FakeEmbeddingService.ts      — deterministic, $0 (dev/test)
 *   OpenAIEmbeddingService.ts    — paid, high-quality
 *   WorkersAIEmbeddingService.ts — free tier via CF Workers AI binding
 */

export interface EmbeddingService {
  /**
   * Generate embeddings for one or more texts.
   * Returns a 2D array: one embedding vector per input text.
   * All vectors have length = dimensionality().
   */
  embed(texts: string[]): Promise<number[][]>;

  /** Output dimension of this provider's embedding model. */
  dimensionality(): number;

  /** Human-readable model identifier for observability. */
  modelId(): string;
}
