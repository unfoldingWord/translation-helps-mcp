/**
 * Protocol-level contract test for `tools/list`.
 *
 * The manifest test (`mcp-manifest.contract.test.ts`) covers
 * `buildMcpManifest`, but that is a DIFFERENT serializer from the one MCP
 * clients actually see: `McpServer.registerTool` converts the registered
 * schemas itself. Under zod 4, SDK 1.30 routes through `zod/v4-mini`'s
 * `toJSONSchema`, which omits `additionalProperties` for a plain `z.object` —
 * so `tools/list` silently advertised OPEN objects while the manifest stayed
 * closed (#42 review).
 *
 * This drives a real `McpServer` over an in-memory transport and asserts on
 * the wire response, so the manifest and the protocol cannot diverge again.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { strictToolSchema } from "../../src/mcp/jsonSchema.js";

type WireSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;
};
type WireTool = {
  name: string;
  inputSchema?: WireSchema;
  outputSchema?: WireSchema;
};

let tools: WireTool[];

beforeAll(async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });

  // Mirror the registration in src/mcp/agent.ts init().
  for (const tool of MCP_TOOLS) {
    const shape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: strictToolSchema(shape),
        // Raw shape, exactly as agent.ts passes it: the SDK serializes output
        // with io:"output", which already closes the object.
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      },
      async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    );
  }

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  tools = (await client.listTools()).tools as unknown as WireTool[];
});

describe("tools/list wire contract", () => {
  it("advertises every registered tool", () => {
    expect(tools).toHaveLength(MCP_TOOLS.length);
  });

  it("emits a populated input schema for every tool", () => {
    for (const t of tools) {
      expect(t.inputSchema?.type, `${t.name} inputSchema.type`).toBe("object");
      expect(
        Object.keys(t.inputSchema?.properties ?? {}).length,
        `${t.name} has no input properties`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps input schemas CLOSED (additionalProperties: false)", () => {
    const open = tools
      .filter((t) => t.inputSchema?.additionalProperties !== false)
      .map((t) => t.name);
    expect(open, "these tools advertise open input objects").toEqual([]);
  });

  it("keeps output schemas CLOSED (additionalProperties: false)", () => {
    const open = tools
      .filter(
        (t) => t.outputSchema && t.outputSchema.additionalProperties !== false,
      )
      .map((t) => t.name);
    expect(open, "these tools advertise open output objects").toEqual([]);
  });

  it("does not reject unknown arguments at parse time (#24/#28 tolerance)", () => {
    // `additionalProperties: false` must be an ADVERTISED constraint only.
    // z.strictObject would emit the same keyword but start throwing here.
    const schema = strictToolSchema({ a: z.string() });
    expect(() => schema.parse({ a: "x", unknown_synonym: 1 })).not.toThrow();
  });
});
