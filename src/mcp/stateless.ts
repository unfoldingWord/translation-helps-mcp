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
 * The SDK v1 server holds one transport. A stateless transport also cannot be
 * reused. So each request gets a new transport, and requests on this isolate
 * run one at a time on a single registered server. Registration (and the zod
 * schema wrap) happens once, not per call.
 *
 * Responses are JSON (`enableJsonResponse`), which is what a stateless
 * JSON-RPC client parses. The spec allows JSON when the client accepts both
 * `application/json` and `text/event-stream`.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SERVER_NAME, VERSION } from "../core/version.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { NormalizingMcpServer } from "./normalizingMcpServer.js";
import { registerTranslationHelpsServer } from "./registerServer.js";
import type { Env } from "./agent.js";

let server: NormalizingMcpServer | undefined;
let activeEnv: Env | undefined;
let tail: Promise<void> = Promise.resolve();

function sharedServer(): NormalizingMcpServer {
  if (!server) {
    server = new NormalizingMcpServer(
      { name: SERVER_NAME, version: VERSION },
      { instructions: SERVER_INSTRUCTIONS },
    );
    registerTranslationHelpsServer(server, () => {
      if (!activeEnv) {
        throw new Error(
          "Stateless MCP tool ran outside a request. One server serves this isolate, and requests are serialized on it.",
        );
      }
      return activeEnv;
    });
  }
  return server;
}

function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(run, run);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function handleStatelessMcpRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  return exclusive(async () => {
    const mcp = sharedServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    activeEnv = env;
    try {
      await mcp.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      activeEnv = undefined;
      await mcp.close().catch(() => {});
    }
  });
}
