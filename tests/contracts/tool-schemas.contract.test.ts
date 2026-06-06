/**
 * Contract tests for MCP tool schemas.
 *
 * Validates that each workflow tool module exports the expected shape:
 * - name (string)
 * - description (string)
 * - inputSchema (Zod object with required parameters)
 * - annotations (readOnlyHint, title)
 * - handler (function)
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// New workflow tools — matches ALL_TOOLS in src/mcp/agent.ts
import { listLanguagesTool } from "../../src/mcp/tools/listLanguages.js";
import { getPassageTool } from "../../src/mcp/tools/getPassage.js";
import { getPassageContextTool } from "../../src/mcp/tools/getPassageContext.js";
import { getPassageIndexTool } from "../../src/mcp/tools/getPassageIndex.js";
import { getNoteTool } from "../../src/mcp/tools/getNote.js";
import { getAcademyArticleTool } from "../../src/mcp/tools/getAcademyArticle.js";
import { getWordArticleTool } from "../../src/mcp/tools/getWordArticle.js";
import { getPassageQuestionsTool } from "../../src/mcp/tools/getPassageQuestions.js";
import { searchArticlesWorkflowTool } from "../../src/mcp/tools/searchArticlesWorkflow.js";

const ALL_TOOLS = [
  listLanguagesTool,
  getPassageTool,
  getPassageContextTool,
  getPassageIndexTool,
  getNoteTool,
  getAcademyArticleTool,
  getWordArticleTool,
  getPassageQuestionsTool,
  searchArticlesWorkflowTool,
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

      it("has an outputSchema (ZodRawShape) if defined", () => {
        if (tool.outputSchema !== undefined) {
          expect(typeof tool.outputSchema).toBe("object");
          for (const [key, val] of Object.entries(tool.outputSchema)) {
            expect(
              val instanceof z.ZodType,
              `outputSchema.${key} should be a ZodType`,
            ).toBe(true);
          }
        }
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
  it("all tools are readOnly", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe("Key param requirements", () => {
  it("get_passage requires reference", () => {
    const shape = getPassageTool.inputSchema.shape;
    expect(shape.reference).toBeDefined();
    expect(shape.reference instanceof z.ZodOptional).toBe(false);
  });

  it("get_passage_context requires reference", () => {
    const shape = getPassageContextTool.inputSchema.shape;
    expect(shape.reference).toBeDefined();
    expect(shape.reference instanceof z.ZodOptional).toBe(false);
  });

  it("get_passage_index requires reference", () => {
    const shape = getPassageIndexTool.inputSchema.shape;
    expect(shape.reference).toBeDefined();
    expect(shape.reference instanceof z.ZodOptional).toBe(false);
  });

  it("search_articles requires query", () => {
    const shape = searchArticlesWorkflowTool.inputSchema.shape;
    expect(shape.query).toBeDefined();
    expect(shape.query instanceof z.ZodOptional).toBe(false);
  });

  it("get_academy_article requires path", () => {
    const shape = getAcademyArticleTool.inputSchema.shape;
    expect(shape.path).toBeDefined();
    expect(shape.path instanceof z.ZodOptional).toBe(false);
  });

  it("get_word_article requires path", () => {
    const shape = getWordArticleTool.inputSchema.shape;
    expect(shape.path).toBeDefined();
    expect(shape.path instanceof z.ZodOptional).toBe(false);
  });
});

describe("Workflow tool names follow convention", () => {
  it("passage tools use get_ prefix", () => {
    const passageTools = ALL_TOOLS.filter((t) =>
      ["get_passage", "get_passage_context", "get_passage_index", "get_note", "get_questions"].includes(t.name),
    );
    expect(passageTools.length).toBe(5);
    for (const t of passageTools) {
      expect(t.name.startsWith("get_")).toBe(true);
    }
  });

  it("article drill tools use get_ prefix", () => {
    expect(getAcademyArticleTool.name).toBe("get_academy_article");
    expect(getWordArticleTool.name).toBe("get_word_article");
  });
});
