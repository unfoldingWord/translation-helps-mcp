/**
 * Verify that the shared tool registry has no duplicate tool names and includes
 * all expected OBS tools.
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

  it("includes all 9 workflow tools in MCP_TOOLS", () => {
    const names = MCP_TOOLS.map((t) => t.name as string);
    expect(names).toContain("list_languages");
    expect(names).toContain("get_passage");
    expect(names).toContain("get_passage_context");
    expect(names).toContain("get_passage_index");
    expect(names).toContain("get_note");
    expect(names).toContain("get_academy_article");
    expect(names).toContain("get_word_article");
    expect(names).toContain("get_questions");
    expect(names).toContain("search_articles");
  });
});

describe("ALL_TOOLS uniqueness", () => {
  it("has no duplicate tool names in ALL_TOOLS", () => {
    const names = ALL_TOOLS.map((t) => t.name as string);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it("ALL_TOOLS is a superset of MCP_TOOLS", () => {
    const allNames = new Set(ALL_TOOLS.map((t) => t.name as string));
    for (const t of MCP_TOOLS) {
      expect(allNames).toContain(t.name);
    }
  });

  it("includes legacy tools", () => {
    const names = ALL_TOOLS.map((t) => t.name as string);
    expect(names).toContain("fetch_scripture");
    expect(names).toContain("fetch_translation_notes");
    expect(names).toContain("get_bundle");
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

  it("get_obs_story is reachable from TOOL_REGISTRY", () => {
    expect(TOOL_REGISTRY["get_obs_story"]).toBeDefined();
    expect(TOOL_REGISTRY["get_obs_story"].name).toBe("get_obs_story");
  });
});
