/**
 * Tier-1 multi-signal Reranker (edge-compatible, sync).
 *
 * Combines four signals:
 *   1. semanticScore  — original ANN cosine similarity
 *   2. lengthScore    — prefers 50–200 word chunks
 *   3. recencyScore   — prefers higher refTag version numbers (e.g. v80 > v72)
 *   4. frequencyScore — BM25-style term-frequency boost
 *
 * Changes from old Reranker.ts:
 *   - recencyScore now uses refTag version number (metadata.refTag) instead of
 *     a wall-clock timestamp field (which was never populated → always 0.5).
 *   - Entire rerank() is wrapped in try/catch so ANN results survive any error.
 *   - Input/output types use VectorStoreQueryResult from interfaces.ts.
 *
 * See RERANKING.md for the full specification.
 */

import type { VectorStoreQueryResult } from "./interfaces.js";

export type RerankConfig = {
  semanticWeight?: number;
  lengthWeight?: number;
  recencyWeight?: number;
  frequencyWeight?: number;
  minScore?: number;
};

export type RerankResult = VectorStoreQueryResult & {
  rerankScore: number;
  signals: {
    semanticScore: number;
    lengthScore: number;
    recencyScore: number;
    frequencyScore: number;
  };
};

const DEFAULT_CONFIG: Required<RerankConfig> = {
  semanticWeight: 0.4,
  lengthWeight: 0.2,
  recencyWeight: 0.2,
  frequencyWeight: 0.2,
  minScore: 0.05,
};

/**
 * Extract a numeric version from a refTag string like "v80" → 80.
 * Returns 0 for unrecognized formats.
 */
function refTagVersion(refTag: unknown): number {
  if (typeof refTag !== "string") return 0;
  const m = refTag.match(/v?(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

export class Reranker {
  private readonly cfg: Required<RerankConfig>;

  constructor(config?: RerankConfig) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  rerank(
    documents: VectorStoreQueryResult[],
    query: string,
    options: {
      maxResults?: number;
      /** resourceType → multiplier (e.g. { tn: 1.2 } to boost notes) */
      boost?: Record<string, number>;
      /** Global max refTag version seen in the result set (for normalisation) */
      maxRefVersion?: number;
    } = {},
  ): RerankResult[] {
    if (documents.length === 0) return [];

    try {
      const maxResults = options.maxResults ?? documents.length;
      const boostMap = options.boost ?? {};

      // Compute the max refTag version in the result set for normalisation
      const maxVer =
        options.maxRefVersion ??
        Math.max(
          1,
          ...documents.map((d) => refTagVersion(d.document.metadata["refTag"])),
        );

      const scored: RerankResult[] = documents.map((doc) => {
        const semanticScore = Math.min(1, Math.max(0, doc.score));
        const lengthScore = this.lengthScore(doc.document.text);
        const recencyScore = this.refTagRecencyScore(
          doc.document.metadata["refTag"],
          maxVer,
        );
        const frequencyScore = this.frequencyScore(query, doc.document.text);

        const boost =
          boostMap[String(doc.document.metadata["resourceType"] ?? "")] ?? 1;

        const rerankScore =
          (semanticScore * this.cfg.semanticWeight +
            lengthScore * this.cfg.lengthWeight +
            recencyScore * this.cfg.recencyWeight +
            frequencyScore * this.cfg.frequencyWeight) *
          boost;

        return {
          ...doc,
          rerankScore,
          signals: { semanticScore, lengthScore, recencyScore, frequencyScore },
        };
      });

      return scored
        .filter((d) => d.rerankScore >= this.cfg.minScore)
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .slice(0, maxResults);
    } catch {
      // Degraded rerank: return original ANN order with neutral scores
      return documents.slice(0, options.maxResults).map((d) => ({
        ...d,
        rerankScore: d.score,
        signals: {
          semanticScore: d.score,
          lengthScore: 0.5,
          recencyScore: 0.5,
          frequencyScore: 0.5,
        },
      }));
    }
  }

  private lengthScore(text: string): number {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < 10) return 0.3;
    if (words < 50) return 0.6;
    if (words <= 200) return 1.0;
    return 0.8;
  }

  /**
   * Convert refTag version to a normalised [0, 1] recency score.
   * Higher version number = more recent = higher score.
   * This fixes the old timestamp-based approach where the field was never set.
   */
  private refTagRecencyScore(refTag: unknown, maxVersion: number): number {
    if (maxVersion <= 0) return 0.5;
    const v = refTagVersion(refTag);
    if (v <= 0) return 0.3; // unknown → mildly penalise
    return Math.min(1, v / maxVersion);
  }

  private frequencyScore(query: string, text: string): number {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    if (terms.length === 0) return 0.5;
    const lower = text.toLowerCase();
    let hits = 0;
    for (const term of terms) {
      const re = new RegExp(`\\b${term}\\b`, "g");
      hits += (lower.match(re) ?? []).length;
    }
    return Math.min(1, hits / Math.max(1, terms.length));
  }
}

export function createReranker(config?: RerankConfig): Reranker {
  return new Reranker(config);
}
