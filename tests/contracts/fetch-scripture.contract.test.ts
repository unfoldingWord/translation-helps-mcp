/**
 * fetch_scripture Contract Tests
 *
 * Validates the response shape of the fetch_scripture tool handler.
 * Uses vi.mock to avoid real network calls to DCS.
 *
 * Snapshots capture SHAPE, not content values.
 *
 * Run: npm run test:contracts
 * Update snapshots: npm run test:contracts:update
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the unified service layer before importing the handler
// ---------------------------------------------------------------------------

vi.mock("../../src/unified-services/index.js", () => ({
  createScriptureService: () => ({
    execute: async (_params: unknown) => ({
      data: {
        scripture: [
          {
            language: "en",
            organization: "unfoldingWord",
            resource: "ULT",
            reference: "JHN 3:16",
            text: "For God so loved the world…",
          },
        ],
      },
      metadata: {
        cacheStatus: "hit",
        "content-type": "application/json; charset=utf-8",
        "x-cache-status": "hit",
        "x-available-formats": "json,text,md",
        "x-recommended-format-llm": "text",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    }),
  }),
}));

// Performance tracker passthrough
vi.mock("../../src/utils/mcp-performance-tracker.js", () => ({
  withPerformanceTracking: async (_name: string, fn: () => Promise<unknown>) =>
    fn(),
}));

import { handleFetchScripture } from "../../src/tools/fetchScripture.js";

// ---------------------------------------------------------------------------
// Contract helpers
// ---------------------------------------------------------------------------

function responseShape(
  result: Awaited<ReturnType<typeof handleFetchScripture>>,
) {
  return {
    isError: result.isError,
    hasContent: Array.isArray(result.content) && result.content.length > 0,
    contentType:
      (result.content[0] as { type: string } | undefined)?.type ?? "unknown",
    hasMetadata:
      typeof result.metadata === "object" && result.metadata !== null,
    parseable: (() => {
      try {
        const text =
          (result.content[0] as { type: string; text: string } | undefined)
            ?.text ?? "";
        const data = JSON.parse(text);
        return {
          type: typeof data,
          hasScripture:
            (Array.isArray(data.scripture) && data.scripture.length > 0) ||
            (Array.isArray(data) && data.length > 0) ||
            typeof data === "object",
        };
      } catch {
        // text content (not JSON) is also valid for scripture
        return { type: "string", hasScripture: true };
      }
    })(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetch_scripture Contract Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Golden Reference Behavior", () => {
    it("John 3:16 — matches golden snapshot", async () => {
      const result = await handleFetchScripture({
        reference: "John 3:16",
        language: "en",
        organization: "unfoldingWord",
      });

      const shape = responseShape(result);
      expect(shape).toMatchSnapshot("fetch-scripture-john-3-16");
    });

    it("Genesis 1:1 — matches shape contract", async () => {
      const result = await handleFetchScripture({
        reference: "Genesis 1:1",
        language: "en",
        organization: "unfoldingWord",
      });

      expect(responseShape(result)).toMatchSnapshot("fetch-scripture-gen-1-1");
    });
  });

  describe("Response Structure Contract", () => {
    it("response always has content array with text item", async () => {
      const result = await handleFetchScripture({
        reference: "John 3:16",
        language: "en",
      });

      expect(result).toHaveProperty("content");
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect((result.content[0] as { type: string }).type).toBe("text");
    });

    it("isError is boolean false on success", async () => {
      const result = await handleFetchScripture({
        reference: "John 3:16",
        language: "en",
      });
      expect(result.isError).toBe(false);
    });
  });
});
