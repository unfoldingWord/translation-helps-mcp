import { describe, expect, it } from "vitest";
import { toJsonSchema } from "../../src/mcp/jsonSchema.js";
import { MCP_TOOLS, TOOL_REGISTRY } from "../../src/mcp/toolRegistry.js";
import {
  PRESETS,
  visiblePresets,
  type Preset,
} from "../../web/src/lib/try/presets.js";
import type { ToolInfo } from "../../web/src/lib/mcp/client.js";

const schemaOf = (tool: string) =>
  toJsonSchema(TOOL_REGISTRY[tool].inputSchema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
const props = (tool: string) => Object.keys(schemaOf(tool).properties ?? {});

/** What tools/list would give, built from the registry. */
const liveTools = (): ToolInfo[] =>
  MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t.inputSchema) as ToolInfo["inputSchema"],
  }));

describe("presets", () => {
  it("only use real tools", () => {
    for (const p of PRESETS)
      expect(TOOL_REGISTRY[p.tool], p.label).toBeDefined();
  });

  it("have at least one example for every tool", () => {
    for (const t of MCP_TOOLS) {
      expect(
        PRESETS.some((p) => p.tool === t.name),
        t.name,
      ).toBe(true);
    }
  });

  it("use only arguments the tool accepts", () => {
    for (const p of PRESETS) {
      for (const key of Object.keys(p.args)) {
        expect(props(p.tool), `${p.label}: ${key}`).toContain(key);
      }
    }
  });

  it("give the required arguments of the tool", () => {
    for (const p of PRESETS) {
      for (const key of schemaOf(p.tool).required ?? []) {
        expect(p.args, `${p.label} needs ${key}`).toHaveProperty(key);
      }
    }
  });

  it("name only parameters that exist in the schema when they need something", () => {
    for (const p of PRESETS) {
      for (const need of p.needs ?? []) {
        expect(props(p.tool), `${p.label}: ${need}`).toContain(need);
      }
    }
  });

  it("include a search of the articles, which replaces /rag", () => {
    expect(PRESETS.some((p) => p.tool === "search_articles")).toBe(true);
  });

  it("keep every example when the live server has everything", () => {
    expect(visiblePresets(liveTools())).toHaveLength(PRESETS.length);
  });

  it("drop an example whose tool the live server lacks", () => {
    const tools = liveTools().filter((t) => t.name !== "search_articles");
    expect(
      visiblePresets(tools).some((p) => p.tool === "search_articles"),
    ).toBe(false);
  });

  it("drop an example whose needs the live schema lacks", () => {
    const withNeeds = PRESETS.find((p) => p.needs?.length) as Preset;
    expect(withNeeds).toBeDefined();
    const tools = liveTools().map((t) => {
      if (t.name !== withNeeds.tool) return t;
      const properties = {
        ...(t.inputSchema.properties as Record<string, unknown>),
      };
      for (const n of withNeeds.needs ?? []) delete properties[n];
      return { ...t, inputSchema: { ...t.inputSchema, properties } };
    });
    expect(visiblePresets(tools)).not.toContain(withNeeds);
  });
});
