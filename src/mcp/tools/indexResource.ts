/**
 * index_resource — admin tool to index a resource into the vector store.
 */

import { z } from "zod";
import { languageParam, ok, type ToolModule } from "./shared.js";
import { Errors } from "../../core/errors.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  language: languageParam,
  subject: z
    .string()
    .describe(
      'Resource subject to index, e.g. "Translation Notes" or "Translation Academy".',
    ),
  organization: z
    .string()
    .default("unfoldingWord")
    .describe("Organization on Door43."),
  stage: z
    .enum(["prod", "preprod", "latest"])
    .default("prod")
    .describe("Catalog stage to index from."),
  adminToken: z
    .string()
    .describe("Admin token. Required — this is a write operation."),
});

export type IndexResourceParams = z.infer<typeof inputSchema>;

export const indexResourceTool: ToolModule<typeof inputSchema> = {
  name: "index_resource",
  description:
    "Index a translation resource into the vector store for RAG queries. " +
    "Admin operation — requires adminToken. " +
    "After indexing, rag_query will return results from the indexed resource.",
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    title: "Index Resource (Admin)",
  },

  async handler(params: IndexResourceParams, env: Env, requestId: string) {
    // Verify admin token
    if (!env.ADMIN_TOKEN || params.adminToken !== env.ADMIN_TOKEN) {
      throw Errors.unauthorized();
    }

    const { ResourceIndexer } = await import(
      "../../core/indexer/ResourceIndexer.js"
    );
    const { CFVectorizeStore } = await import(
      "../../core/rag/CFVectorizeStore.js"
    );
    const { WorkersAIEmbeddingService } = await import(
      "../../core/rag/providers/WorkersAIEmbeddingService.js"
    );
    const { ZipResourceFetcher2 } = await import(
      "../../core/resources/ZipResourceFetcher2.js"
    );
    const { getResourceZipUrl } = await import(
      "../../core/resources/dcsClient.js"
    );

    const resolved = await getResourceZipUrl(
      params.language,
      params.subject,
      params.organization,
      params.stage as "prod" | "preprod" | "latest",
    );
    if (!resolved) {
      throw Errors.resourceNotFound(
        `${params.subject} for "${params.language}"`,
      );
    }

    const vectorStore = new CFVectorizeStore(env.VECTORIZE_INDEX as any);
    const embeddingService = new WorkersAIEmbeddingService(env.AI);
    const zipFetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });

    const indexer = new ResourceIndexer({
      vectorStore,
      embeddingService,
      zipFetcher,
    });

    // Map the DCS catalog entry to ResourceIndexer arguments
    const catEntry = resolved.entry;
    const refTag =
      catEntry.catalog?.[params.stage as "prod" | "preprod" | "latest"]
        ?.branch_or_tag_name ??
      catEntry.catalog?.prod?.branch_or_tag_name ??
      "main";

    // Map subject to resource type
    const subjectToType: Record<string, string> = {
      "Aligned Bible": "ult",
      "Simplified Bible": "ust",
      "TSV Translation Notes": "tn",
      "TSV Translation Questions": "tq",
      "Translation Words": "tw",
      "Translation Academy": "ta",
      "TSV Translation Words Links": "twl",
    };
    const resourceType = (subjectToType[params.subject] ?? "ta") as
      | "ult"
      | "ust"
      | "tn"
      | "tq"
      | "tw"
      | "ta"
      | "twl"
      | "glt"
      | "gst";

    const stats = await indexer.indexResource({
      owner: params.organization ?? "unfoldingWord",
      project:
        catEntry.repo ?? params.subject.toLowerCase().replace(/\s+/g, "-"),
      refTag,
      zipballUrl: resolved.zipUrl,
      resourceType,
      language: params.language,
      filePaths: catEntry.ingredients.map((i) => i.path.replace(/^\.\//, "")),
    });

    return ok(
      { language: params.language, subject: params.subject, stats, requestId },
      `Indexed ${stats.chunksIndexed} chunks for ${params.subject} (${params.language})`,
    );
  },
};
