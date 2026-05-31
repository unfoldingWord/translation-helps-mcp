/**
 * Integration tests for RagService.getBundle() + indexResource().
 *
 * These tests use InMemory implementations to validate the full bundle
 * assembly pipeline without external services.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RagService } from "../src/services/rag/RagService.js";
import { InMemoryVectorStore } from "../src/services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../src/services/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../src/services/rag/providers/FakeEmbeddingService.js";
import type { VectorStoreDocumentInput } from "../src/services/rag/interfaces.js";

function makeTnDoc(
  id: string,
  text: string,
  language = "en",
  refTag = "v80",
): VectorStoreDocumentInput {
  return {
    id,
    text,
    metadata: {
      language,
      resourceType: "tn",
      owner: "unfoldingWord",
      project: `${language}_tn`,
      refTag,
      path: "41-JHN.tsv",
      chunkIndex: 0,
    },
  };
}

describe("RagService.getBundle()", () => {
  let vectorStore: InMemoryVectorStore;
  let kvStore: InMemoryKVStore;
  let embeddingService: FakeEmbeddingService;
  let ragService: RagService;

  beforeEach(async () => {
    vectorStore = new InMemoryVectorStore();
    kvStore = new InMemoryKVStore();
    embeddingService = new FakeEmbeddingService();
    ragService = new RagService({ vectorStore, kvStore, embeddingService });

    // Populate with some TN docs for JHN 3:16
    const tnDocs = [
      makeTnDoc(
        "jhn-3-16-1",
        "JHN 3:16 — For God so loved the world that he gave rc://en/tw/bible/kt/love",
      ),
      makeTnDoc(
        "jhn-3-16-2",
        "JHN 3:16 — Whoever believes in him shall not perish",
      ),
    ];
    for (const doc of tnDocs) {
      await vectorStore.upsert([doc]);
    }
  });

  it("returns a bundle with correct shape", async () => {
    const result = await ragService.getBundle({
      language: "en",
      reference: "JHN 3:16",
    });
    expect(result.requestId).toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.bundle).toMatchObject({
      scripture: { format: expect.stringMatching(/^(usfm|plain)$/) },
      notes: expect.any(Array),
      tw: expect.any(Array),
      ta: expect.any(Array),
      metadata: {
        language: "en",
        reference: "JHN 3:16",
        cacheStatus: expect.stringMatching(/^(memory|edge|r2|miss)$/),
        license: expect.any(String),
        provenance: expect.any(Array),
      },
    });
  });

  it("returns cacheStatus=miss on first call", async () => {
    const result = await ragService.getBundle({
      language: "en",
      reference: "JHN 3:16",
    });
    expect(result.bundle.metadata.cacheStatus).toBe("miss");
  });

  it("returns cacheStatus=memory on second call (L1 hit)", async () => {
    await ragService.getBundle({ language: "en", reference: "JHN 3:16" });
    const second = await ragService.getBundle({
      language: "en",
      reference: "JHN 3:16",
    });
    expect(second.bundle.metadata.cacheStatus).toBe("memory");
  });

  it("bypasses cache when force=true", async () => {
    await ragService.getBundle({ language: "en", reference: "JHN 3:16" });
    const forced = await ragService.getBundle({
      language: "en",
      reference: "JHN 3:16",
      force: true,
    });
    expect(forced.bundle.metadata.cacheStatus).toBe("miss");
  });

  it("propagates requestId", async () => {
    const result = await ragService.getBundle({
      language: "en",
      reference: "JHN 3:16",
      requestId: "custom-req-id",
    });
    expect(result.requestId).toBe("custom-req-id");
  });

  it("returns empty notes for unknown reference", async () => {
    const result = await ragService.getBundle({
      language: "en",
      reference: "REV 22:21",
    });
    expect(result.bundle.notes).toHaveLength(0);
  });
});

describe("RagService.indexResource()", () => {
  let ragService: RagService;

  beforeEach(() => {
    ragService = new RagService({
      vectorStore: new InMemoryVectorStore(),
      kvStore: new InMemoryKVStore(),
      embeddingService: new FakeEmbeddingService(),
    });
  });

  it("returns taskId and queued status", async () => {
    const result = await ragService.indexResource({
      resourceId: "unfoldingWord/en_tn",
    });
    expect(result.taskId).toMatch(/^idx-/);
    expect(result.status).toBe("queued");
  });

  it("throws INVALID_RESOURCE_ID for missing slash", async () => {
    await expect(
      ragService.indexResource({ resourceId: "no-slash-here" }),
    ).rejects.toMatchObject({ code: "INVALID_RESOURCE_ID" });
  });

  it("writes job record to KV", async () => {
    const kv = new InMemoryKVStore();
    const svc = new RagService({
      vectorStore: new InMemoryVectorStore(),
      kvStore: kv,
      embeddingService: new FakeEmbeddingService(),
    });
    const result = await svc.indexResource({
      resourceId: "unfoldingWord/en_ult",
    });
    const raw = await kv.get(`indexJob:${result.taskId}`);
    expect(raw).not.toBeNull();
    const job = JSON.parse(raw!);
    expect(job.resourceId).toBe("unfoldingWord/en_ult");
    expect(job.status).toBe("queued");
  });
});
