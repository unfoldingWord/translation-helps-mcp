/**
 * Stateless Streamable HTTP for clients that do not send Mcp-Session-Id.
 *
 * Uses the MCP SDK 1.30 WebStandardStreamableHTTPServerTransport with
 * `sessionIdGenerator: undefined`, on the same NormalizingMcpServer the
 * Durable Object registers. agents' `createMcpHandler` is not used: its
 * stateless path wants an SDK v2 server (`@modelcontextprotocol/server`), and
 * passing this SDK v1 server falls through to the deprecated sessionful
 * `createLegacyMcpHandler`.
 *
 * The SDK v1 server holds one transport, and a stateless transport cannot be
 * reused. A single shared server would make unrelated calls on this isolate
 * wait for each other, so each request gets its own server. Strict Zod schemas
 * and the JSON Schema `tools/list` payload are built once per isolate in
 * `registerTranslationHelpsServer` and reused.
 *
 * Responses are JSON (`enableJsonResponse`), which is what a stateless
 * JSON-RPC client parses. The transport rejects a POST unless Accept lists
 * both `application/json` and `text/event-stream`. v1, curl, and the README
 * often send only `application/json`, or no Accept at all, so those headers
 * are filled in before the transport sees the request.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SERVER_NAME, VERSION } from "../core/version.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { NormalizingMcpServer } from "./normalizingMcpServer.js";
import { registerTranslationHelpsServer } from "./registerServer.js";
import type { Env } from "./agent.js";

const JSON_AND_EVENT_STREAM = "application/json, text/event-stream";

/** One server for this request. Registration reuses the isolate's schema cache. */
export function openStatelessServer(env: Env): NormalizingMcpServer {
  const server = new NormalizingMcpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTranslationHelpsServer(server, () => env);
  return server;
}

/**
 * The transport answers 406 unless Accept lists both JSON and event-stream.
 * Fill that in when the client omitted either, and leave a complete header
 * alone so the body is not copied.
 */
function withStreamableAccept(request: Request): Request {
  const accept = request.headers.get("accept");
  if (
    accept?.includes("application/json") &&
    accept.includes("text/event-stream")
  ) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set("accept", JSON_AND_EVENT_STREAM);
  return new Request(request, { headers });
}

export function handleStatelessMcpRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const mcp = openStatelessServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  return finishStatelessRequest(mcp, transport, withStreamableAccept(request));
}

async function finishStatelessRequest(
  mcp: NormalizingMcpServer,
  transport: WebStandardStreamableHTTPServerTransport,
  request: Request,
): Promise<Response> {
  try {
    await mcp.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await mcp.close().catch(() => {});
  }
}
