/**
 * RAG MCP tool handler integration tests.
 *
 * Updated for T-12: uses new tool handler signatures and validates
 * metadata.cacheStatus shape per CONTRACTS_DETAILED.md §3.
 */

import { describe, it, expect } from "vitest";
import { handleIndexResource } from "../src/tools/indexResource.js";
import { handleGetBundle } from "../src/tools/getBundle.js";
import { handleRagQuery } from "../src/tools/ragQuery.js";
import { RagService } from "../src/services/rag/RagService.js";
import { InMemoryVectorStore } from "../src/services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../src/services/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../src/services/rag/providers/FakeEmbeddingService.js";

function makeService(): RagService {
  return new RagService({
    vectorStore: new InMemoryVectorStore(),
    kvStore: new InMemoryKVStore(),
    embeddingService: new FakeEmbeddingService(),
  });
}

describe("RAG MCP tool handlers", () => {
  it("index_resource: returns taskId and queued status", async () => {
    const svc = makeService();
    const response = await handleIndexResource(
      { resourceId: "unfoldingWord/en_tn" },
      svc,
    );
    expect(response.isError).toBe(false);
    expect(response).toHaveProperty("content");
    expect(response.metadata).toMatchObject({
      tool: "index_resource",
      status: "queued",
    });
    expect(response.metadata.taskId).toMatch(/^idx-/);
  });

  it("index_resource: rejects missing slash resourceId", async () => {
    const svc = makeService();
    const response = await handleIndexResource({ resourceId: "no-slash" }, svc);
    expect(response.isError).toBe(true);
  });

  it("index_resource: blocked without ADMIN_TOKEN when set", async () => {
    const original = process.env["ADMIN_TOKEN"];
    process.env["ADMIN_TOKEN"] = "secret-token";
    try {
      const svc = makeService();
      const response = await handleIndexResource(
        { resourceId: "unfoldingWord/en_tn" },
        svc,
      );
      expect(response.isError).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env["ADMIN_TOKEN"];
      } else {
        process.env["ADMIN_TOKEN"] = original;
      }
    }
  });

  it("index_resource: accepts correct adminToken", async () => {
    const original = process.env["ADMIN_TOKEN"];
    process.env["ADMIN_TOKEN"] = "correct-token";
    try {
      const svc = makeService();
      const response = await handleIndexResource(
        { resourceId: "unfoldingWord/en_tn", adminToken: "correct-token" },
        svc,
      );
      expect(response.isError).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env["ADMIN_TOKEN"];
      } else {
        process.env["ADMIN_TOKEN"] = original;
      }
    }
  });

  it("get_bundle: returns bundle with correct cacheStatus field", async () => {
    const svc = makeService();
    const response = await handleGetBundle(
      { language: "en", reference: "JHN 3:16" },
      svc,
    );
    expect(response.isError).toBe(false);
    expect(response.metadata).toMatchObject({
      tool: "get_bundle",
      cacheStatus: expect.stringMatching(/^(memory|edge|r2|miss)$/),
    });
    const bundle = JSON.parse(
      (response.content as Array<{ text: string }>)[0]!.text,
    );
    expect(bundle.metadata).toBeDefined();
    expect(bundle.metadata.cacheStatus).toMatch(/^(memory|edge|r2|miss)$/);
  });

  it("get_bundle: returns miss then memory on repeat call", async () => {
    const svc = makeService();
    const first = await handleGetBundle(
      { language: "en", reference: "JHN 3:16", requestId: "req-1" },
      svc,
    );
    const second = await handleGetBundle(
      { language: "en", reference: "JHN 3:16", requestId: "req-2" },
      svc,
    );
    expect(first.metadata.cacheStatus).toBe("miss");
    expect(second.metadata.cacheStatus).toBe("memory");
  });

  it("rag_query: returns correct shape", async () => {
    const svc = makeService();
    const response = await handleRagQuery(
      { query: "love", language: "en" },
      svc,
    );
    expect(response.isError).toBe(false);
    expect(response.metadata).toMatchObject({ tool: "rag_query" });
    const result = JSON.parse(
      (response.content as Array<{ text: string }>)[0]!.text,
    );
    expect(result.documents).toBeInstanceOf(Array);
    expect(result.fallbackMode).toMatch(/^(ann|lexical|empty)$/);
  });

  it("rag_query: propagates requestId", async () => {
    const svc = makeService();
    const response = await handleRagQuery(
      { query: "faith", language: "en", requestId: "my-req" },
      svc,
    );
    expect(response.metadata.requestId).toBe("my-req");
  });
});
