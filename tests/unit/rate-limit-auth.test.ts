import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  parseRateLimitRpm,
  clientIpFromRequest,
  enforceRateLimit,
  resetRateLimitStoreForTests,
} from "../../src/core/rateLimit.js";
import { enforceOptionalMcpApiKey } from "../../src/core/mcpAuth.js";

describe("parseRateLimitRpm", () => {
  it("defaults to 90", () => {
    expect(parseRateLimitRpm(undefined)).toBe(90);
    expect(parseRateLimitRpm("")).toBe(90);
    expect(parseRateLimitRpm("nope")).toBe(90);
  });

  it("parses valid numbers including 0 (disabled)", () => {
    expect(parseRateLimitRpm("120")).toBe(120);
    expect(parseRateLimitRpm("0")).toBe(0);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  it("allows requests under the limit", () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit("1.2.3.4", { rpm: 5 });
      expect(r.allowed).toBe(true);
    }
  });

  it("blocks when limit is exceeded", () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit("9.9.9.9", { rpm: 3 });
    }
    const blocked = checkRateLimit("9.9.9.9", { rpm: 3 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(blocked.remaining).toBe(0);
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 2; i++) {
      checkRateLimit("a", { rpm: 2 });
    }
    expect(checkRateLimit("a", { rpm: 2 }).allowed).toBe(false);
    expect(checkRateLimit("b", { rpm: 2 }).allowed).toBe(true);
  });

  it("disables when rpm is 0", () => {
    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit("burst", { rpm: 0 }).allowed).toBe(true);
    }
  });
});

describe("clientIpFromRequest / enforceRateLimit", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  it("prefers CF-Connecting-IP", () => {
    const req = new Request("https://example.com/mcp", {
      headers: {
        "CF-Connecting-IP": "203.0.113.10",
        "X-Forwarded-For": "1.1.1.1",
      },
    });
    expect(clientIpFromRequest(req)).toBe("203.0.113.10");
  });

  it("returns 429 Response when exceeded", () => {
    const make = () =>
      new Request("https://example.com/mcp", {
        headers: { "CF-Connecting-IP": "198.51.100.1" },
      });
    for (let i = 0; i < 2; i++) {
      expect(enforceRateLimit(make(), "2")).toBeNull();
    }
    const denied = enforceRateLimit(make(), "2");
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(429);
    expect(denied!.headers.get("Retry-After")).toBeTruthy();
  });

  it("skips when RATE_LIMIT_RPM=0", () => {
    const req = new Request("https://example.com/mcp", {
      headers: { "CF-Connecting-IP": "198.51.100.2" },
    });
    for (let i = 0; i < 20; i++) {
      expect(enforceRateLimit(req, "0")).toBeNull();
    }
  });
});

describe("enforceOptionalMcpApiKey", () => {
  it("allows all traffic when key is unset", () => {
    const req = new Request("https://example.com/mcp");
    expect(enforceOptionalMcpApiKey(req, undefined)).toBeNull();
    expect(enforceOptionalMcpApiKey(req, "")).toBeNull();
  });

  it("rejects missing credentials when key is set", () => {
    const req = new Request("https://example.com/mcp");
    const denied = enforceOptionalMcpApiKey(req, "secret-key");
    expect(denied?.status).toBe(401);
  });

  it("accepts Bearer and X-Api-Key", () => {
    const bearer = new Request("https://example.com/mcp", {
      headers: { Authorization: "Bearer secret-key" },
    });
    expect(enforceOptionalMcpApiKey(bearer, "secret-key")).toBeNull();

    const header = new Request("https://example.com/mcp", {
      headers: { "X-Api-Key": "secret-key" },
    });
    expect(enforceOptionalMcpApiKey(header, "secret-key")).toBeNull();
  });

  it("rejects wrong key", () => {
    const req = new Request("https://example.com/mcp", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(enforceOptionalMcpApiKey(req, "secret-key")?.status).toBe(401);
  });
});
