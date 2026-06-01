import { describe, it, expect } from "vitest";
import {
  TranslationHelpsError,
  ErrorCode,
  Errors,
  isTranslationHelpsError,
} from "../../src/core/errors.js";

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
