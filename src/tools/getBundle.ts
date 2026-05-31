/**
 * get_bundle MCP tool handler.
 *
 * Changes from scaffold:
 *   - Uses new RagService from src/services/rag/RagService.ts
 *   - metadata.cacheStatus is bundle.metadata.cacheStatus (per CONTRACTS_DETAILED.md §3)
 *   - Removes old prewarm/includeNotes/includeTW params; adds force, owner, project
 *   - requestId propagation
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import {
  RagService,
  type GetBundleOptions,
} from "../services/rag/RagService.js";
import { InMemoryVectorStore } from "../services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../services/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../services/rag/providers/FakeEmbeddingService.js";

export const GetBundleArgs = z.object({
  language: z.string().min(1),
  reference: z.string().min(1),
  owner: z.string().optional(),
  project: z.string().optional(),
  force: z.boolean().optional(),
  requestId: z.string().optional(),
});

export type GetBundleArgs = z.infer<typeof GetBundleArgs>;

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

export async function handleGetBundle(
  args: GetBundleArgs,
  service?: RagService,
) {
  const startTime = Date.now();
  try {
    logger.info("Getting bundle", {
      language: args.language,
      reference: args.reference,
    });
    const svc = service ?? getDevService();

    const opts: GetBundleOptions = {
      language: args.language,
      reference: args.reference,
      owner: args.owner,
      project: args.project,
      force: args.force,
      requestId: args.requestId,
    };

    const result = await svc.getBundle(opts);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.bundle, null, 2),
        },
      ],
      isError: false,
      metadata: {
        tool: "get_bundle",
        cacheStatus: result.bundle.metadata.cacheStatus,
        latencyMs: result.latencyMs,
        requestId: result.requestId,
      },
    };
  } catch (error) {
    return handleMCPError({
      toolName: "get_bundle",
      args,
      startTime,
      originalError: error,
    });
  }
}
