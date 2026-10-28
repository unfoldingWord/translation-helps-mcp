import { describe, expect, it } from "vitest";
import {
  curlFor,
  jsonRpcFor,
  mcpConfigFor,
} from "../../web/src/lib/try/copyAs.js";

describe("copy as", () => {
  it("builds a curl call in two steps: initialize, then tools/call", () => {
    const cmd = curlFor("https://x/v2/mcp", "list_languages", {});
    expect(cmd).toContain("-X POST");
    expect(cmd).toContain("Accept: application/json, text/event-stream");
    expect(cmd).toContain('"name":"list_languages"');
    expect(cmd).toContain("https://x/v2/mcp");
    expect(cmd).toContain('"method":"initialize"');
    expect(cmd).toContain("Mcp-Session-Id");
    // The server keeps each SSE stream open, so both commands need a time limit.
    expect(cmd.match(/--max-time/g)).toHaveLength(2);
    expect(cmd.indexOf('"method":"initialize"')).toBeLessThan(
      cmd.indexOf('"method":"tools/call"'),
    );
  });

  it("quotes arguments with spaces or quotes for the shell", () => {
    const cmd = curlFor("https://x/v2/mcp", "search_articles", {
      query: "God's love",
    });
    expect(cmd).toMatch(/-d '.*God'\\''s love.*'/);
  });

  it("builds the JSON-RPC body of the call", () => {
    const body = JSON.parse(
      jsonRpcFor("get_passage", { reference: "John 3:16", language: "en" }),
    );
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_passage",
        arguments: { reference: "John 3:16", language: "en" },
      },
    });
  });

  it("builds an MCP client config that points at the endpoint", () => {
    const config = JSON.parse(mcpConfigFor("https://x/v2/mcp"));
    expect(config).toEqual({
      mcpServers: { "translation-helps": { url: "https://x/v2/mcp" } },
    });
  });
});
