/**
 * QdrantVectorStore — local dev / paid production VectorStore.
 *
 * Connects to a Qdrant instance (Docker or Qdrant Cloud).
 * Auto-creates the collection on first upsert if it does not exist.
 *
 * Environment variables:
 *   VECTOR_DB_URL         (default: http://localhost:6333)
 *   VECTOR_DB_API_KEY     (optional, for Qdrant Cloud)
 *   VECTOR_DB_COLLECTION  (default: translation-helps)
 *   VECTOR_DIMENSION      (default: 768)
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  VectorStore,
  VectorStoreDocumentInput,
  VectorStoreDocument,
  VectorStoreFilters,
  VectorStoreQueryResult,
} from "./interfaces.js";

const DEFAULT_URL = "http://localhost:6333";
const DEFAULT_COLLECTION = "translation-helps";
const DEFAULT_DIMENSION = 768;

function filtersToConditions(
  filters?: VectorStoreFilters,
): Record<string, unknown> | undefined {
  if (!filters) return undefined;
  const must: { key: string; match: { value: string } }[] = [];
  if (filters.language)
    must.push({ key: "language", match: { value: filters.language } });
  if (filters.owner)
    must.push({ key: "owner", match: { value: filters.owner } });
  if (filters.project)
    must.push({ key: "project", match: { value: filters.project } });
  if (filters.refTag)
    must.push({ key: "refTag", match: { value: filters.refTag } });
  if (filters.resourceType) {
    const types = Array.isArray(filters.resourceType)
      ? filters.resourceType
      : [filters.resourceType];
    if (types.length === 1) {
      must.push({ key: "resourceType", match: { value: types[0] } });
    }
    // Multi-value 'should' filter can be added here if needed
  }
  return must.length > 0 ? { must } : undefined;
}

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;
  private readonly collection: string;
  private readonly dimension: number;
  private collectionReady = false;

  constructor(options?: {
    url?: string;
    apiKey?: string;
    collection?: string;
    dimension?: number;
  }) {
    this.client = new QdrantClient({
      url: options?.url ?? process.env["VECTOR_DB_URL"] ?? DEFAULT_URL,
      apiKey: options?.apiKey ?? process.env["VECTOR_DB_API_KEY"],
    });
    this.collection =
      options?.collection ??
      process.env["VECTOR_DB_COLLECTION"] ??
      DEFAULT_COLLECTION;
    this.dimension =
      options?.dimension ??
      Number(process.env["VECTOR_DIMENSION"] ?? DEFAULT_DIMENSION);
  }

  private async ensureCollection(): Promise<void> {
    if (this.collectionReady) return;
    try {
      await this.client.getCollection(this.collection);
      this.collectionReady = true;
    } catch {
      // Collection does not exist — create it
      await this.client.createCollection(this.collection, {
        vectors: {
          size: this.dimension,
          distance: "Cosine",
        },
        optimizers_config: { default_segment_number: 2 },
        replication_factor: 1,
      });
      this.collectionReady = true;
    }
  }

  async upsert(documents: VectorStoreDocumentInput[]): Promise<void> {
    await this.ensureCollection();
    const points = documents
      .filter((d) => d.metadata && Object.keys(d.metadata).length > 0)
      .map((d) => ({
        id: this.hashId(d.id),
        vector: new Array(this.dimension).fill(0), // replaced after embedding
        payload: {
          _docId: d.id,
          text: d.text,
          ...d.metadata,
        },
      }));
    if (points.length === 0) return;
    await this.client.upsert(this.collection, { wait: true, points });
  }

  async updateEmbedding(docId: string, embedding: number[]): Promise<void> {
    await this.ensureCollection();
    const numericId = this.hashId(docId);
    await this.client.updateVectors(this.collection, {
      points: [{ id: numericId, vector: embedding }],
    });
  }

  async query(
    embedding: number[],
    topK: number,
    filters?: VectorStoreFilters,
  ): Promise<VectorStoreQueryResult[]> {
    await this.ensureCollection();
    const filter = filtersToConditions(filters);
    const results = await this.client.search(this.collection, {
      vector: embedding,
      limit: topK,
      filter: filter as Parameters<typeof this.client.search>[1]["filter"],
      with_payload: true,
      with_vector: false,
    });

    return results.map((r) => {
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      const docId = String(payload["_docId"] ?? r.id);
      const text = String(payload["text"] ?? "");
      const { _docId: _d, text: _t, ...metadata } = payload;
      return {
        id: docId,
        score: r.score,
        document: {
          id: docId,
          text,
          metadata: metadata as VectorStoreDocument["metadata"],
        },
      };
    });
  }

  async delete(filter: VectorStoreFilters): Promise<void> {
    await this.ensureCollection();
    const conditions = filtersToConditions(filter);
    if (!conditions) return;
    await this.client.delete(this.collection, {
      wait: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter: conditions as any,
    });
  }

  async findByText(
    text: string,
    _filters?: VectorStoreFilters,
    max = 10,
  ): Promise<VectorStoreQueryResult[]> {
    // Qdrant supports full-text search via payload index, but setting that
    // up requires schema migration. For the lexical fallback, we scroll a
    // sample and do client-side term matching. This is acceptable because
    // findByText is only called when ANN returns 0 results (rare path).
    await this.ensureCollection();
    const terms = text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    if (terms.length === 0) return [];

    const scroll = await this.client.scroll(this.collection, {
      limit: 500,
      with_payload: true,
      with_vector: false,
    });

    const results: VectorStoreQueryResult[] = [];
    for (const point of scroll.points) {
      const payload = (point.payload ?? {}) as Record<string, unknown>;
      const docText = String(payload["text"] ?? "").toLowerCase();
      let hits = 0;
      for (const term of terms) {
        if (docText.includes(term)) hits++;
      }
      if (hits > 0) {
        const docId = String(payload["_docId"] ?? point.id);
        const { _docId: _d, text: _t, ...metadata } = payload;
        results.push({
          id: docId,
          score: hits / terms.length,
          document: {
            id: docId,
            text: String(payload["text"] ?? ""),
            metadata: metadata as VectorStoreDocument["metadata"],
          },
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, max);
  }

  async health(): Promise<{ status: "ok" | "degraded" }> {
    try {
      await this.client.getCollections();
      return { status: "ok" };
    } catch {
      return { status: "degraded" };
    }
  }

  /**
   * Qdrant point IDs must be unsigned integers or UUIDs.
   * We hash the string doc_id to a stable 53-bit integer.
   */
  private hashId(id: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // Return as a 53-bit positive integer (safe for JS Number)
    return (h >>> 0) + (Math.abs(h) & 0x1fffff) * 0x100000000;
  }
}
