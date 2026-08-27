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
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { listLanguagesTool } from "../../src/mcp/tools/listLanguages.js";
import { listResourcesTool } from "../../src/mcp/tools/listResources.js";

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

describe("all MCP tools declare a validating outputSchema", () => {
  it("registers exactly 13 tools", () => {
    expect(MCP_TOOLS).toHaveLength(13);
  });

  for (const tool of MCP_TOOLS) {
    describe(tool.name, () => {
      it("declares outputSchema", () => {
        expect(tool.outputSchema).toBeDefined();
        expect(typeof tool.outputSchema).toBe("object");
      });

      it("accepts notAvailable() structuredContent", () => {
        const schema = z.object(tool.outputSchema!);
        const result = notAvailable(`${tool.name} fixture`);
        expect(result.isError).toBe(false);
        const parsed = schema.safeParse(result.structuredContent);
        expect(
          parsed.success,
          parsed.success ? undefined : JSON.stringify(parsed.error.format()),
        ).toBe(true);
      });
    });
  }
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

describe("list_resources available union", () => {
  const schema = z.object(listResourcesTool.outputSchema!);

  it("accepts success array available", () => {
    const parsed = schema.safeParse({
      language: "en",
      requestedLanguage: "en",
      available: [
        {
          type: "scripture",
          subject: "Aligned Bible",
          abbreviation: "ult",
          role: "literal",
        },
      ],
      resources: [
        {
          type: "scripture",
          subject: "Aligned Bible",
          abbreviation: "ult",
          role: "literal",
        },
      ],
      requestId: "req_test",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts soft-NA boolean available", () => {
    const parsed = schema.safeParse({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: "No resources",
      hints: ["Run list_resources"],
    });
    expect(parsed.success).toBe(true);
  });
});

/** Representative success fixtures for tools with richer shapes. */
describe("representative success fixtures", () => {
  const byName = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t]));

  function expectOk(toolName: string, payload: unknown) {
    const tool = byName[toolName];
    expect(tool?.outputSchema).toBeDefined();
    const parsed = z.object(tool.outputSchema!).safeParse(payload);
    expect(
      parsed.success,
      parsed.success ? undefined : JSON.stringify(parsed.error.format()),
    ).toBe(true);
  }

  it("get_passage", () => {
    expectOk("get_passage", {
      reference: "TIT 2:12",
      language: "en",
      book: "TIT",
      chapter: "2",
      verse: "12",
      versions: [
        {
          resourceType: "ult",
          role: "literal",
          text: "training us…",
          source: "https://git.door43.org/…",
        },
      ],
      meta: { cache: "kv" },
    });
  });

  it("get_passage_index", () => {
    expectOk("get_passage_index", {
      reference: "TIT 2:12",
      language: "en",
      notes: [],
      words: [],
      issues: [],
      keyTerms: [],
    });
  });

  it("get_academy_article", () => {
    expectOk("get_academy_article", {
      path: "translate/figs-metaphor",
      language: "en",
      article: "# Metaphor\n",
    });
  });

  it("search_articles", () => {
    expectOk("search_articles", {
      query: "metaphor",
      language: "en",
      results: [
        {
          path: "translate/figs-metaphor",
          title: "Metaphor",
          resourceType: "ta",
          score: 12.4,
        },
      ],
    });
  });

  it("get_obs_story", () => {
    expectOk("get_obs_story", {
      reference: "1:1",
      language: "en",
      story: 1,
      title: "The Creation",
      frames: [{ index: 1, imageUrl: null, text: "God made…" }],
      attribution: null,
    });
  });
});
