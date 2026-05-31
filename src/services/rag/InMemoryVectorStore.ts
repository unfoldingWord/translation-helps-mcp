/**
 * In-memory VectorStore implementation.
 *
 * Uses cosine similarity for ANN queries and simple term-frequency
 * matching for the lexical `findByText` fallback.
 *
 * Suitable for: unit tests, CI, and single-worker local dev.
 * Not suitable for: production (no persistence, no sharing across workers).
 */

import type {
  VectorStore,
  VectorStoreDocument,
  VectorStoreDocumentInput,
  VectorStoreFilters,
  VectorStoreQueryResult,
} from "./interfaces.js";

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function matchesFilters(
  meta: VectorStoreDocument["metadata"],
  filters?: VectorStoreFilters,
): boolean {
  if (!filters) return true;
  if (filters.language && meta["language"] !== filters.language) return false;
  if (filters.owner && meta["owner"] !== filters.owner) return false;
  if (filters.project && meta["project"] !== filters.project) return false;
  if (filters.refTag && meta["refTag"] !== filters.refTag) return false;
  if (filters.resourceType) {
    const types = Array.isArray(filters.resourceType)
      ? filters.resourceType
      : [filters.resourceType];
    if (!types.includes(String(meta["resourceType"]))) return false;
  }
  return true;
}

export class InMemoryVectorStore implements VectorStore {
  private readonly docs = new Map<string, VectorStoreDocument>();

  async upsert(documents: VectorStoreDocumentInput[]): Promise<void> {
    for (const d of documents) {
      const existing = this.docs.get(d.id);
      this.docs.set(d.id, {
        ...d,
        embedding: existing?.embedding ?? [],
      });
    }
  }

  /**
   * Set the embedding for an already-upserted document.
   * Called by the indexer after embedding generation.
   */
  setEmbedding(id: string, embedding: number[]): void {
    const doc = this.docs.get(id);
    if (doc) {
      doc.embedding = embedding;
    }
  }

  async query(
    embedding: number[],
    topK: number,
    filters?: VectorStoreFilters,
  ): Promise<VectorStoreQueryResult[]> {
    const results: VectorStoreQueryResult[] = [];

    for (const doc of this.docs.values()) {
      if (!matchesFilters(doc.metadata, filters)) continue;
      if (!doc.embedding || doc.embedding.length === 0) continue;
      const score = cosineSimilarity(embedding, doc.embedding);
      results.push({ id: doc.id, score, document: doc });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async delete(filter: VectorStoreFilters): Promise<void> {
    for (const [key, doc] of this.docs) {
      if (matchesFilters(doc.metadata, filter)) {
        this.docs.delete(key);
      }
    }
  }

  async findByText(
    text: string,
    filters?: VectorStoreFilters,
    max = 10,
  ): Promise<VectorStoreQueryResult[]> {
    const terms = text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);

    if (terms.length === 0) return [];

    const results: VectorStoreQueryResult[] = [];

    for (const doc of this.docs.values()) {
      if (!matchesFilters(doc.metadata, filters)) continue;
      const lower = doc.text.toLowerCase();
      let hits = 0;
      for (const term of terms) {
        if (lower.includes(term)) hits++;
      }
      if (hits > 0) {
        results.push({ id: doc.id, score: hits / terms.length, document: doc });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, max);
  }

  async health(): Promise<{ status: "ok" | "degraded" }> {
    return { status: "ok" };
  }

  /** Test helper: total number of stored documents */
  size(): number {
    return this.docs.size;
  }

  /** Test helper: clear all documents */
  clear(): void {
    this.docs.clear();
  }
}
