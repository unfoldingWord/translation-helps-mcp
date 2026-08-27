import { describe, it, expect } from "vitest";
import {
  assertSafeArticlePath,
  isSafeArticlePath,
  sanitizeArticlePath,
  MAX_ARTICLE_PATH_LENGTH,
} from "../../src/core/articlePath.js";
import { ErrorCode } from "../../src/core/errors.js";

describe("assertSafeArticlePath", () => {
  it("accepts normal TW and TA paths", () => {
    expect(assertSafeArticlePath("bible/kt/god")).toBe("bible/kt/god");
    expect(assertSafeArticlePath("translate/figs-metaphor")).toBe(
      "translate/figs-metaphor",
    );
    expect(assertSafeArticlePath("checking/accuracy-check")).toBe(
      "checking/accuracy-check",
    );
  });

  it("trims whitespace", () => {
    expect(assertSafeArticlePath("  bible/kt/grace  ")).toBe("bible/kt/grace");
  });

  it("rejects path traversal", () => {
    expect(() => assertSafeArticlePath("../etc/passwd")).toThrow(/Invalid/);
    expect(() => assertSafeArticlePath("bible/../kt/god")).toThrow(/Invalid/);
    expect(() => assertSafeArticlePath("bible/kt/../../secret")).toThrow(
      /Invalid/,
    );
  });

  it("rejects absolute paths", () => {
    expect(() => assertSafeArticlePath("/bible/kt/god")).toThrow(/Absolute/);
    expect(() => assertSafeArticlePath("\\bible\\kt\\god")).toThrow(/Invalid/);
    expect(() => assertSafeArticlePath("C:/windows/system")).toThrow(
      /Absolute/,
    );
  });

  it("rejects control characters and empty segments", () => {
    expect(() => assertSafeArticlePath("bible/\x00kt")).toThrow(/control/);
    expect(() => assertSafeArticlePath("bible//god")).toThrow(/Empty/);
    expect(() => assertSafeArticlePath("")).toThrow(/empty/i);
  });

  it("rejects disallowed characters", () => {
    expect(() => assertSafeArticlePath("bible/kt/god script")).toThrow(
      /Invalid/,
    );
    expect(() => assertSafeArticlePath("bible/kt/god;rm")).toThrow(/Invalid/);
    expect(() => assertSafeArticlePath("bible/kt/god?x=1")).toThrow(/Invalid/);
  });

  it("rejects overly long paths", () => {
    const long = `a/${"b".repeat(MAX_ARTICLE_PATH_LENGTH)}`;
    expect(() => assertSafeArticlePath(long)).toThrow(/exceeds/);
  });

  it("decodes percent-encoding then validates", () => {
    expect(assertSafeArticlePath("bible%2Fkt%2Fgod")).toBe("bible/kt/god");
    expect(() => assertSafeArticlePath("%2e%2e%2fetc")).toThrow(/Invalid/);
  });
});

describe("sanitizeArticlePath / isSafeArticlePath", () => {
  it("returns ok for safe paths", () => {
    const r = sanitizeArticlePath("bible/names/paul");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.path).toBe("bible/names/paul");
    expect(isSafeArticlePath("bible/names/paul")).toBe(true);
  });

  it("returns INVALID_PARAMS error for unsafe paths", () => {
    const r = sanitizeArticlePath("../../etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(ErrorCode.INVALID_PARAMS);
    }
    expect(isSafeArticlePath("../../etc/passwd")).toBe(false);
  });
});
