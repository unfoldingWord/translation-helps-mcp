/**
 * Creates a ServiceContext for local development and unit tests.
 *
 * All providers default to in-process (Fake) implementations:
 *   vectorStore        → InMemoryVectorStore
 *   kvStore            → InMemoryKVStore
 *   embeddingService   → FakeEmbeddingService
 *   llmProvider        → FakeLLMProvider
 *   r2Bucket           → null (USE_FS_CACHE fallback in ZipResourceFetcher2)
 *   cfKv               → null
 *   ai                 → null
 *
 * Override individual fields for integration tests that need real services.
 */

import { InMemoryVectorStore } from "../services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../services/rag/InMemoryKVStore.js";
import { FakeEmbeddingService } from "../services/rag/providers/FakeEmbeddingService.js";
import { FakeLLMProvider } from "../services/rag/providers/FakeLLMProvider.js";
import type { ServiceContext, ServiceEnv } from "../services/rag/interfaces.js";
import type { EmbeddingService } from "../services/rag/providers/EmbeddingService.js";
import type { LLMProvider } from "../services/rag/providers/LLMProvider.js";

export interface DevContext extends ServiceContext {
  embeddingService: EmbeddingService;
  llmProvider: LLMProvider;
}

export function createDevContext(overrides?: Partial<DevContext>): DevContext {
  const env: ServiceEnv = {
    NODE_ENV: "test",
    EMBEDDINGS_PROVIDER: "fake",
    LLM_PROVIDER: "fake",
    VECTOR_DIMENSION: 768,
    ADMIN_TOKEN: process.env["ADMIN_TOKEN"] ?? "dev-admin-token",
    EMBEDDING_DAILY_TOKEN_CAP: 10_000_000,
    LLM_DAILY_REQUEST_CAP: 50_000,
  };

  return {
    vectorStore: new InMemoryVectorStore(),
    kvStore: new InMemoryKVStore(),
    embeddingService: new FakeEmbeddingService(),
    llmProvider: new FakeLLMProvider(),
    r2Bucket: null,
    cfKv: null,
    ai: null,
    env,
    ...overrides,
  };
}
