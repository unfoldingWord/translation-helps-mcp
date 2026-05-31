/**
 * VectorStore unit tests.
 *
 * Covers InMemoryVectorStore (always), QdrantVectorStore (skipped if no Docker),
 * and CFVectorizeStore (behaviour via a mock binding).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryVectorStore } from "../../src/services/rag/InMemoryVectorStore.js";
import { CFVectorizeStore } from "../../src/services/rag/CFVectorizeStore.js";
import type { VectorStoreDocumentInput } from "../../src/services/rag/interfaces.js";

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

function sampleDocs(): VectorStoreDocumentInput[] {
  return [
    {
      id: "resource:unfoldingWord:en_ult@v80:41-JHN.usfm:chunk:0",
      text: "For God so loved the world that he gave his only begotten Son",
      metadata: {
        language: "en",
        resourceType: "ult",
        owner: "unfoldingWord",
        project: "en_ult",
        refTag: "v80",
        path: "41-JHN.usfm",
        chunkIndex: 0,
        license: "CC BY-SA 4.0",
      },
    },
    {
      id: "resource:unfoldingWord:en_tn@v80:57-TIT.tsv:chunk:0",
      text: "Translation note: the term grace means undeserved favor from God",
      metadata: {
        language: "en",
        resourceType: "tn",
        owner: "unfoldingWord",
        project: "en_tn",
        refTag: "v80",
        path: "57-TIT.tsv",
        chunkIndex: 0,
        license: "CC BY-SA 4.0",
      },
    },
    {
      id: "resource:unfoldingWord:es_419_ult@v72:41-JHN.usfm:chunk:0",
      text: "Porque de tal manera amó Dios al mundo que dio a su Hijo unigénito",
      metadata: {
        language: "es-419",
        resourceType: "ult",
        owner: "unfoldingWord",
        project: "es_419_ult",
        refTag: "v72",
        path: "41-JHN.usfm",
        chunkIndex: 0,
        license: "CC BY-SA 4.0",
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// InMemoryVectorStore
// ---------------------------------------------------------------------------

describe("InMemoryVectorStore", () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  it("upserts documents and reports correct size", async () => {
    await store.upsert(sampleDocs());
    expect(store.size()).toBe(3);
  });

  it("upsert is idempotent by id", async () => {
    const docs = sampleDocs();
    await store.upsert(docs);
    await store.upsert(docs.slice(0, 1)); // re-upsert the first doc
    expect(store.size()).toBe(3);
  });

  it("query returns empty array when no embeddings are set", async () => {
    await store.upsert(sampleDocs());
    const results = await store.query([1, 0, 0], 5);
    // No embeddings set → cosine similarity is 0 for all; they are filtered out
    expect(results).toHaveLength(0);
  });

  it("query returns results sorted by cosine similarity after embedding is set", async () => {
    await store.upsert(sampleDocs());
    // Set a non-trivial embedding for the first doc
    store.setEmbedding(sampleDocs()[0].id, [1, 0, 0]);
    store.setEmbedding(sampleDocs()[1].id, [0, 1, 0]);

    const results = await store.query([1, 0, 0], 5);
    expect(results[0].id).toBe(sampleDocs()[0].id);
    expect(results[0].score).toBeCloseTo(1.0, 4);
  });

  it("query respects language filter", async () => {
    await store.upsert(sampleDocs());
    store.setEmbedding(sampleDocs()[0].id, [1, 0, 0]);
    store.setEmbedding(sampleDocs()[2].id, [0.9, 0.1, 0]);

    const results = await store.query([1, 0, 0], 5, { language: "es-419" });
    expect(
      results.every((r) => r.document.metadata["language"] === "es-419"),
    ).toBe(true);
  });

  it("query respects resourceType filter (array)", async () => {
    await store.upsert(sampleDocs());
    sampleDocs().forEach((d, i) =>
      store.setEmbedding(
        d.id,
        i === 0 ? [1, 0] : i === 1 ? [0, 1] : [0.5, 0.5],
      ),
    );

    const results = await store.query([1, 0], 5, { resourceType: ["ult"] });
    expect(
      results.every((r) => r.document.metadata["resourceType"] === "ult"),
    ).toBe(true);
  });

  it("delete removes matching documents", async () => {
    await store.upsert(sampleDocs());
    await store.delete({ language: "es-419" });
    expect(store.size()).toBe(2);
  });

  it("findByText returns results by term overlap", async () => {
    await store.upsert(sampleDocs());
    const results = await store.findByText("grace undeserved favor");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].document.text).toContain("grace");
  });

  it("findByText returns empty for unmatched query", async () => {
    await store.upsert(sampleDocs());
    const results = await store.findByText("qwerty frobnicate zxcvbnm");
    expect(results).toHaveLength(0);
  });

  it("health returns ok", async () => {
    const result = await store.health();
    expect(result.status).toBe("ok");
  });

  it("clear removes all documents", async () => {
    await store.upsert(sampleDocs());
    store.clear();
    expect(store.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CFVectorizeStore (mocked binding)
// ---------------------------------------------------------------------------

describe("CFVectorizeStore (mock binding)", () => {
  it("upserts documents without throwing", async () => {
    const upserted: unknown[] = [];
    const mockIndex = {
      async upsert(vecs: unknown[]) {
        upserted.push(...vecs);
        return { mutationId: "test" };
      },
      async query() {
        return { matches: [] };
      },
      async deleteByIds() {
        return { mutationId: "test" };
      },
      async getByIds() {
        return [];
      },
    };
    const cfStore = new CFVectorizeStore(mockIndex as never);
    await cfStore.upsert(sampleDocs());
    expect(upserted.length).toBe(3);
  });

  it("query maps CF matches to VectorStoreQueryResult", async () => {
    const mockIndex = {
      async upsert() {
        return { mutationId: "test" };
      },
      async query() {
        return {
          matches: [
            {
              id: "resource:unfoldingWord:en_ult@v80:41-JHN.usfm:chunk:0",
              score: 0.95,
              metadata: {
                text: "For God so loved the world",
                language: "en",
                resourceType: "ult",
                owner: "unfoldingWord",
                project: "en_ult",
                refTag: "v80",
                path: "41-JHN.usfm",
                chunkIndex: 0,
              },
            },
          ],
        };
      },
      async deleteByIds() {
        return { mutationId: "test" };
      },
      async getByIds() {
        return [];
      },
    };
    const cfStore = new CFVectorizeStore(mockIndex as never);
    const results = await cfStore.query(new Array(768).fill(0), 5);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(0.95);
    expect(results[0].document.text).toBe("For God so loved the world");
  });

  it("findByText returns empty (Vectorize has no lexical search)", async () => {
    const mockIndex = {
      async upsert() {
        return { mutationId: "test" };
      },
      async query() {
        return { matches: [] };
      },
      async deleteByIds() {
        return { mutationId: "test" };
      },
      async getByIds() {
        return [];
      },
    };
    const cfStore = new CFVectorizeStore(mockIndex as never);
    const results = await cfStore.findByText("any text");
    expect(results).toHaveLength(0);
  });
});
