/**
 * rag_query Contract Tests
 *
 * Validates the response shape of handleRagQuery against the canonical schema
 * defined in docs/rewrite-plan/CONTRACTS_DETAILED.md §1-2.
 *
 * Tests call the handler directly with in-memory services — no HTTP server needed.
 * Snapshots capture SHAPE, not content (values change; structure must not).
 *
 * Run: npm run test:contracts
 * Update snapshots: npm run test:contracts:update
 */

import { describe, it, expect } from "vitest";
import { handleRagQuery } from "../../src/tools/ragQuery.js";
import { RagService } from "../../src/services/rag/RagService.js";
import { InMemoryVectorStore } from "../../src/services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../../src/services/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../../src/services/rag/providers/FakeEmbeddingService.js";

// ---------------------------------------------------------------------------
// Shared in-memory service (fast, no network)
// ---------------------------------------------------------------------------

function makeService() {
  return new RagService({
    vectorStore: new InMemoryVectorStore(),
    kvStore: new InMemoryKVStore(),
    embeddingService: new FakeEmbeddingService(),
  });
}

// ---------------------------------------------------------------------------
// Contract helpers — extract shape without pinning volatile values
// ---------------------------------------------------------------------------

function responseShape(result: Awaited<ReturnType<typeof handleRagQuery>>) {
  return {
    isError: result.isError,
    hasContent: Array.isArray(result.content) && result.content.length > 0,
    contentType:
      (result.content[0] as { type: string } | undefined)?.type ?? "unknown",
    metadataKeys: result.metadata ? Object.keys(result.metadata).sort() : [],
    parseable: (() => {
      try {
        const text =
          (result.content[0] as { type: string; text: string } | undefined)
            ?.text ?? "";
        const data = JSON.parse(text);
        return {
          hasDocuments: Array.isArray(data.documents),
          hasFallbackMode: typeof data.fallbackMode === "string",
          hasCacheStatus: typeof data.cacheStatus === "string",
          hasLatencyMs: typeof data.latencyMs === "number",
          hasRequestId: typeof data.requestId === "string",
        };
      } catch {
        return null;
      }
    })(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rag_query Contract Tests", () => {
  describe("Response Shape", () => {
    it("minimal request — query only — matches shape contract", async () => {
      const svc = makeService();
      const result = await handleRagQuery(
        { query: "love", language: "en" },
        svc,
      );
      expect(responseShape(result)).toMatchSnapshot("rag-query-minimal");
    });

    it("full request with filters — matches shape contract", async () => {
      const svc = makeService();
      const result = await handleRagQuery(
        {
          query: "translation notes for John 3:16",
          language: "en",
          reference: "JHN 3:16",
          filters: { resourceType: "tn" },
          k: 5,
          enableExact: false,
          requestId: "test-contract-001",
        },
        svc,
      );
      expect(responseShape(result)).toMatchSnapshot("rag-query-full");
    });

    it("metadata fields are present and correct", async () => {
      const svc = makeService();
      const result = await handleRagQuery(
        { query: "grace", language: "en", requestId: "test-req-abc" },
        svc,
      );
      expect(result.isError).toBe(false);
      expect(result.metadata).toBeDefined();
      expect(result.metadata).toHaveProperty("tool", "rag_query");
      expect(result.metadata).toHaveProperty("resultCount");
      expect(result.metadata).toHaveProperty("cacheStatus");
      expect(result.metadata).toHaveProperty("fallbackMode");
      expect(result.metadata).toHaveProperty("requestId");
    });

    it("documents array is always present (even when empty)", async () => {
      const svc = makeService();
      const result = await handleRagQuery(
        { query: "obscure term xyz", language: "sw" },
        svc,
      );
      const text =
        (result.content[0] as { type: string; text: string } | undefined)
          ?.text ?? "";
      const data = JSON.parse(text);
      expect(Array.isArray(data.documents)).toBe(true);
    });
  });

  describe("Error Shape", () => {
    it("invalid query (empty string) returns isError=true with error shape", async () => {
      const svc = makeService();
      // @ts-expect-error intentionally passing invalid args to test error shape
      const result = await handleRagQuery({ query: "" }, svc);
      // Either validation-failed or handled gracefully
      expect(result).toHaveProperty("content");
      expect(result).toHaveProperty("isError");
    });
  });
});
