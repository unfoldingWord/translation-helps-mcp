/**
 * rag_query — semantic search over indexed translation resources.
 */

import { z } from "zod";
import {
  referenceParam,
  languageParam,
  ok,
  type ToolModule,
} from "./shared.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(3)
    .describe(
      "Natural language question or search phrase. " +
        'Examples: "How should I translate this idiom?", "What does grace mean?", "figurative language techniques".',
    ),
  reference: referenceParam
    .optional()
    .describe(
      "Optional Bible reference to restrict results to content about a specific passage. " +
        "When provided, the search is scoped to notes and words relevant to that reference.",
    ),
  language: languageParam,
  resourceTypes: z
    .array(z.enum(["tn", "tw", "ta", "tq"]))
    .default(["tn", "tw", "ta"])
    .describe(
      'Which resource types to search: "tn"=Translation Notes, "tw"=Translation Words, ' +
        '"ta"=Translation Academy articles, "tq"=Translation Questions.',
    ),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of results to return (1–20, default 5)."),
  enableRerank: z
    .boolean()
    .default(true)
    .describe(
      "Apply multi-signal reranking to improve result relevance (default true).",
    ),
});

export type RagQueryParams = z.infer<typeof inputSchema>;

export const ragQueryTool: ToolModule<typeof inputSchema> = {
  name: "rag_query",
  description:
    "Semantic search over indexed translation resources (Translation Notes, Words, Academy). " +
    "Use this to find relevant translation guidance for a concept, phrase, or passage. " +
    "Results can be fed to fetch_translation_academy or fetch_translation_word for full articles.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "RAG Query" },

  async handler(params: RagQueryParams, env: Env, requestId: string) {
    // Lazy-load RagService to avoid cold-start overhead when the tool is not called
    const { RagService } = await import("../../core/rag/RagService.js");
    const { CFVectorizeStore } = await import(
      "../../core/rag/CFVectorizeStore.js"
    );
    const { CFKVStore } = await import("../../core/rag/CFKVStore.js");
    const { WorkersAIEmbeddingService } = await import(
      "../../core/rag/providers/WorkersAIEmbeddingService.js"
    );

    const vectorStore = new CFVectorizeStore(env.VECTORIZE_INDEX as any);
    const kvStore = new CFKVStore(env.TRANSLATION_HELPS_CACHE);
    const embeddingService = new WorkersAIEmbeddingService(env.AI);

    const rag = new RagService({ vectorStore, kvStore, embeddingService });

    const results = await rag.query({
      query: params.query,
      topK: params.topK,
      language: params.language ?? "en",
      reference: params.reference,
      resourceType: params.resourceTypes as string[],
    });

    const documents = results.documents ?? [];
    return ok(
      {
        query: params.query,
        language: params.language,
        reference: params.reference,
        results: documents,
        requestId,
      },
      `${documents.length} results for: ${params.query}`,
    );
  },
};
