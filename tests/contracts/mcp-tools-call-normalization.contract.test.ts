/**
 * Protocol-level contract tests for tools/call argument normalization (#44).
 *
 * Drives NormalizingMcpServer over InMemoryTransport (same registration as
 * src/mcp/agent.ts) and asserts handlers receive normalized args. A plain
 * McpServer negative control proves normalization happens on the transport path.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { strictToolSchema } from "../../src/mcp/jsonSchema.js";
import { NormalizingMcpServer } from "../../src/mcp/normalizingMcpServer.js";

type RecordedArgs = Record<string, Record<string, unknown>>;

function registerAllTools(server: McpServer, record: RecordedArgs): void {
  for (const tool of MCP_TOOLS) {
    const shape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: strictToolSchema(shape),
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      },
      async (rawParams: unknown) => {
        record[tool.name] = rawParams as Record<string, unknown>;
        return { content: [{ type: "text" as const, text: "ok" }] };
      },
    );
  }
}

async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("NormalizingMcpServer tools/call normalization", () => {
  let client: Client;
  const recorded: RecordedArgs = {};

  beforeAll(async () => {
    const server = new NormalizingMcpServer({ name: "test", version: "0.0.0" });
    registerAllTools(server, recorded);
    client = await connectClient(server);
  });

  it("maps get_word_article word_id to path (no -32602)", async () => {
    await client.callTool({
      name: "get_word_article",
      arguments: { word_id: "kt/love", language: "en" },
    });
    const args = recorded.get_word_article;
    expect(args?.path).toBe("kt/love");
    expect(args?.word_id).toBeUndefined();
  });

  it("maps get_academy_article article_id to path", async () => {
    await client.callTool({
      name: "get_academy_article",
      arguments: {
        article_id: "translate/figs-abstractnouns",
        language: "en",
      },
    });
    const args = recorded.get_academy_article;
    expect(args?.path).toBe("translate/figs-abstractnouns");
    expect(args?.article_id).toBeUndefined();
  });

  it("assembles get_passage reference from book/chapter/verse", async () => {
    await client.callTool({
      name: "get_passage",
      arguments: { book: "JHN", chapter: 3, verse: 16, language: "en" },
    });
    const args = recorded.get_passage;
    expect(args?.reference).toBe("JHN 3:16");
    expect(args?.book).toBeUndefined();
    expect(args?.chapter).toBeUndefined();
    expect(args?.verse).toBeUndefined();
  });

  it("strips bogus_key while keeping known get_passage fields", async () => {
    await client.callTool({
      name: "get_passage",
      arguments: {
        reference: "JHN 3:16",
        language: "en",
        bogus_key: 1,
      },
    });
    const args = recorded.get_passage;
    expect(args?.reference).toBe("JHN 3:16");
    expect(args?.language).toBe("en");
    expect(args?.bogus_key).toBeUndefined();
  });

  it("coerces null arguments to {} for list_languages", async () => {
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_languages",
          arguments: null,
        },
      },
      CallToolResultSchema,
    );
    const args = recorded.list_languages;
    expect(args).toEqual(
      expect.objectContaining({
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("tools/list still works over the normalizing transport", async () => {
    const result = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    expect(result.tools).toHaveLength(MCP_TOOLS.length);
  });
});

describe("plain McpServer tools/call (negative control)", () => {
  it("rejects get_word_article with only word_id (-32602)", async () => {
    const server = new McpServer({ name: "plain", version: "0.0.0" });
    const recorded: RecordedArgs = {};
    registerAllTools(server, recorded);
    const client = await connectClient(server);

    const result = await client.callTool({
      name: "get_word_article",
      arguments: { word_id: "kt/love", language: "en" },
    });
    expect(result.isError).toBe(true);
    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("-32602");
    expect(recorded.get_word_article).toBeUndefined();
  });
});
