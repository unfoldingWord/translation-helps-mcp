/**
 * index_resource Contract Tests
 *
 * Validates the response shape of handleIndexResource against the canonical schema
 * defined in docs/rewrite-plan/CONTRACTS_DETAILED.md §4.
 *
 * Tests call the handler directly with in-memory services — no HTTP server needed.
 * Snapshots capture SHAPE, not content.
 *
 * Run: npm run test:contracts
 * Update snapshots: npm run test:contracts:update
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleIndexResource } from "../../src/tools/indexResource.js";
import { RagService } from "../../src/services/rag/RagService.js";
import { InMemoryVectorStore } from "../../src/services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../../src/services/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../../src/services/rag/providers/FakeEmbeddingService.js";

// ---------------------------------------------------------------------------
// Shared in-memory service
// ---------------------------------------------------------------------------

function makeService() {
  return new RagService({
    vectorStore: new InMemoryVectorStore(),
    kvStore: new InMemoryKVStore(),
    embeddingService: new FakeEmbeddingService(),
  });
}

// ---------------------------------------------------------------------------
// Contract helpers
// ---------------------------------------------------------------------------

function responseShape(
  result: Awaited<ReturnType<typeof handleIndexResource>>,
) {
  const text =
    (result.content[0] as { type: string; text: string } | undefined)?.text ??
    "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* ignore */
  }

  return {
    isError: result.isError,
    hasContent: Array.isArray(result.content) && result.content.length > 0,
    metadataKeys: result.metadata ? Object.keys(result.metadata).sort() : [],
    responseKeys: Object.keys(parsed).sort(),
    hasTaskId: typeof parsed.taskId === "string",
    hasStatus: typeof parsed.status === "string",
    validStatus: ["queued", "started", "failed"].includes(
      parsed.status as string,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests (run without ADMIN_TOKEN env var set so auth is permissive)
// ---------------------------------------------------------------------------

describe("index_resource Contract Tests", () => {
  let savedToken: string | undefined;

  beforeEach(() => {
    // Ensure ADMIN_TOKEN is unset for permissive mode
    savedToken = process.env["ADMIN_TOKEN"];
    delete process.env["ADMIN_TOKEN"];
  });

  afterEach(() => {
    if (savedToken !== undefined) {
      process.env["ADMIN_TOKEN"] = savedToken;
    } else {
      delete process.env["ADMIN_TOKEN"];
    }
  });

  describe("Response Shape (CONTRACTS_DETAILED.md §4)", () => {
    it("basic enqueue — matches contract shape", async () => {
      const svc = makeService();
      const result = await handleIndexResource(
        { resourceId: "unfoldingWord/en_tn" },
        svc,
      );
      expect(responseShape(result)).toMatchSnapshot("index-resource-basic");
    });

    it("with priority and force — shape is preserved", async () => {
      const svc = makeService();
      const result = await handleIndexResource(
        {
          resourceId: "unfoldingWord/en_tw",
          priority: "high",
          force: true,
          requestId: "test-contract-idx-001",
        },
        svc,
      );
      expect(responseShape(result)).toMatchSnapshot("index-resource-priority");
    });

    it("response always has taskId and status", async () => {
      const svc = makeService();
      const result = await handleIndexResource(
        { resourceId: "unfoldingWord/en_ta" },
        svc,
      );
      expect(result.isError).toBe(false);

      const text =
        (result.content[0] as { type: string; text: string } | undefined)
          ?.text ?? "{}";
      const data = JSON.parse(text);

      expect(typeof data.taskId).toBe("string");
      expect(data.taskId.length).toBeGreaterThan(0);
      expect(["queued", "started", "failed"]).toContain(data.status);
    });
  });

  describe("Admin guard contract", () => {
    it("with ADMIN_TOKEN set, wrong token returns isError=true", async () => {
      process.env["ADMIN_TOKEN"] = "secret-token-123";
      const svc = makeService();
      const result = await handleIndexResource(
        { resourceId: "unfoldingWord/en_tn", adminToken: "wrong-token" },
        svc,
      );
      expect(result.isError).toBe(true);
      // Error response still has content
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
    });

    it("with ADMIN_TOKEN set, correct token succeeds", async () => {
      process.env["ADMIN_TOKEN"] = "secret-token-123";
      const svc = makeService();
      const result = await handleIndexResource(
        {
          resourceId: "unfoldingWord/en_tn",
          adminToken: "secret-token-123",
        },
        svc,
      );
      expect(result.isError).toBe(false);
    });
  });
});
