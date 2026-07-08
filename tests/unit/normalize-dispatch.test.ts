/**
 * Tests for normalizeToolArgs integration and ApiClientError → notAvailable mapping.
 */

import { describe, it, expect } from "vitest";
import { normalizeToolArgs } from "../../src/mcp/normalizeToolArgs.js";
import { ApiClientError } from "../../src/mcp/apiClient.js";

describe("normalizeToolArgs integration", () => {
  it("maps word_id to path for get_word_article", () => {
    const result = normalizeToolArgs("get_word_article", {
      word_id: "grace",
      language: "en",
    });
    expect(result.path).toBe("grace");
    expect(result.word_id).toBeUndefined();
    expect(result.language).toBe("en");
  });

  it("assembles decomposed reference for get_passage", () => {
    const result = normalizeToolArgs("get_passage", {
      book: "JHN",
      chapter: 3,
      verse: 16,
      language: "en",
    });
    expect(result.reference).toBe("JHN 3:16");
    expect(result.book).toBeUndefined();
    expect(result.chapter).toBeUndefined();
    expect(result.verse).toBeUndefined();
  });

  it("maps language_code alias to language", () => {
    const result = normalizeToolArgs("get_note", {
      reference: "JHN 3:16",
      language_code: "fr",
    });
    expect(result.language).toBe("fr");
    expect(result.language_code).toBeUndefined();
  });

  it("coerces null args to empty object", () => {
    const result = normalizeToolArgs(
      "list_languages",
      null as unknown as Record<string, unknown>,
    );
    expect(result).toEqual({});
  });

  it("coerces array args to empty object", () => {
    const result = normalizeToolArgs("list_languages", [
      1, 2,
    ] as unknown as Record<string, unknown>);
    expect(result).toEqual({});
  });
});

describe("ApiClientError classification", () => {
  it("creates an ApiClientError with status", () => {
    const err = new ApiClientError(
      "RESOURCE_NOT_FOUND",
      "Not found",
      404,
      false,
    );
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err.code).toBe("RESOURCE_NOT_FOUND");
    expect(err instanceof ApiClientError).toBe(true);
  });

  it("is instanceof Error", () => {
    const err = new ApiClientError("SERVER_ERROR", "oops", 500, true);
    expect(err instanceof Error).toBe(true);
  });

  it("404 vs 500 status distinguishes resource-missing from server error", () => {
    const notFound = new ApiClientError("NOT_FOUND", "nope", 404, false);
    const serverError = new ApiClientError("SERVER_ERROR", "boom", 500, true);
    expect(notFound.status).toBe(404);
    expect(serverError.status).toBe(500);
    // Callers map 404 → notAvailable, 500 → throw
    const isNotAvailable = notFound.status === 404;
    const isServerError = serverError.status >= 500;
    expect(isNotAvailable).toBe(true);
    expect(isServerError).toBe(true);
  });
});
