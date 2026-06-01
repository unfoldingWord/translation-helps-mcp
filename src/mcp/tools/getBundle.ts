/**
 * get_bundle — retrieve all translation helps for a passage in one call.
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
  reference: referenceParam,
  language: languageParam,
  organization: z
    .string()
    .default("unfoldingWord")
    .describe("Organization on Door43."),
  includeScripture: z
    .boolean()
    .default(true)
    .describe("Include the ULT/UST scripture text."),
  includeNotes: z
    .boolean()
    .default(true)
    .describe("Include translation notes (TN)."),
  includeWords: z
    .boolean()
    .default(true)
    .describe("Include relevant translation words (TW)."),
  includeQuestions: z
    .boolean()
    .default(false)
    .describe("Include comprehension questions (TQ)."),
});

export type GetBundleParams = z.infer<typeof inputSchema>;

export const getBundleTool: ToolModule<typeof inputSchema> = {
  name: "get_bundle",
  description:
    "Get a complete translation help bundle for a Bible passage — scripture text + notes + words, " +
    "all in one call. This is the preferred starting point for comprehensive translation assistance. " +
    "Returns structured data suitable for LLM context or display.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Get Translation Bundle" },

  async handler(params: GetBundleParams, env: Env, requestId: string) {
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

    const bundle = await rag.getBundle({
      reference: params.reference,
      language: params.language,
      owner: params.organization,
    });

    return ok(
      {
        reference: params.reference,
        language: params.language,
        bundle,
        requestId,
      },
      `Bundle for ${params.reference} (${params.language})`,
    );
  },
};
