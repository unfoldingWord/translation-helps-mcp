import { describe, it, expect } from "vitest";
import {
  TranslationHelpsError,
  ErrorCode,
  Errors,
  isTranslationHelpsError,
} from "../../src/core/errors.js";
import { notAvailable, ok } from "../../src/mcp/tools/shared.js";

describe("TranslationHelpsError", () => {
  it("creates with correct code and message", () => {
    const err = new TranslationHelpsError({
      code: ErrorCode.INVALID_REFERENCE,
      message: "bad ref",
    });
    expect(err.code).toBe(ErrorCode.INVALID_REFERENCE);
    expect(err.message).toBe("bad ref");
    expect(err.statusCode).toBe(400);
  });

  it("toMcpError returns correct shape", () => {
    const err = new TranslationHelpsError({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: "not found",
      hints: [{ message: "hint1" }],
      retryable: true,
    });
    const mcp = err.toMcpError();
    expect(mcp.code).toBe("RESOURCE_NOT_FOUND");
    expect(mcp.retryable).toBe(true);
    expect(mcp.hints).toHaveLength(1);
  });

  it("isTranslationHelpsError discriminates correctly", () => {
    const err = Errors.invalidReference("bad");
    expect(isTranslationHelpsError(err)).toBe(true);
    expect(isTranslationHelpsError(new Error("plain"))).toBe(false);
  });
});

describe("Errors helpers", () => {
  it("Errors.invalidReference includes hints", () => {
    const e = Errors.invalidReference("xyz");
    expect(e.code).toBe(ErrorCode.INVALID_REFERENCE);
    expect(e.hints.length).toBeGreaterThan(0);
  });

  it("Errors.unauthorized has 401 status", () => {
    const e = Errors.unauthorized();
    expect(e.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: notAvailable helper (upstream #30 contract)
// ---------------------------------------------------------------------------
describe("notAvailable helper", () => {
  it("returns isError: false (not a server failure)", () => {
    const result = notAvailable('Translation Notes for language "fr"');
    expect(result.isError).toBe(false);
  });

  it("returns RESOURCE_NOT_AVAILABLE code in structuredContent", () => {
    const result = notAvailable('Scripture for book "MAT"');
    expect(result.structuredContent).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
    });
  });

  it("includes a human-readable message", () => {
    const result = notAvailable('Translation Questions for language "de"');
    expect(result.structuredContent?.message).toContain(
      "No Translation Questions",
    );
  });

  it("includes hints array pointing to list_resources_for_language", () => {
    const result = notAvailable("anything");
    const hints = (result.structuredContent as { hints: string[] }).hints;
    expect(Array.isArray(hints)).toBe(true);
    expect(hints[0]).toContain("list_resources_for_language");
  });

  it("appends optional extra message when provided", () => {
    const result = notAvailable("Scripture", "Try a different language code.");
    expect(result.structuredContent?.message).toContain(
      "Try a different language code.",
    );
  });

  it("content array is non-empty and contains JSON", () => {
    const result = notAvailable('TW for language "en"');
    expect(result.content.length).toBeGreaterThan(0);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("RESOURCE_NOT_AVAILABLE");
  });
});

describe("ok helper", () => {
  it("returns isError: false", () => {
    const result = ok({ foo: "bar" });
    expect(result.isError).toBe(false);
  });

  it("passes data through to structuredContent", () => {
    const result = ok({ notes: [], count: 0 });
    expect(result.structuredContent).toEqual({ notes: [], count: 0 });
  });

  it("prepends humanText to content when provided", () => {
    const result = ok({ x: 1 }, "3 notes for JHN 3:16");
    expect(result.content[0].text).toBe("3 notes for JHN 3:16");
  });
});
