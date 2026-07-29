/**
 * MCP outputSchema conformance: structuredContent for non-isError results
 * (including RESOURCE_NOT_AVAILABLE) must validate against the declared schema.
 * SDK 1.15+ rejects non-conforming payloads with a protocol error.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  notAvailable,
  withNotAvailableOutput,
} from "../../src/mcp/tools/shared.js";
import { listLanguagesTool } from "../../src/mcp/tools/listLanguages.js";

describe("withNotAvailableOutput", () => {
  it("accepts success payloads", () => {
    const schema = z.object(
      withNotAvailableOutput({
        total_count: z.number().optional(),
        languages: z.array(z.object({ code: z.string() })).optional(),
      }),
    );
    const parsed = schema.safeParse({
      total_count: 2,
      languages: [{ code: "en" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts RESOURCE_NOT_AVAILABLE envelope", () => {
    const schema = z.object(
      withNotAvailableOutput({
        total_count: z.number().optional(),
      }),
    );
    const result = notAvailable("languages");
    const parsed = schema.safeParse(result.structuredContent);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.available).toBe(false);
      expect(parsed.data.code).toBe("RESOURCE_NOT_AVAILABLE");
    }
  });
});

describe("list_languages outputSchema", () => {
  const schema = z.object(listLanguagesTool.outputSchema!);

  it("accepts a success-shaped structuredContent", () => {
    const parsed = schema.safeParse({
      total_count: 56,
      has_more: true,
      limit: 2,
      offset: 0,
      languages: [
        { code: "am", name: "አማርኛ" },
        { code: "apd", name: "لهجة سودانية" },
      ],
      requestId: "req_test",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts notAvailable() structuredContent (latent SDK validation path)", () => {
    const result = notAvailable("languages for this catalog");
    expect(result.isError).toBe(false);
    const parsed = schema.safeParse(result.structuredContent);
    expect(parsed.success).toBe(true);
  });
});
