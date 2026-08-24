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
import { MCP_TOOLS, TOOL_REGISTRY } from "../../src/mcp/toolRegistry.js";

const ALL_TOOLS = MCP_TOOLS;

function toolByName(name: string) {
  const t = TOOL_REGISTRY[name];
  expect(t).toBeDefined();
  return t;
}

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

      it("has an inputSchema with a .shape", () => {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.shape).toBeDefined();
      });

      it("has annotations with readOnlyHint and title", () => {
        expect(tool.annotations).toBeDefined();
        expect(tool.annotations.readOnlyHint).toBe(true);
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
    const shape = toolByName("get_passage").inputSchema.shape;
    expect(shape.reference).toBeDefined();
    expect(shape.reference instanceof z.ZodOptional).toBe(false);
  });

  it("get_passage_context requires reference", () => {
    const shape = toolByName("get_passage_context").inputSchema.shape;
    expect(shape.reference).toBeDefined();
    expect(shape.reference instanceof z.ZodOptional).toBe(false);
  });

  it("get_passage_index requires reference", () => {
    const shape = toolByName("get_passage_index").inputSchema.shape;
    expect(shape.reference).toBeDefined();
    expect(shape.reference instanceof z.ZodOptional).toBe(false);
  });

  it("search_articles requires query", () => {
    const shape = toolByName("search_articles").inputSchema.shape;
    expect(shape.query).toBeDefined();
    expect(shape.query instanceof z.ZodOptional).toBe(false);
  });

  it("get_academy_article requires path", () => {
    const shape = toolByName("get_academy_article").inputSchema.shape;
    expect(shape.path).toBeDefined();
    expect(shape.path instanceof z.ZodOptional).toBe(false);
  });

  it("get_word_article requires path", () => {
    const shape = toolByName("get_word_article").inputSchema.shape;
    expect(shape.path).toBeDefined();
    expect(shape.path instanceof z.ZodOptional).toBe(false);
  });

  it("list_resources requires language and allows optional book/reference", () => {
    const shape = toolByName("list_resources").inputSchema.shape;
    expect(shape.language).toBeDefined();
    expect(shape.language instanceof z.ZodOptional).toBe(false);
    expect(shape.book).toBeDefined();
    expect(shape.book instanceof z.ZodOptional).toBe(true);
    expect(shape.reference).toBeDefined();
    expect(shape.reference instanceof z.ZodOptional).toBe(true);
  });
});

describe("Workflow tool names follow convention", () => {
  it("passage tools use get_ prefix", () => {
    const passageTools = ALL_TOOLS.filter((t) =>
      [
        "get_passage",
        "get_passage_context",
        "get_passage_index",
        "get_note",
        "get_questions",
      ].includes(t.name),
    );
    expect(passageTools.length).toBe(5);
    for (const t of passageTools) {
      expect(t.name.startsWith("get_")).toBe(true);
    }
  });

  it("article drill tools use get_ prefix", () => {
    expect(toolByName("get_academy_article").name).toBe("get_academy_article");
    expect(toolByName("get_word_article").name).toBe("get_word_article");
  });
});

describe("Language parameter steers away from English default", () => {
  const LANGUAGE_STEER =
    /do not (omit|default to en|use en)|user'?s (requested |resource )?language/i;

  it("shared languageParam description requires user's language", () => {
    const shape = toolByName("get_word_article").inputSchema.shape;
    const desc = (shape.language as z.ZodTypeAny).description ?? "";
    expect(desc).toMatch(LANGUAGE_STEER);
    expect(desc).toMatch(/gateway languages|own TW\/TA|Door43/i);
  });

  for (const name of [
    "get_word_article",
    "get_academy_article",
    "search_articles",
    "list_resources",
  ] as const) {
    it(`${name} description steers language choice`, () => {
      expect(toolByName(name).description).toMatch(LANGUAGE_STEER);
    });
  }
});
