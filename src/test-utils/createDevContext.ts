/**
 * Creates a ServiceContext for local development and unit tests.
 *
 * All providers default to in-process implementations:
 *   vectorStore  → InMemoryVectorStore
 *   kvStore      → InMemoryKVStore
 *   r2Bucket     → null (USE_FS_CACHE fallback in ZipResourceFetcher2)
 *   cfKv         → null
 *   ai           → null (EmbeddingService uses FakeEmbeddingService)
 *
 * In T-07 this is updated to inject Fake providers for embedding/LLM.
 * Override individual fields for integration tests that need real services.
 */

import { InMemoryVectorStore } from "../services/rag/InMemoryVectorStore.js";
import { InMemoryKVStore } from "../services/rag/InMemoryKVStore.js";
import type { ServiceContext, ServiceEnv } from "../services/rag/interfaces.js";

export function createDevContext(
  overrides?: Partial<ServiceContext>,
): ServiceContext {
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
    r2Bucket: null,
    cfKv: null,
    ai: null,
    env,
    ...overrides,
  };
}
