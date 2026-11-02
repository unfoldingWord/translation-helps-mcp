/**
 * /v3/mcp server. Same transport wrapping as v2, with the v3 argument
 * normalizer so th_get_passage and th_get_questions accept Bible and OBS.
 */

import { NormalizingMcpServer } from "../normalizingMcpServer.js";
import { normalizeV3ToolArgs } from "./normalizeArgs.js";

export class V3NormalizingMcpServer extends NormalizingMcpServer {
  protected override normalizeArgs(
    toolName: string,
    rawArgs: unknown,
  ): Record<string, unknown> {
    return normalizeV3ToolArgs(toolName, rawArgs);
  }
}
