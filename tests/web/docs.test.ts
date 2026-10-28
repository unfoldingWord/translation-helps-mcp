import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { RESOURCES } from "../../web/src/lib/resources";
import { WORKFLOW } from "../../web/src/lib/docs/workflow";
import { DOCS_PAGES } from "../../web/src/lib/docs/pages";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** Uppercase words that are not error codes. Any other word of four letters or more must be a real code. */
const NOT_CODES = new Set(["HTTP", "JSON", "REST", "CORS", "USFM", "POST"]);

describe("/docs/limits", () => {
  const page = read("web/src/routes/docs/limits/+page.svelte");

  it("names the default rate limit and the soft-fail code", () => {
    expect(page).toMatch(/\b90\b/);
    expect(page).toMatch(/requests per minute/i);
    expect(page).toContain("RESOURCE_NOT_AVAILABLE");
    expect(page).toContain("isError");
  });

  it("names only error codes the server has", () => {
    const errors = read("src/core/errors.ts");
    // RESOURCE_NOT_AVAILABLE is not in the taxonomy: tools send it as a soft answer (src/mcp/agent.ts).
    const agent = read("src/mcp/agent.ts");
    const known = new Set(
      [...errors.matchAll(/^\s+[A-Z_]{4,}: "([A-Z_]+)"/gm)].map((m) => m[1]),
    );
    expect(known.size).toBeGreaterThan(8);
    expect(agent).toContain('"RESOURCE_NOT_AVAILABLE"');
    known.add("RESOURCE_NOT_AVAILABLE");

    // Imports, comments and the site-name expression are code, not what the page says.
    const text = page
      .replace(/^\s*import .*$/gm, "")
      .replace(/\{SITE\.name\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const named = new Set(text.match(/[A-Z_]{4,}/g) ?? []);
    const unknown = [...named].filter(
      (w) => !known.has(w) && !NOT_CODES.has(w),
    );
    expect(unknown).toEqual([]);
    expect(named.has("RATE_LIMITED")).toBe(true);
  });

  it("agrees with the rate limiter's default", () => {
    expect(read("src/core/rateLimit.ts")).toContain("DEFAULT_RPM = 90");
  });
});

describe("docs pages", () => {
  it("lists the pages in order, each with a route", () => {
    expect(DOCS_PAGES.map((p) => p.href)).toEqual([
      "/docs/resources",
      "/docs/workflow",
      "/docs/api",
      "/docs/sdks",
      "/docs/languages",
      "/docs/limits",
    ]);
    for (const p of DOCS_PAGES) {
      expect(
        () => read(`web/src/routes${p.href}/+page.svelte`),
        p.href,
      ).not.toThrow();
    }
  });
});

describe("the workflow steps", () => {
  it("goes passage, context, index, each help, questions", () => {
    expect(WORKFLOW.map((s) => s.calls[0].tool)).toEqual([
      "get_passage",
      "get_passage_context",
      "get_passage_index",
      "get_note",
      "get_questions",
    ]);
  });

  it("uses real tools with calls their schemas accept", () => {
    for (const step of WORKFLOW) {
      for (const call of step.calls) {
        const tool = MCP_TOOLS.find((t) => t.name === call.tool);
        expect(tool, call.tool).toBeDefined();
        expect(
          tool.inputSchema.safeParse(call.args).success,
          `${call.tool} ${JSON.stringify(call.args)}`,
        ).toBe(true);
      }
    }
  });
});

describe("the resources page", () => {
  it("is built from RESOURCES and names the licence", () => {
    expect(RESOURCES.length).toBe(8);
    const page = read("web/src/routes/docs/resources/+page.svelte");
    expect(page).toContain("RESOURCES");
    expect(page).toContain("LICENCE");
  });
});
