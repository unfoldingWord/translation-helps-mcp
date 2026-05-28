/**
 * get_bundle Contract Tests
 *
 * Validates the response shape of handleGetBundle against the canonical schema
 * defined in docs/rewrite-plan/CONTRACTS_DETAILED.md §3.
 *
 * Tests call the handler directly with in-memory services — no HTTP server needed.
 * Snapshots capture SHAPE, not content.
 *
 * Run: npm run test:contracts
 * Update snapshots: npm run test:contracts:update
 */

import { describe, it, expect } from "vitest";
import { handleGetBundle } from "../../src/tools/getBundle.js";
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

function bundleShape(result: Awaited<ReturnType<typeof handleGetBundle>>) {
  const text =
    (result.content[0] as { type: string; text: string } | undefined)?.text ??
    "{}";
  const bundle = JSON.parse(text);

  return {
    isError: result.isError,
    hasContent: Array.isArray(result.content) && result.content.length > 0,
    metadataKeys: result.metadata ? Object.keys(result.metadata).sort() : [],
    bundleKeys: Object.keys(bundle).sort(),
    hasScripture: typeof bundle.scripture === "object",
    hasNotes: Array.isArray(bundle.notes),
    hasTw: Array.isArray(bundle.tw),
    hasTa: Array.isArray(bundle.ta),
    hasMetadata: typeof bundle.metadata === "object",
    metadataShape: bundle.metadata
      ? {
          hasCacheStatus: typeof bundle.metadata.cacheStatus === "string",
          hasLanguage: typeof bundle.metadata.language === "string",
          hasReference: typeof bundle.metadata.reference === "string",
          hasLicense: typeof bundle.metadata.license === "string",
          hasProvenance: Array.isArray(bundle.metadata.provenance),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("get_bundle Contract Tests", () => {
  describe("Response Shape (CONTRACTS_DETAILED.md §3)", () => {
    it("English John 3:16 — matches bundle shape contract", async () => {
      const svc = makeService();
      const result = await handleGetBundle(
        { language: "en", reference: "JHN 3:16" },
        svc,
      );
      expect(bundleShape(result)).toMatchSnapshot("get-bundle-en-jhn-3-16");
    });

    it("with owner/project filters — shape is preserved", async () => {
      const svc = makeService();
      const result = await handleGetBundle(
        {
          language: "en",
          reference: "MAT 5:1",
          owner: "unfoldingWord",
          project: "en_tn",
        },
        svc,
      );
      expect(bundleShape(result)).toMatchSnapshot("get-bundle-with-filters");
    });

    it("force=true bypasses cache — shape unchanged", async () => {
      const svc = makeService();
      const result = await handleGetBundle(
        { language: "en", reference: "GEN 1:1", force: true },
        svc,
      );
      expect(bundleShape(result)).toMatchSnapshot("get-bundle-force");
    });
  });

  describe("Metadata contract", () => {
    it("metadata.cacheStatus is the canonical cache field", async () => {
      const svc = makeService();
      const result = await handleGetBundle(
        { language: "en", reference: "JHN 3:16" },
        svc,
      );
      expect(result.isError).toBe(false);

      // Per CONTRACTS_DETAILED.md §3: metadata.cacheStatus is authoritative
      expect(result.metadata).toHaveProperty("cacheStatus");

      const text =
        (result.content[0] as { type: string; text: string } | undefined)
          ?.text ?? "{}";
      const bundle = JSON.parse(text);
      expect(bundle.metadata).toHaveProperty("cacheStatus");

      const validStatuses = ["memory", "edge", "r2", "miss"];
      expect(validStatuses).toContain(bundle.metadata.cacheStatus);
    });

    it("second call returns from cache (cacheStatus !== miss)", async () => {
      const svc = makeService();
      await handleGetBundle({ language: "en", reference: "JHN 3:16" }, svc);
      const second = await handleGetBundle(
        { language: "en", reference: "JHN 3:16" },
        svc,
      );
      const text =
        (second.content[0] as { type: string; text: string } | undefined)
          ?.text ?? "{}";
      const bundle = JSON.parse(text);
      expect(bundle.metadata.cacheStatus).not.toBe("miss");
    });
  });
});
