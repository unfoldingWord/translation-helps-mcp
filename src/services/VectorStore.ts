// PLACEHOLDER — replaced in T-05 (src/services/rag/InMemoryVectorStore.ts etc.)
// Kept here only so T-02..T-04 typecheck passes; will be deleted in T-05.

export interface VectorStoreDocument {
  id: string;
  text: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  provenance?: {
    sourceType: string;
    excerptStart: number;
    excerptEnd: number;
  };
}

export type VectorStoreDocumentInput = Omit<VectorStoreDocument, "embedding">;

export interface VectorStore {
  addDocuments(docs: VectorStoreDocumentInput[]): Promise<void>;
  removeDocumentsByFilter(
    predicate: (doc: VectorStoreDocument) => boolean,
  ): void;
  query(
    text: string,
    k: number,
    filters?: Record<string, unknown>,
  ): Promise<{ id: string; score: number; document: VectorStoreDocument }[]>;
  clear(): void;
}

export function createVectorStore(): VectorStore {
  const docs = new Map<string, VectorStoreDocument>();
  return {
    async addDocuments(inputs) {
      for (const d of inputs) docs.set(d.id, { ...d, embedding: [] });
    },
    removeDocumentsByFilter(pred) {
      for (const [k, v] of docs) if (pred(v)) docs.delete(k);
    },
    async query() {
      return [];
    },
    clear() {
      docs.clear();
    },
  };
}
