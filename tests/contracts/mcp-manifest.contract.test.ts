/**
 * Contract test for the published MCP manifest's JSON Schema serialization.
 *
 * Exists because of #42: `zod-to-json-schema@3` (a zod-3 library) returns an
 * EMPTY schema — `{ "$schema": "..." }` with no `properties` — for zod 4
 * inputs, without throwing. Typecheck did not catch it (the call site already
 * carried a cast), `schemaOf()` swallows failures into `{ type: "object" }`,
 * and the whole suite stayed green because nothing exercised this path.
 *
 * The failure mode is silent and severe: the manifest would advertise every
 * tool with no input schema, leaving LLMs no argument guidance.
 */
import { describe, it, expect } from "vitest";
import { buildMcpManifest } from "../../src/mcp/manifest.js";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";

type JsonSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  $schema?: string;
};

const manifest = buildMcpManifest({ mcpEndpoint: "/v2/mcp" }) as unknown as {
  tools: {
    name: string;
    inputSchema?: JsonSchema;
    outputSchema?: JsonSchema;
  }[];
};

describe("MCP manifest JSON Schema serialization", () => {
  it("publishes every registered tool", () => {
    expect(manifest.tools).toHaveLength(MCP_TOOLS.length);
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(
      MCP_TOOLS.map((t) => t.name).sort(),
    );
  });

  describe.each(manifest.tools.map((t) => [t.name, t] as const))(
    "%s",
    (_name, tool) => {
      it("emits a non-empty object input schema", () => {
        const s = tool.inputSchema;
        expect(s, "inputSchema missing").toBeDefined();
        expect(s?.type).toBe("object");
        // The #42 regression: a serializer failure yields `properties`
        // undefined or empty while everything else still looks plausible.
        expect(s?.properties, "properties absent").toBeDefined();
        expect(Object.keys(s?.properties ?? {}).length).toBeGreaterThan(0);
      });

      it("keeps object schemas strict", () => {
        // zod 3's generator emitted this; the zod 4 migration restores it
        // explicitly so the published contract did not silently loosen.
        expect(tool.inputSchema?.additionalProperties).toBe(false);
      });

      it("declares the draft-07 dialect", () => {
        expect(tool.inputSchema?.$schema).toBe(
          "http://json-schema.org/draft-07/schema#",
        );
      });
    },
  );

  it("never emits a schema whose only key is $schema", () => {
    const degenerate = manifest.tools
      .filter((t) => Object.keys(t.inputSchema ?? {}).join() === "$schema")
      .map((t) => t.name);
    expect(degenerate).toEqual([]);
  });
});
