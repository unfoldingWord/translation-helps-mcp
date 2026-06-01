/**
 * Unit tests for the core RAG infrastructure that can run without
 * any Cloudflare or external services.
 */
import { describe, it, expect, vi } from "vitest";
import { InMemoryVectorStore } from "../../src/core/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../../src/core/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../../src/core/rag/providers/FakeEmbeddingService.js";
import { RagService } from "../../src/core/rag/RagService.js";

describe("InMemoryVectorStore", () => {
  it("stores and retrieves vectors", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([
      { id: "1", metadata: { text: "grace", language: "en" } },
    ]);
    // Set embedding directly after upsert
    store.setEmbedding("1", [1, 0, 0]);
    const results = await store.query([1, 0, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0].document.metadata?.text).toBe("grace");
  });
});

describe("InMemoryKVStore", () => {
  it("set and get a value", async () => {
    const kv = new InMemoryKVStore();
    await kv.set("key1", "value1", 3600);
    expect(await kv.get("key1")).toBe("value1");
  });

  it("delete a value", async () => {
    const kv = new InMemoryKVStore();
    await kv.set("key2", "val", 60);
    await kv.del("key2");
    expect(await kv.get("key2")).toBeNull();
  });
});

describe("RagService.query", () => {
  it("returns empty documents when vector store is empty", async () => {
    const vectorStore = new InMemoryVectorStore();
    const kvStore = new InMemoryKVStore();
    const embeddingService = new FakeEmbeddingService();
    const rag = new RagService({ vectorStore, kvStore, embeddingService });

    const result = await rag.query({ query: "grace", language: "en", topK: 5 });
    expect(result.documents).toEqual([]);
  });

  it("returns documents when vectors exist", async () => {
    const vectorStore = new InMemoryVectorStore();
    const kvStore = new InMemoryKVStore();
    const embeddingService = new FakeEmbeddingService();

    // Seed: upsert then set embedding
    await vectorStore.upsert([
      {
        id: "tw-grace",
        metadata: {
          text: "grace is unmerited favor",
          language: "en",
          resourceType: "tw",
        },
      },
    ]);
    const [embedding] = await embeddingService.embed([
      "grace is unmerited favor",
    ]);
    vectorStore.setEmbedding("tw-grace", embedding);

    const rag = new RagService({ vectorStore, kvStore, embeddingService });
    const result = await rag.query({ query: "grace", language: "en", topK: 3 });
    expect(result.documents.length).toBeGreaterThan(0);
  });
});
