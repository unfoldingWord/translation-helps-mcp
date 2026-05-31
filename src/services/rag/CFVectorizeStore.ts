/**
 * Cloudflare Vectorize VectorStore implementation (production free tier).
 *
 * Uses the Cloudflare Vectorize binding injected via wrangler.toml:
 *   [[vectorize]]
 *   binding = "VECTORIZE"
 *   index_name = "translation-helps-production"
 *
 * Free tier limits (2026):
 *   Stored vector dimensions: 30M/month
 *   Queried vector dimensions: 5M/month
 *
 * This store is binding-based: it receives the VectorizeIndex object from
 * the CF Workers env (ServiceContext.vectorStore when running on Pages).
 *
 * NOTE: This module imports @cloudflare/workers-types via the tsconfig types
 * field. It will only compile cleanly in an environment where those types
 * are present. In Node/test environments, use InMemoryVectorStore instead.
 */

import type {
  VectorStore,
  VectorStoreDocumentInput,
  VectorStoreDocument,
  VectorStoreFilters,
  VectorStoreQueryResult,
} from "./interfaces.js";

/**
 * Minimal shape of the Cloudflare Vectorize index binding.
 * This avoids a hard dependency on @cloudflare/workers-types at runtime.
 */
interface VectorizeIndex {
  upsert(vectors: VectorizeVector[]): Promise<{ mutationId: string }>;
  query(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
      returnValues?: boolean;
      returnMetadata?: "all" | "none" | "indexed";
    },
  ): Promise<{ matches: VectorizeMatch[] }>;
  deleteByIds(ids: string[]): Promise<{ mutationId: string }>;
  getByIds(ids: string[]): Promise<VectorizeVector[]>;
}

interface VectorizeVector {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean | string[]>;
}

interface VectorizeMatch {
  id: string;
  score: number;
  values?: number[];
  metadata?: Record<string, string | number | boolean | string[]>;
}

/** Batch size for Vectorize upserts (CF limit: 1000 vectors per call) */
const UPSERT_BATCH_SIZE = 500;

function filtersToVectorizeFilter(
  filters?: VectorStoreFilters,
): Record<string, unknown> | undefined {
  if (!filters) return undefined;
  const f: Record<string, unknown> = {};
  if (filters.language) f["language"] = { $eq: filters.language };
  if (filters.owner) f["owner"] = { $eq: filters.owner };
  if (filters.project) f["project"] = { $eq: filters.project };
  if (filters.refTag) f["refTag"] = { $eq: filters.refTag };
  if (filters.resourceType) {
    const types = Array.isArray(filters.resourceType)
      ? filters.resourceType
      : [filters.resourceType];
    if (types.length === 1) {
      f["resourceType"] = { $eq: types[0] };
    } else {
      f["resourceType"] = { $in: types };
    }
  }
  return Object.keys(f).length > 0 ? f : undefined;
}

export class CFVectorizeStore implements VectorStore {
  constructor(private readonly index: VectorizeIndex) {}

  async upsert(documents: VectorStoreDocumentInput[]): Promise<void> {
    const vectors: VectorizeVector[] = documents.map((d) => ({
      id: d.id,
      values: new Array(Number(process.env["VECTOR_DIMENSION"] ?? 768)).fill(0),
      metadata: flattenMetadata({
        text: d.text,
        ...d.metadata,
      }),
    }));

    for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
      await this.index.upsert(vectors.slice(i, i + UPSERT_BATCH_SIZE));
    }
  }

  /**
   * Update the vector values for an already-upserted document.
   * Call this after embedding generation.
   */
  async updateEmbedding(docId: string, embedding: number[]): Promise<void> {
    const existing = await this.index.getByIds([docId]);
    const meta = existing[0]?.metadata ?? {};
    await this.index.upsert([{ id: docId, values: embedding, metadata: meta }]);
  }

  async query(
    embedding: number[],
    topK: number,
    filters?: VectorStoreFilters,
  ): Promise<VectorStoreQueryResult[]> {
    const filter = filtersToVectorizeFilter(filters);
    const response = await this.index.query(embedding, {
      topK,
      filter,
      returnMetadata: "all",
    });

    return response.matches.map((m) => {
      const { text, ...restMeta } = m.metadata ?? {};
      return {
        id: m.id,
        score: m.score,
        document: {
          id: m.id,
          text: String(text ?? ""),
          metadata: restMeta as VectorStoreDocument["metadata"],
        },
      };
    });
  }

  async delete(filter: VectorStoreFilters): Promise<void> {
    // Vectorize does not support filter-based deletes; we must query first.
    // Use a zero-vector query to get IDs matching the filter.
    const dim = Number(process.env["VECTOR_DIMENSION"] ?? 768);
    const zeroVector = new Array(dim).fill(0);
    const vFilter = filtersToVectorizeFilter(filter);

    const response = await this.index.query(zeroVector, {
      topK: 10000,
      filter: vFilter,
      returnMetadata: "none",
    });

    const ids = response.matches.map((m) => m.id);
    if (ids.length > 0) {
      await this.index.deleteByIds(ids);
    }
  }

  async findByText(
    text: string,
    _filters?: VectorStoreFilters,
    _max = 10,
  ): Promise<VectorStoreQueryResult[]> {
    // Vectorize does not support lexical search natively.
    // The caller (RagService) should fall back to KV-stored text index or
    // just return empty and degrade gracefully.
    return [];
  }

  async health(): Promise<{ status: "ok" | "degraded" }> {
    try {
      // A zero-cost probe: query with k=1
      const dim = Number(process.env["VECTOR_DIMENSION"] ?? 768);
      await this.index.query(new Array(dim).fill(0), { topK: 1 });
      return { status: "ok" };
    } catch {
      return { status: "degraded" };
    }
  }
}

/**
 * Flatten metadata values to the types Vectorize accepts:
 * string | number | boolean | string[]
 */
function flattenMetadata(
  meta: Record<string, unknown>,
): Record<string, string | number | boolean | string[]> {
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      result[k] = v;
    } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      result[k] = v as string[];
    } else {
      result[k] = String(v);
    }
  }
  return result;
}
