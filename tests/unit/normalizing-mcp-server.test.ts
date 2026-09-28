/**
 * Unit tests for rewriteToolsCallMessage — transport-boundary rewriting (#44).
 */

import { describe, it, expect } from "vitest";
import { rewriteToolsCallMessage } from "../../src/mcp/normalizingMcpServer.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

describe("rewriteToolsCallMessage", () => {
  it("returns JSON-RPC responses unchanged", () => {
    const response: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    };
    expect(rewriteToolsCallMessage(response)).toBe(response);
  });

  it("returns JSON-RPC notifications unchanged", () => {
    const notification: JSONRPCMessage = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    expect(rewriteToolsCallMessage(notification)).toBe(notification);
  });

  it("returns tools/call unchanged when params.name is missing", () => {
    const request: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { arguments: { word_id: "love" } },
    };
    expect(rewriteToolsCallMessage(request)).toBe(request);
  });

  it("returns tools/call unchanged when params.name is not a string", () => {
    const request: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: 99, arguments: { word_id: "love" } },
    };
    expect(rewriteToolsCallMessage(request)).toBe(request);
  });

  it("rewrites tools/call with undefined arguments to {}", () => {
    const request: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_passage", arguments: undefined },
    };
    const out = rewriteToolsCallMessage(request);
    expect(out).not.toBe(request);
    if (!("params" in out) || !out.params || typeof out.params !== "object") {
      throw new Error("expected tools/call params object");
    }
    const params = out.params as { arguments?: unknown };
    expect(params.arguments).toEqual({});
  });

  it("rewrites path synonyms on tools/call (get_word_article + word_id)", () => {
    const request: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_word_article",
        arguments: { word_id: "kt/love", language: "en" },
      },
    };
    const out = rewriteToolsCallMessage(request);
    if (!("params" in out) || !out.params || typeof out.params !== "object") {
      throw new Error("expected tools/call params object");
    }
    const params = out.params as {
      arguments?: Record<string, unknown>;
    };
    expect(params.arguments?.path).toBe("kt/love");
    expect(params.arguments?.language).toBe("en");
    expect(params.arguments?.word_id).toBeUndefined();
  });
});
