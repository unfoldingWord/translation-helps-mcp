/**
 * McpServer that normalizes LLM-generated `tools/call` arguments at the
 * transport boundary, before the SDK parses and validates them against the
 * tool's Zod schema.
 *
 * The Agents SDK never routes JSON-RPC through the Durable Object's fetch():
 * messages reach the server via `transport.onmessage` (websocket, SSE, or
 * session restore). Wrapping that callback is the only point that sees every
 * `tools/call` before validation while leaving the registered schemas — and
 * therefore tools/list — untouched.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  isJSONRPCRequest,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../core/logger.js";
import { normalizeToolArgs } from "./normalizeToolArgs.js";

type OnMessage = NonNullable<Transport["onmessage"]>;

/** Handlers installed by NormalizingMcpServer, so connect() never wraps twice. */
const wrappedHandlers = new WeakSet<OnMessage>();

/**
 * Return a copy of a `tools/call` request with its arguments normalized
 * (see normalizeToolArgs). Any other message is returned unchanged.
 * Never throws: on an unexpected shape the original message is passed through.
 */
export function rewriteToolsCallMessage<T extends JSONRPCMessage>(
  message: T,
): T {
  if (!isJSONRPCRequest(message) || message.method !== "tools/call") {
    return message;
  }

  const params = message.params;
  if (!params || typeof params.name !== "string") {
    logger.warn("mcp:normalize_skipped", {
      reason: "tools/call params.name is not a string",
      rpcId: message.id,
    });
    return message;
  }

  try {
    return {
      ...message,
      params: {
        ...params,
        arguments: normalizeToolArgs(params.name, params.arguments),
      },
    };
  } catch (err) {
    logger.warn("mcp:normalize_skipped", {
      tool: params.name,
      rpcId: message.id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return message;
  }
}

export class NormalizingMcpServer extends McpServer {
  override async connect(transport: Transport): Promise<void> {
    await super.connect(transport);

    const original = transport.onmessage;
    if (!original || wrappedHandlers.has(original)) return;

    const wrapped: OnMessage = (message, extra) => {
      original(rewriteToolsCallMessage(message), extra);
    };
    wrappedHandlers.add(wrapped);
    transport.onmessage = wrapped;
  }
}
