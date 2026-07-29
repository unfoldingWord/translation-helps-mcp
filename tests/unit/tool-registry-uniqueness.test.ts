/**
 * Verify that the shared tool registry has no duplicate tool names and includes
 * all expected workflow + OBS tools.
 */

import { describe, it, expect } from "vitest";
import {
  MCP_TOOLS,
  ALL_TOOLS,
  TOOL_REGISTRY,
} from "../../src/mcp/toolRegistry.js";

describe("MCP_TOOLS uniqueness", () => {
  it("has no duplicate tool names in MCP_TOOLS", () => {
    const names = MCP_TOOLS.map((t) => t.name as string);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it("includes all 3 OBS tools in MCP_TOOLS", () => {
    const names = MCP_TOOLS.map((t) => t.name as string);
    expect(names).toContain("get_obs_story");
    expect(names).toContain("get_obs_notes");
    expect(names).toContain("get_obs_questions");
  });

  it("includes all workflow tools in MCP_TOOLS", () => {
    const names = MCP_TOOLS.map((t) => t.name as string);
    expect(names).toContain("list_languages");
    expect(names).toContain("list_resources");
    expect(names).toContain("get_passage");
    expect(names).toContain("get_passage_context");
    expect(names).toContain("get_passage_index");
    expect(names).toContain("get_note");
    expect(names).toContain("get_academy_article");
    expect(names).toContain("get_word_article");
    expect(names).toContain("get_questions");
    expect(names).toContain("search_articles");
  });

  it("has exactly 13 tools", () => {
    expect(MCP_TOOLS.length).toBe(13);
  });
});

describe("ALL_TOOLS equals MCP_TOOLS", () => {
  it("has no duplicate tool names in ALL_TOOLS", () => {
    const names = ALL_TOOLS.map((t) => t.name as string);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it("ALL_TOOLS is identical to MCP_TOOLS (legacy retired)", () => {
    expect(ALL_TOOLS).toBe(MCP_TOOLS);
  });
});

describe("TOOL_REGISTRY", () => {
  it("all keys match tool names", () => {
    for (const [key, tool] of Object.entries(TOOL_REGISTRY)) {
      expect(key).toBe((tool as { name: string }).name);
    }
  });

  it("registry size matches ALL_TOOLS length", () => {
    expect(Object.keys(TOOL_REGISTRY).length).toBe(ALL_TOOLS.length);
  });

  it("get_obs_story and list_resources are reachable", () => {
    expect(TOOL_REGISTRY["get_obs_story"]).toBeDefined();
    expect(TOOL_REGISTRY["list_resources"]).toBeDefined();
    expect(TOOL_REGISTRY["list_resources"].name).toBe("list_resources");
  });
});
