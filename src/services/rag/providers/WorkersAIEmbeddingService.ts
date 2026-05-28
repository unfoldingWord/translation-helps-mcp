/**
 * Cloudflare Workers AI EmbeddingService (free-tier production default).
 *
 * Uses model: @cf/baai/bge-base-en-v1.5 (768 dim).
 * Free tier: ~1M neurons/day (generous for moderate traffic).
 *
 * Requires: CF Workers AI binding (env.ai / ServiceContext.ai).
 * Only works inside Cloudflare Workers/Pages runtime.
 *
 * GOTCHA: dim=768 must match VECTOR_DIMENSION and the Vectorize index.
 * See GOTCHAS.md #9 and FREE_TIER_OPTIONS.md.
 */

import type { EmbeddingService } from "./EmbeddingService.js";
import type { WorkersAILike } from "../interfaces.js";

const MODEL = "@cf/baai/bge-base-en-v1.5";
const DIMENSION = 768;
const BATCH_SIZE = 100; // CF Workers AI accepts small batches

export class WorkersAIEmbeddingService implements EmbeddingService {
  constructor(private readonly ai: WorkersAILike) {}

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await this.ai.run(MODEL, { text: batch });

      if (!response.data || !Array.isArray(response.data)) {
        throw new Error(
          `Workers AI embedding response missing data field for model ${MODEL}`,
        );
      }

      results.push(...(response.data as number[][]));
    }

    return results;
  }

  dimensionality(): number {
    return DIMENSION;
  }

  modelId(): string {
    return `workersai/${MODEL}`;
  }
}
