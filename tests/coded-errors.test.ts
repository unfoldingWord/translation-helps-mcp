/**
 * Coded "resource not available" errors (issue #30 / #12)
 *
 * Deterministic unit tests (no live server) that lock in the contract:
 * an unpublished/unavailable resource must surface as a stable
 * RESOURCE_NOT_AVAILABLE / HTTP 404 signal — NOT a generic 500 / server error —
 * and the MCP tool layer must return it as a NORMAL (isError:false) result so
 * downstream consumers don't treat it as a server outage.
 */

import { describe, it, expect } from "vitest";
import {
  resourceNotAvailable,
  makeCodedError,
  RESOURCE_NOT_AVAILABLE,
} from "../src/utils/errorEnvelope.js";
import {
  extractErrorStatus,
  extractErrorCode,
  buildResourceUnavailableResult,
} from "../src/utils/mcp-error-handler.js";
import { BaseService } from "../src/unified-services/BaseService.js";

// Minimal concrete BaseService to exercise the protected handleError().
class TestService extends BaseService {
  name = "test";
  description = "test";
  parameters = [];
  async execute() {
    return this.success({} as any);
  }
  public callHandleError(error: any) {
    return this.handleError(error);
  }
}

describe("resourceNotAvailable factory", () => {
  it("produces an Error carrying code, status 404 and type", () => {
    const err = resourceNotAvailable("Psalms not published");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Psalms not published");
    expect(err.code).toBe(RESOURCE_NOT_AVAILABLE);
    expect(err.status).toBe(404);
    expect(err.type).toBe("NOT_AVAILABLE");
  });

  it("preserves retry-hint extras (languageVariants, requestedLanguage)", () => {
    const err = resourceNotAvailable("No notes for xyz", {
      languageVariants: ["es-419", "es"],
      requestedLanguage: "xyz",
    });
    expect(err.languageVariants).toEqual(["es-419", "es"]);
    expect(err.requestedLanguage).toBe("xyz");
  });

  it("makeCodedError supports arbitrary code/status", () => {
    const err = makeCodedError("nope", { code: "WORD_NOT_FOUND", status: 404 });
    expect(err.code).toBe("WORD_NOT_FOUND");
    expect(err.status).toBe(404);
  });
});

describe("extractErrorStatus / extractErrorCode", () => {
  it("reads status/code off a coded Error instance", () => {
    const err = resourceNotAvailable("x");
    expect(extractErrorStatus(err)).toBe(404);
    expect(extractErrorCode(err)).toBe(RESOURCE_NOT_AVAILABLE);
  });

  it("reads status/code off a plain ServiceError-shaped object", () => {
    const svcErr = { code: "LANGUAGE_NOT_FOUND", message: "no", status: 404 };
    expect(extractErrorStatus(svcErr)).toBe(404);
    expect(extractErrorCode(svcErr)).toBe("LANGUAGE_NOT_FOUND");
  });

  it("ignores out-of-range / missing values", () => {
    expect(extractErrorStatus(new Error("plain"))).toBeUndefined();
    expect(extractErrorCode(new Error("plain"))).toBeUndefined();
    expect(extractErrorStatus({ status: 200 })).toBeUndefined();
  });
});

describe("buildResourceUnavailableResult", () => {
  it("returns a NON-error MCP result for a RESOURCE_NOT_AVAILABLE error", () => {
    const err = resourceNotAvailable("No scripture resources found for en", {
      requestedLanguage: "en",
    });
    const result = buildResourceUnavailableResult(err);
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(false);

    const body = JSON.parse(result!.content![0].text);
    expect(body.available).toBe(false);
    expect(body.code).toBe(RESOURCE_NOT_AVAILABLE);
    expect(body.status).toBe(404);
    expect(body.message).toMatch(/No scripture resources found/);
    expect(body.requestedLanguage).toBe("en");
  });

  it("treats any 404-status error (e.g. LANGUAGE_NOT_FOUND) as not-available", () => {
    const svcErr = {
      code: "LANGUAGE_NOT_FOUND",
      message: "Try es-419",
      status: 404,
      details: { availableVariants: ["es-419"] },
    };
    const result = buildResourceUnavailableResult(svcErr);
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(false);
    const body = JSON.parse(result!.content![0].text);
    expect(body.code).toBe("LANGUAGE_NOT_FOUND");
    // Recovery hints are promoted out of nested `details` to the top level…
    expect(body.availableVariants).toEqual(["es-419"]);
  });

  it("never leaks the raw details blob (no stack / endpoint / params)", () => {
    const svcErr = {
      code: "RESOURCE_NOT_AVAILABLE",
      message: "nope",
      status: 404,
      details: {
        stack: ["Error: nope", "  at foo"],
        endpoint: "fetch-scripture-v2",
        params: { reference: "JHN 3:16" },
        requestedLanguage: "qaa",
      },
    };
    const result = buildResourceUnavailableResult(svcErr);
    const body = JSON.parse(result!.content![0].text);
    expect(body.details).toBeUndefined();
    expect(body.stack).toBeUndefined();
    expect(body.endpoint).toBeUndefined();
    expect(body.params).toBeUndefined();
    // …but allowlisted recovery hints still come through.
    expect(body.requestedLanguage).toBe("qaa");
  });

  it("returns null for a genuine failure (no 404 / not-available code)", () => {
    expect(buildResourceUnavailableResult(new Error("boom"))).toBeNull();
    expect(
      buildResourceUnavailableResult({ code: "INTERNAL_ERROR", status: 500 }),
    ).toBeNull();
  });
});

describe("BaseService.handleError mapping", () => {
  it("maps a RESOURCE_NOT_AVAILABLE error to 404 (never downgrades to 500)", () => {
    const svc = new TestService();
    // Message intentionally lacks the substrings "404"/"not found" — exactly the
    // case that previously fell through to INTERNAL_ERROR/500.
    const err = resourceNotAvailable(
      "No scripture resources found for en with topic=tc-ready",
    );
    const mapped = svc.callHandleError(err);
    expect(mapped.code).toBe(RESOURCE_NOT_AVAILABLE);
    expect(mapped.status).toBe(404);
  });

  it("still maps an unknown error to INTERNAL_ERROR/500", () => {
    const svc = new TestService();
    const mapped = svc.callHandleError(new Error("totally unexpected"));
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(mapped.status).toBe(500);
  });
});
