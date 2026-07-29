/**
 * get_passage_context must surface fetch failures instead of looking like
 * a successful empty result.
 */
import { describe, expect, it } from "vitest";
import { getPassageContextTool } from "../../src/mcp/tools/getPassageContext.js";

describe("get_passage_context error honesty", () => {
  it("includes notesError when the notes API is unreachable", async () => {
    const result = await getPassageContextTool.handler(
      { reference: "TIT 1", language: "es-419" },
      { API_BASE_URL: "http://127.0.0.1:1" } as never,
      "test-unreachable",
    );

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.context).toEqual([]);
    expect(typeof sc.notesError).toBe("string");
    expect(String(sc.notesError).length).toBeGreaterThan(0);
    expect(typeof sc.availabilityError).toBe("string");

    const summary = result.content?.[0]?.text ?? "";
    expect(summary).toMatch(/notes fetch failed/i);
  });

  it("accepts a bare book reference and returns only the book intro (front:intro)", async () => {
    const result = await getPassageContextTool.handler(
      { reference: "TIT", language: "en" },
      { API_BASE_URL: "http://127.0.0.1:8788" } as never,
      "test-book-only",
    );

    const sc = result.structuredContent as Record<string, unknown>;
    if (sc.notesError) {
      // Skip soft: API worker not running in this environment
      expect(sc.context).toEqual([]);
      return;
    }

    const context = sc.context as Array<Record<string, unknown>>;
    expect(context.length).toBeGreaterThan(0);
    expect(context.every((n) => n.scope === "book")).toBe(true);
    expect(sc.scope).toBe("book");
    expect(sc.book).toBe("TIT");
    expect(sc.chapter).toBeUndefined();
  }, 30_000);

  it("returns intro context notes when the API worker is up", async () => {
    const result = await getPassageContextTool.handler(
      { reference: "TIT 1", language: "es-419" },
      { API_BASE_URL: "http://127.0.0.1:8788" } as never,
      "test-api-up",
    );

    const sc = result.structuredContent as Record<string, unknown>;
    if (sc.notesError) {
      // Skip soft: API worker not running in this environment
      expect(sc.context).toEqual([]);
      return;
    }

    const context = sc.context as Array<Record<string, unknown>>;
    expect(context.length).toBeGreaterThan(0);
    expect(context.some((n) => n.scope === "book")).toBe(true);
    expect(sc.notesError).toBeUndefined();
  }, 30_000);
});
