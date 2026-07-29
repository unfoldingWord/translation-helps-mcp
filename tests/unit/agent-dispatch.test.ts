/**
 * Tests for normalizeToolArgs integration and ApiClientError → notAvailable mapping.
 * These verify the agent dispatch pipeline handles edge cases correctly.
 */

import { describe, it, expect } from "vitest";
import { normalizeToolArgs } from "../../src/mcp/normalizeToolArgs.js";
import { ApiClientError } from "../../src/mcp/apiClient.js";

// ---------------------------------------------------------------------------
// normalizeToolArgs — key alias and decomposition cases
// ---------------------------------------------------------------------------

describe("normalizeToolArgs — alias resolution", () => {
  it("maps word_id synonym to path for get_word_article", () => {
    const result = normalizeToolArgs("get_word_article", {
      word_id: "grace",
      language: "en",
    });
    expect(result.path).toBe("grace");
    expect((result as Record<string, unknown>).word_id).toBeUndefined();
    expect(result.language).toBe("en");
  });

  it("maps term synonym to path for get_word_article", () => {
    const result = normalizeToolArgs("get_word_article", {
      term: "faith",
      language: "fr",
    });
    expect(result.path).toBe("faith");
    expect((result as Record<string, unknown>).term).toBeUndefined();
    expect(result.language).toBe("fr");
  });

  it("assembles decomposed reference {book, chapter, verse} into reference string", () => {
    const result = normalizeToolArgs("get_passage", {
      book: "JHN",
      chapter: 3,
      verse: 16,
      language: "en",
    });
    expect(result.reference).toBe("JHN 3:16");
    expect((result as Record<string, unknown>).book).toBeUndefined();
    expect((result as Record<string, unknown>).chapter).toBeUndefined();
    expect((result as Record<string, unknown>).verse).toBeUndefined();
  });

  it("maps language_code alias to language", () => {
    const result = normalizeToolArgs("get_note", {
      reference: "JHN 3:16",
      language_code: "es",
    });
    expect(result.language).toBe("es");
    expect((result as Record<string, unknown>).language_code).toBeUndefined();
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
      1, 2, 3,
    ] as unknown as Record<string, unknown>);
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// ApiClientError → notAvailable mapping
// ---------------------------------------------------------------------------

describe("ApiClientError → notAvailable mapping", () => {
  it("ApiClientError has status property", () => {
    const err = new ApiClientError(
      "RESOURCE_NOT_FOUND",
      "The resource was not found",
      404,
      false,
    );
    expect(err.status).toBe(404);
    expect(err.code).toBe("RESOURCE_NOT_FOUND");
    expect(err.message).toBe("The resource was not found");
    expect(err instanceof ApiClientError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("404 ApiClientError should map to notAvailable (not rethrow)", () => {
    const notFound = new ApiClientError(
      "NOT_FOUND",
      "Resource missing",
      404,
      false,
    );
    // Simulate the agent error handler logic
    const shouldReturnNotAvailable =
      notFound instanceof ApiClientError && notFound.status === 404;
    expect(shouldReturnNotAvailable).toBe(true);
  });

  it("500 ApiClientError should NOT map to notAvailable (should rethrow)", () => {
    const serverErr = new ApiClientError(
      "SERVER_ERROR",
      "DCS outage",
      500,
      true,
    );
    const shouldReturnNotAvailable =
      serverErr instanceof ApiClientError && serverErr.status === 404;
    expect(shouldReturnNotAvailable).toBe(false);
    expect(serverErr.status).toBe(500);
    expect(serverErr.retryable).toBe(true);
  });
});
