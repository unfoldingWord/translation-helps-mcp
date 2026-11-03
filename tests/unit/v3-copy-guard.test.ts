/**
 * The text a model reads must not advertise a future feature, a second
 * name for a parameter, or an internal catalog acronym.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { V3_SERVER_INSTRUCTIONS } from "../../src/mcp/v3/instructions.js";
import { toJsonSchema, strictToolSchema } from "../../src/mcp/jsonSchema.js";
import { getArticleV3Tool } from "../../src/mcp/v3/tools/getArticle.js";
import { getNotesV3Tool } from "../../src/mcp/v3/tools/getNotes.js";
import { getPassageV3Tool } from "../../src/mcp/v3/tools/getPassage.js";
import { getPassageIndexV3Tool } from "../../src/mcp/v3/tools/getPassageIndex.js";
import { getQuestionsV3Tool } from "../../src/mcp/v3/tools/getQuestions.js";
import { listResourcesV3Tool } from "../../src/mcp/v3/tools/listResources.js";
import { searchV3Tool } from "../../src/mcp/v3/tools/search.js";

const FORBIDDEN = [/comes later/i, /alias/i, /OBS-SN/i, /OBS-SQ/i, /rollup/i];

const TOOLS = [
  getPassageV3Tool,
  getQuestionsV3Tool,
  listResourcesV3Tool,
  getPassageIndexV3Tool,
  getNotesV3Tool,
  getArticleV3Tool,
  searchV3Tool,
];

function descriptionsIn(schema: unknown, found: string[]): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    for (const item of schema) descriptionsIn(item, found);
    return;
  }
  for (const [key, value] of Object.entries(
    schema as Record<string, unknown>,
  )) {
    if (key === "description" && typeof value === "string") found.push(value);
    else descriptionsIn(value, found);
  }
}

function publishedText(): string[] {
  const texts = [V3_SERVER_INSTRUCTIONS];
  for (const tool of TOOLS) {
    texts.push(tool.description);
    if (tool.annotations.title) texts.push(tool.annotations.title);
    descriptionsIn(
      toJsonSchema(strictToolSchema(tool.inputSchema.shape)),
      texts,
    );
    if (tool.outputSchema) {
      descriptionsIn(toJsonSchema(z.object(tool.outputSchema)), texts);
    }
  }
  return texts;
}

describe("v3 copy guard", () => {
  it("keeps future promises, aliases and internal names out of the text a model reads", () => {
    const texts = publishedText();
    for (const text of texts) {
      for (const pattern of FORBIDDEN) {
        expect(text, text.slice(0, 80)).not.toMatch(pattern);
      }
    }
  });

  it("states the language rule on every tool", () => {
    for (const tool of TOOLS) {
      const schema = toJsonSchema(strictToolSchema(tool.inputSchema.shape)) as {
        properties?: { language?: { description?: string } };
      };
      const language = schema.properties?.language?.description ?? "";
      expect(language, tool.name).toMatch(/do not fall back/i);
    }
  });
});
