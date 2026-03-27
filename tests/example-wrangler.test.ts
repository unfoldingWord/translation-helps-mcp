/**
 * Wrangler / Cloudflare Pages dev tests (KV + R2 bindings).
 * Skipped when nothing listens on TEST_BASE_URL (default http://localhost:8787).
 */

import { describe, expect, it } from "vitest";
import { TEST_CONFIG } from "./test-config";

async function wranglerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${TEST_CONFIG.BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function wranglerGet(
  path: string,
  params: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const url = new URL(`${TEST_CONFIG.BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const response = await fetch(url.toString(), {
    headers: { "X-Test-Request": "true", "User-Agent": "Test Suite" },
  });
  const contentType = response.headers.get("content-type");
  const data = contentType?.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, data };
}

describe("Example Wrangler Tests", () => {
  it("should connect to Wrangler dev server", async () => {
    if (!(await wranglerUp())) {
      console.warn(
        `[skip] No Wrangler at ${TEST_CONFIG.BASE_URL} — start: cd ui && npx wrangler pages dev .svelte-kit/cloudflare --port 8787`,
      );
      return;
    }
    const { status, data } = await wranglerGet("/api/health");

    expect(status).toBe(200);
    expect(data.status).toBe("healthy");
    expect(data.deployment.platform).toBe("cloudflare-pages");
  });

  it("should fetch scripture through Wrangler with KV/R2", async () => {
    if (!(await wranglerUp())) return;
    const { status, data } = await wranglerGet("/api/fetch-scripture", {
      reference: "JHN 3:16",
      language: "en",
    });

    expect(status).toBe(200);
    expect(data.scripture).toBeDefined();
    expect(Array.isArray(data.scripture)).toBe(true);
    expect(data.scripture.length).toBeGreaterThan(0);
  });

  it("should fetch translation word links", async () => {
    if (!(await wranglerUp())) return;
    const { status, data } = await wranglerGet(
      "/api/fetch-translation-word-links",
      {
        reference: "JHN 3:16",
        language: "en",
        organization: "unfoldingWord",
      },
    );

    expect(status).toBe(200);
    expect(data.items).toBeDefined();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it("should return 404 for invalid reference", async () => {
    if (!(await wranglerUp())) return;
    const { status, data } = await wranglerGet("/api/fetch-scripture", {
      reference: "NotABook 99:99",
      language: "en",
    });

    expect(status).toBe(404);
    expect(data.error).toBeDefined();
    expect(data.error).toContain("No scripture available");
  });
});
