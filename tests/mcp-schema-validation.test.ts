/**
 * Test: MCP Tools Schema Validation
 * Verifies that tools/list returns complete input schemas (not empty)
 *
 * This test ensures the Zod version alignment fix is working correctly.
 */

import { describe, it, expect } from "vitest";
import { getMCPToolsList } from "../ui/src/lib/mcp/tools-list.js";

describe("MCP Tools Schema Validation", () => {
  it("should return tool definitions with complete input schemas", () => {
    const tools = getMCPToolsList();

    expect(tools).toBeInstanceOf(Array);
    expect(tools.length).toBeGreaterThan(0);

    console.log(`\n✅ Found ${tools.length} tools\n`);
  });

  it("should have non-empty input schemas for all tools", () => {
    const tools = getMCPToolsList();

    for (const tool of tools) {
      console.log(`\nChecking tool: ${tool.name}`);
      console.log(`Description: ${tool.description.substring(0, 60)}...`);

      // Check that inputSchema exists
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.inputSchema).toBe("object");

      // Check that inputSchema has the base JSON Schema structure
      expect(tool.inputSchema).toHaveProperty("$schema");
      expect(tool.inputSchema.$schema).toBe(
        "http://json-schema.org/draft-07/schema#",
      );

      // CRITICAL: Check that inputSchema has properties or is properly defined
      // Empty schemas look like: {"$schema":"http://json-schema.org/draft-07/schema#"}
      const schemaKeys = Object.keys(tool.inputSchema);

      console.log(`  Schema keys: ${schemaKeys.join(", ")}`);

      // A valid schema should have more than just $schema
      expect(schemaKeys.length).toBeGreaterThan(1);

      // Should have 'type' or 'properties' or 'anyOf' etc.
      const hasValidStructure =
        tool.inputSchema.type !== undefined ||
        tool.inputSchema.properties !== undefined ||
        tool.inputSchema.anyOf !== undefined ||
        tool.inputSchema.allOf !== undefined;

      expect(hasValidStructure).toBe(true);

      if (tool.inputSchema.properties) {
        const propCount = Object.keys(tool.inputSchema.properties).length;
        console.log(`  ✅ Has ${propCount} properties`);
        if (propCount === 0 && tool.name === "list_tools") {
          // Meta-tool: intentionally no parameters
          continue;
        }
        expect(propCount).toBeGreaterThan(0);
      } else {
        console.log(
          `  ℹ️  Schema structure: ${JSON.stringify(tool.inputSchema, null, 2).substring(0, 200)}...`,
        );
      }
    }
  });

  it("should NOT have any empty schemas (the bug we fixed)", () => {
    const tools = getMCPToolsList();

    const emptySchemas = tools.filter((tool) => {
      const keys = Object.keys(tool.inputSchema);
      // Empty schema has only $schema key
      return keys.length === 1 && keys[0] === "$schema";
    });

    if (emptySchemas.length > 0) {
      console.error("\n❌ Found tools with empty schemas:");
      emptySchemas.forEach((tool) => {
        console.error(`  - ${tool.name}`);
      });
    }

    expect(emptySchemas).toHaveLength(0);
  });

  it("should have specific expected tools with proper schemas", () => {
    const tools = getMCPToolsList();
    const toolMap = new Map(tools.map((t) => [t.name, t]));

    // Test a few critical tools
    const criticalTools = [
      "fetch_scripture",
      "fetch_translation_notes",
      "fetch_translation_word",
      "list_languages",
      "list_resources_for_language",
    ];

    console.log("\n📋 Validating critical tools:\n");

    for (const toolName of criticalTools) {
      const tool = toolMap.get(toolName);

      expect(tool, `Tool "${toolName}" should exist`).toBeDefined();

      if (tool) {
        console.log(`✅ ${toolName}`);
        console.log(`   Description: ${tool.description.substring(0, 50)}...`);

        // Validate schema is not empty
        const schemaStr = JSON.stringify(tool.inputSchema);
        const isNotEmpty = schemaStr.length > 100; // Empty schema is ~60 chars

        expect(isNotEmpty, `${toolName} should have a non-empty schema`).toBe(
          true,
        );
        console.log(`   Schema size: ${schemaStr.length} characters ✓\n`);
      }
    }
  });

  it("fetch_scripture schema must not include organization (all-org discovery only)", () => {
    const tools = getMCPToolsList();
    const tool = tools.find((t) => t.name === "fetch_scripture");
    expect(tool?.inputSchema?.properties).toBeDefined();
    expect(tool!.inputSchema.properties).not.toHaveProperty("organization");
  });

  it("no MCP tool schema should include organization (all-org discovery only)", () => {
    const tools = getMCPToolsList();
    for (const tool of tools) {
      const props = tool.inputSchema?.properties as
        | Record<string, unknown>
        | undefined;
      if (props) {
        expect(props, tool.name).not.toHaveProperty("organization");
      }
    }
  });

  it("should expose the five OBS tools with story:frame reference schemas (issue #32)", () => {
    const tools = getMCPToolsList();
    const toolMap = new Map(tools.map((t) => [t.name, t]));

    const obsTools = [
      "fetch_obs",
      "fetch_obs_translation_notes",
      "fetch_obs_translation_questions",
      "fetch_obs_study_notes",
      "fetch_obs_study_questions",
    ];

    for (const toolName of obsTools) {
      const tool = toolMap.get(toolName);
      expect(tool, `Tool "${toolName}" should exist`).toBeDefined();

      const props = tool!.inputSchema?.properties as Record<string, any>;
      expect(props, toolName).toBeDefined();

      // Canonical field plus the advertised decomposed fallbacks (story/frame),
      // mirroring the Bible tools' book/chapter/verse tolerance (issue #24).
      expect(props, toolName).toHaveProperty("reference");
      expect(props, toolName).toHaveProperty("story");
      expect(props, toolName).toHaveProperty("frame");
      expect(props.reference.description).toContain("story:frame");

      // OBS descriptions must warn away from Bible references.
      expect(tool!.description).toContain("NOT Bible book chapter:verse");

      // Tolerated extra args must not be blocked (passthrough).
      expect(tool!.inputSchema.additionalProperties, toolName).not.toBe(false);
    }
  });

  it('should have "reference" parameter in scripture/notes/questions tools', () => {
    const tools = getMCPToolsList();
    const toolMap = new Map(tools.map((t) => [t.name, t]));

    const referenceBased = [
      "fetch_scripture",
      "fetch_translation_notes",
      "fetch_translation_questions",
      "fetch_translation_word_links",
    ];

    console.log("\n📖 Checking reference-based tools:\n");

    for (const toolName of referenceBased) {
      const tool = toolMap.get(toolName);
      expect(tool).toBeDefined();

      if (tool?.inputSchema?.properties) {
        expect(tool.inputSchema.properties).toHaveProperty("reference");
        console.log(`✅ ${toolName} has "reference" parameter`);

        const refParam = tool.inputSchema.properties.reference;
        expect(refParam.type).toBe("string");
        expect(refParam.description).toBeDefined();
        console.log(`   Type: ${refParam.type}`);
        console.log(`   Description: ${refParam.description}\n`);
      }
    }
  });
});
