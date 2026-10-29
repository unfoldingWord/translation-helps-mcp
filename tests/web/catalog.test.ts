import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { buildMcpManifest } from "../../src/mcp/manifest.js";
import { TOOL_GROUPS, buildToolCatalog } from "../../web/src/lib/catalog";

const manifest = buildMcpManifest({ mcpEndpoint: "/v2/mcp" });

const EXPECTED: Record<string, string[]> = {
  discovery: ["list_languages", "list_resources", "search_articles"],
  passage: [
    "get_passage",
    "get_passage_context",
    "get_passage_index",
    "get_questions",
  ],
  articles: ["get_note", "get_academy_article", "get_word_article"],
  obs: [
    "get_obs_story",
    "get_obs_notes",
    "get_obs_index",
    "get_obs_questions",
    "get_obs_study_notes",
    "get_obs_study_questions",
  ],
};

describe("buildToolCatalog", () => {
  const docs = buildToolCatalog(manifest);

  it("documents every registered tool exactly once", () => {
    const names = docs.map((d) => d.name);
    expect([...names].sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts each tool in its group, in the order of the groups", () => {
    expect(TOOL_GROUPS.map((g) => g.id)).toEqual([
      "discovery",
      "passage",
      "articles",
      "obs",
    ]);
    for (const [group, names] of Object.entries(EXPECTED)) {
      expect(
        docs.filter((d) => d.group === group).map((d) => d.name),
        group,
      ).toEqual(names);
    }
    const order = TOOL_GROUPS.map((g) => g.id as string);
    const groups = docs.map((d) => order.indexOf(d.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    for (const d of docs) expect(order).toContain(d.group);
  });

  it("gives each tool a title, a description and a parameter list", () => {
    for (const d of docs) {
      expect(d.title.length, d.name).toBeGreaterThan(3);
      expect(d.description.length, d.name).toBeGreaterThan(10);
      expect(d.inputSchema.type, d.name).toBe("object");
      const keys = Object.keys(
        (d.inputSchema.properties ?? {}) as Record<string, unknown>,
      );
      expect(d.params.map((p) => p.name)).toEqual(keys);
    }
    const note = docs.find((d) => d.name === "get_note")!;
    expect(note.params.find((p) => p.name === "reference")!.required).toBe(
      true,
    );
    expect(note.params.find((p) => p.name === "language")!.required).toBe(
      false,
    );
  });

  it("has an example call that passes the tool's input schema", () => {
    for (const d of docs) {
      const tool = MCP_TOOLS.find((t) => t.name === d.name)!;
      const parsed = tool.inputSchema.safeParse(d.example.args);
      expect(
        parsed.success,
        `${d.name} ${JSON.stringify(d.example.args)}`,
      ).toBe(true);
      expect(d.example.label.length, d.name).toBeGreaterThan(0);
    }
  });

  it("reads the example from the Try presets when one exists", () => {
    const passage = docs.find((d) => d.name === "get_passage")!;
    expect(passage.example.args).toEqual({
      reference: "John 3:16",
      language: "en",
    });
  });
});
