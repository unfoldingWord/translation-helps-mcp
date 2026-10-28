import { describe, expect, it } from "vitest";
import { toJsonSchema } from "../../src/mcp/jsonSchema.js";
import { TOOL_REGISTRY } from "../../src/mcp/toolRegistry.js";
import {
  argsFromValues,
  fieldsFromSchema,
} from "../../web/src/lib/try/fields.js";
import type { JsonSchema } from "../../web/src/lib/mcp/client.js";

const schemaOf = (tool: string) =>
  toJsonSchema(TOOL_REGISTRY[tool].inputSchema) as JsonSchema;

describe("fieldsFromSchema", () => {
  it("maps get_passage to form fields, required first", () => {
    const fields = fieldsFromSchema(schemaOf("get_passage"));
    const by = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(fields[0].key).toBe("reference");
    expect(by.reference).toMatchObject({ kind: "text", required: true });
    expect(by.language).toMatchObject({
      kind: "text",
      required: false,
      default: "en",
    });
    expect(by.format).toMatchObject({
      kind: "select",
      options: ["text", "usfm"],
      default: "text",
    });
  });

  it("maps numbers with their limits and booleans to a switch", () => {
    const langs = fieldsFromSchema(schemaOf("list_languages"));
    const limit = langs.find((f) => f.key === "limit");
    expect(limit).toMatchObject({
      kind: "number",
      min: 1,
      max: 9999,
      default: 50,
    });
    const index = fieldsFromSchema(schemaOf("get_passage_index"));
    expect(index.find((f) => f.key === "skipNotes")?.kind).toBe("switch");
  });

  it("drops empty optional values and casts numbers", () => {
    const fields = fieldsFromSchema(schemaOf("list_languages"));
    expect(
      argsFromValues(fields, { filter: "", limit: "20", offset: undefined }),
    ).toEqual({ limit: 20 });
  });

  it("keeps false and 0, which are real choices", () => {
    const fields = fieldsFromSchema(schemaOf("get_passage_index"));
    expect(
      argsFromValues(fields, { reference: "TIT 1:1", skipNotes: false }),
    ).toEqual({ reference: "TIT 1:1", skipNotes: false });
    const langs = fieldsFromSchema(schemaOf("list_languages"));
    expect(argsFromValues(langs, { offset: 0 })).toEqual({ offset: 0 });
  });
});
