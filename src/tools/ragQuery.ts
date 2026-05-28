/**
 * rag_query MCP tool handler.
 *
 * Changes from scaffold:
 *   - Uses new RagService from src/services/rag/RagService.ts
 *   - Removes "verbosity" parameter (per CONTRACTS_DETAILED.md §1 NOTE)
 *   - metadata.cacheStatus reflects QueryResult.cacheStatus
 *   - requestId propagation
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { RagService, type QueryOptions } from "../services/rag/RagService.js";
import { InMemoryVectorStore } from "../services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../services/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../services/rag/providers/FakeEmbeddingService.js";

export const RagQueryArgs = z.object({
  query: z.string().min(1),
  language: z.string().optional().default("en"),
  reference: z.string().optional(),
  filters: z
    .object({
      resourceType: z.union([z.string(), z.array(z.string())]).optional(),
      subject: z.array(z.string()).optional(),
      project: z.string().optional(),
      owner: z.string().optional(),
    })
    .optional(),
  k: z.number().int().min(1).max(100).optional().default(10),
  enableExact: z.boolean().optional(),
  requestId: z.string().optional(),
});

export type RagQueryArgs = z.infer<typeof RagQueryArgs>;

/** Lazily initialised per-process dev RagService (replaced by injected context in production). */
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

export async function handleRagQuery(args: RagQueryArgs, service?: RagService) {
  const startTime = Date.now();
  try {
    logger.info("Executing rag_query", {
      query: args.query,
      language: args.language,
    });
    const svc = service ?? getDevService();

    const opts: QueryOptions = {
      query: args.query,
      language: args.language ?? "en",
      reference: args.reference,
      resourceType: args.filters?.resourceType,
      owner: args.filters?.["owner"] as string | undefined,
      project: args.filters?.project,
      topK: args.k ?? 10,
      requestId: args.requestId,
    };

    const response = await svc.query(opts);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
      isError: false,
      metadata: {
        tool: "rag_query",
        resultCount: response.documents.length,
        cacheStatus: response.cacheStatus,
        fallbackMode: response.fallbackMode,
        requestId: response.requestId,
      },
    };
  } catch (error) {
    return handleMCPError({
      toolName: "rag_query",
      args,
      startTime,
      originalError: error,
    });
  }
}
