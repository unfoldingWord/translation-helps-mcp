/**
 * MCP /api/mcp route tests — Streamable HTTP GET subscription (405), legacy ?method= GET, OPTIONS.
 *
 * Skips when nothing listens on TEST_BASE_URL (default http://localhost:8174), same pattern as
 * tests/example-wrangler.test.ts. Run with dev server: `cd ui && npm run dev`
 */

import { describe, expect, it } from "vitest";
import { makeRequest } from "../test-utils";

const TEST_BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8174";

async function apiServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${TEST_BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe("/api/mcp", () => {
  it("returns 405 for bare GET with Accept: text/event-stream (no passive SSE hang)", async () => {
    if (!(await apiServerUp())) {
      console.warn(
        `[skip] No API at ${TEST_BASE_URL} — start: cd ui && npm run dev`,
      );
      return;
    }
    const response = await makeRequest("/api/mcp", {}, undefined, {
      headers: { Accept: "text/event-stream" },
    });

    expect(response.status).toBe(405);
    const allow = response.headers.allow ?? "";
    expect(allow.toLowerCase()).toContain("post");
    expect(allow.toLowerCase()).toContain("options");
    expect(allow.toLowerCase()).toContain("delete");

    if (Buffer.isBuffer(response.data)) {
      expect(response.data.length).toBe(0);
    } else if (typeof response.data === "string") {
      expect(response.data).toBe("");
    }
  });

  it("returns 200 and tools for legacy GET ?method=tools/list", async () => {
    if (!(await apiServerUp())) return;
    const response = await makeRequest("/api/mcp", { method: "tools/list" });

    expect(response.status).toBe(200);
    // The legacy branch delegates to the POST handler which returns JSON-RPC 2.0
    // format: { jsonrpc, result: { tools: [...] }, id }
    const tools = response.data?.result?.tools ?? response.data?.tools ?? null;
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("returns 200 and prompts for legacy GET ?method=prompts/list", async () => {
    if (!(await apiServerUp())) return;
    const response = await makeRequest("/api/mcp", { method: "prompts/list" });

    expect(response.status).toBe(200);
    expect(response.data.prompts).toBeDefined();
    expect(Array.isArray(response.data.prompts)).toBe(true);
    expect(response.data.prompts.length).toBeGreaterThan(0);
  });

  it("returns 200 for OPTIONS (CORS preflight)", async () => {
    if (!(await apiServerUp())) return;
    const response = await makeRequest("/api/mcp", {}, undefined, {
      method: "OPTIONS",
    });

    expect(response.status).toBe(200);
  });
});
