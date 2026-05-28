/**
 * index_resource MCP tool handler.
 *
 * Changes from scaffold:
 *   - Uses new RagService.indexResource() from src/services/rag/RagService.ts
 *   - Admin guard: requires ADMIN_TOKEN header/env match (SECURITY_AND_LICENSING.md)
 *   - Removes zipPath param (edge-only, no filesystem access in CF Pages)
 *   - requestId propagation
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import {
  RagService,
  type IndexResourceOptions,
} from "../services/rag/RagService.js";
import { InMemoryVectorStore } from "../services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../services/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../services/rag/providers/FakeEmbeddingService.js";
import { RagError } from "../services/rag/errors.js";

export const IndexResourceArgs = z.object({
  resourceId: z
    .string()
    .min(1, "resourceId is required (format: owner/project)"),
  zipUrl: z.string().url().optional(),
  force: z.boolean().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  requestId: z.string().optional(),
  /**
   * Admin token for authorization.
   * In production, must match ADMIN_TOKEN env var.
   * In dev (ADMIN_TOKEN unset), any value is accepted.
   */
  adminToken: z.string().optional(),
});

export type IndexResourceArgs = z.infer<typeof IndexResourceArgs>;

/** Lazily initialised per-process dev RagService. */
let _devService: RagService | null = null;
function getDevService(): RagService {
  if (!_devService) {
    _devService = new RagService({
      vectorStore: new InMemoryVectorStore(),
      kvStore: new InMemoryKVStore(),
      embeddingService: new FakeEmbeddingService(),
    });
  }
  return _devService;
}

export async function handleIndexResource(
  args: IndexResourceArgs,
  service?: RagService,
) {
  const startTime = Date.now();
  try {
    // Admin guard
    const adminToken = process.env["ADMIN_TOKEN"];
    if (adminToken && args.adminToken !== adminToken) {
      throw new RagError(
        "UNAUTHORIZED",
        "ADMIN_TOKEN required for index_resource",
        {
          context: { requestId: args.requestId },
        },
      );
    }

    logger.info("Enqueuing index resource", { resourceId: args.resourceId });
    const svc = service ?? getDevService();

    const opts: IndexResourceOptions = {
      resourceId: args.resourceId,
      zipUrl: args.zipUrl,
      force: args.force,
      priority: args.priority,
      requestId: args.requestId,
    };

    const response = await svc.indexResource(opts);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
      isError: false,
      metadata: {
        tool: "index_resource",
        taskId: response.taskId,
        status: response.status,
      },
    };
  } catch (error) {
    return handleMCPError({
      toolName: "index_resource",
      args,
      startTime,
      originalError: error,
    });
  }
}
