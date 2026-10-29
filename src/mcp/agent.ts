/**
 * TranslationHelpsMCP — the McpAgent Durable Object.
 *
 * All MCP tools are registered in init(). Each tool module in ./tools/
 * exports: inputSchema (Zod), outputSchema (Zod), annotations, and a handler.
 *
 * The registry itself lives in registerServer.ts so the stateless HTTP path
 * registers the same tools, schemas and prompts.
 */

import { McpAgent } from "agents/mcp";
import { VERSION, SERVER_NAME } from "../core/version.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { NormalizingMcpServer } from "./normalizingMcpServer.js";
import { registerTranslationHelpsServer } from "./registerServer.js";

export interface Env {
  MCP_AGENT: DurableObjectNamespace;
  TRANSLATION_HELPS_CACHE: KVNamespace;
  ZIP_FILES: R2Bucket;
  ANALYTICS: AnalyticsEngineDataset;
  /** Cloudflare service binding to the REST Data API worker. */
  API?: Fetcher;
  /** Base URL for the REST Data API worker (local dev when service binding is absent). */
  API_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  /**
   * Optional waitUntil from the request ExecutionContext. When set (chat/agent
   * Workers path, or the stateless MCP handler), background work like prefetch
   * stays alive after the response.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type ToolName = string;

export class TranslationHelpsMCP extends McpAgent<Env> {
  server = new NormalizingMcpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  async init(): Promise<void> {
    registerTranslationHelpsServer(this.server, () => ({
      ...this.env,
      // Expose DO waitUntil so tools (e.g. get_passage prefetch) can
      // schedule background work that survives after the MCP response.
      waitUntil: (promise: Promise<unknown>) => {
        this.ctx.waitUntil(promise);
      },
    }));
  }
}
