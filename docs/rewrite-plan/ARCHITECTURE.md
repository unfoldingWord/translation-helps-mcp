Full Rewrite Architecture

Logical Components

- MCP Core (tool & prompt registry)
  - Tool registry, prompt registry, stdio MCP server adapter, REST shim
- Skill Layer
  - High-level chat primitives: `fetch_passage_with_notes_and_links`, `compose_translation_help`, `rag_query_wrapper`
  - Responsible for orchestration, short-term caching, and generation templates
- RAG Service
  - Vector DB + ANN search, retrieval pipeline, reranker, bundle assembly
- Ingest & Indexer
  - Jobs for extract → parse → chunk → embed → store
- Storage & Cache
  - Short-term memory cache (process), edge cache (Cache API / CDN), KV (Redis), durable R2 for raw files
- Infrastructure & Orchestration
  - Message queue for jobs (Redis/BullMQ), monitoring, tracer

Data Flows

1. Indexing: Ingest fetches ZIPs via `ZipResourceFetcher2`, parses Door43 formats, chunks, embeds, writes embeddings to vector DB and metadata to Redis/R2.
2. Query: MCP/Skill receives a chat request, calls RAG Service with filters; RAG applies metadata filters → ANN → rerank → assemble bundle (fetch authoritative text via `ZipResourceFetcher2` when needed) → Skill constructs generation prompt and calls LLM.
3. Cache: Bundles and chunk text populate memory and edge caches; index events invalidate or warm caches.

Orchestration Patterns

- Coalescing: dedupe concurrent identical queries
- Prefetch/warm: background warmers for high-traffic references
- Idempotency: job ids and `lastIndexedAt` checks

Integration Points

- Keep `src/mcp/*` registry design; extend with `rag_query` and `index_resource` tools
- `ui` REST endpoints map to Skill primitives for non-MCP consumers
- External vector DB used via API; embeddings provider abstracted behind interface

Notes on Cloudflare compatibility

- Keep logic behind environment adapters: `initializeR2Env`, `initializeCacheEnv` to inject bindings for Workers vs Node.
- Vector DB calls remain remote; workers only make HTTP calls to vector DB endpoints.
