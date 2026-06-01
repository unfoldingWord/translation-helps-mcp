/**
 * Contract tests for MCP tool schemas.
 *
 * Validates that each tool module exports the expected shape:
 * - name (string)
 * - description (string)
 * - inputSchema (Zod object with required parameters)
 * - annotations (readOnlyHint, title)
 * - handler (function)
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// Import all tool modules
import { fetchScriptureTool } from "../../src/mcp/tools/fetchScripture.js";
import { fetchTranslationNotesTool } from "../../src/mcp/tools/fetchTranslationNotes.js";
import { fetchTranslationQuestionsTool } from "../../src/mcp/tools/fetchTranslationQuestions.js";
import { fetchTranslationWordLinksTool } from "../../src/mcp/tools/fetchTranslationWordLinks.js";
import { fetchTranslationWordTool } from "../../src/mcp/tools/fetchTranslationWord.js";
import { fetchTranslationAcademyTool } from "../../src/mcp/tools/fetchTranslationAcademy.js";
import { listLanguagesTool } from "../../src/mcp/tools/listLanguages.js";
import { listSubjectsTool } from "../../src/mcp/tools/listSubjects.js";
import { listResourcesForLanguageTool } from "../../src/mcp/tools/listResourcesForLanguage.js";
import { ragQueryTool } from "../../src/mcp/tools/ragQuery.js";
import { getBundleTool } from "../../src/mcp/tools/getBundle.js";
import { indexResourceTool } from "../../src/mcp/tools/indexResource.js";

const ALL_TOOLS = [
  fetchScriptureTool,
  fetchTranslationNotesTool,
  fetchTranslationQuestionsTool,
  fetchTranslationWordLinksTool,
  fetchTranslationWordTool,
  fetchTranslationAcademyTool,
  listLanguagesTool,
  listSubjectsTool,
  listResourcesForLanguageTool,
  ragQueryTool,
  getBundleTool,
  indexResourceTool,
];

describe("Tool module contracts", () => {
  for (const tool of ALL_TOOLS) {
    describe(tool.name, () => {
      it("has a string name", () => {
        expect(typeof tool.name).toBe("string");
        expect(tool.name.length).toBeGreaterThan(0);
      });

      it("has a description", () => {
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(10);
      });

      it("has a Zod inputSchema", () => {
        // Most schemas are ZodObject; fetch_translation_word uses ZodEffects (refine)
        expect(
          tool.inputSchema instanceof z.ZodObject ||
            tool.inputSchema instanceof z.ZodEffects,
        ).toBe(true);
      });

      it("has annotations with readOnlyHint and title", () => {
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
        expect(typeof tool.annotations.title).toBe("string");
      });

      it("has a handler function", () => {
        expect(typeof tool.handler).toBe("function");
      });
    });
  }
});

describe("Tool name uniqueness", () => {
  it("all tool names are unique", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

describe("Tool annotations", () => {
  it("index_resource is not readOnly", () => {
    expect(indexResourceTool.annotations.readOnlyHint).toBe(false);
  });

  it("all fetch_* tools are readOnly", () => {
    const fetchTools = ALL_TOOLS.filter((t) => t.name.startsWith("fetch_"));
    for (const tool of fetchTools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe("Key param requirements", () => {
  it("fetch_scripture requires reference", () => {
    const shape = fetchScriptureTool.inputSchema.shape;
    expect(shape.reference).toBeDefined();
    // Should be non-optional (not ZodOptional)
    expect(shape.reference instanceof z.ZodOptional).toBe(false);
  });

  it("fetch_translation_word has optional path and term", () => {
    // inputSchema is ZodEffects due to .refine() — access inner schema
    const inner =
      fetchTranslationWordTool.inputSchema instanceof z.ZodEffects
        ? fetchTranslationWordTool.inputSchema.innerType()
        : fetchTranslationWordTool.inputSchema;
    expect(
      inner instanceof z.ZodObject ? inner.shape.path : undefined,
    ).toBeDefined();
    expect(
      inner instanceof z.ZodObject ? inner.shape.term : undefined,
    ).toBeDefined();
  });

  it("index_resource requires adminToken", () => {
    const shape = indexResourceTool.inputSchema.shape;
    expect(shape.adminToken).toBeDefined();
  });
});
