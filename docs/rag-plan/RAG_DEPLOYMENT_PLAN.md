RAG Deployment Plan — replacing Cloudflare MCP

Goal

- Deploy the Retrieval layer and Skill so they can replace the existing Cloudflare-deployed MCP endpoints with minimal disruption.

Assumptions

- Current deployment uses Cloudflare Workers + R2 + Cache API bindings.
- Vector DB will be external (Qdrant/Pinecone) or self-hosted (container/Kubernetes).

High-level strategy

1. Build the RAG service so it can run in two modes:
   - Worker-compatible (Cloudflare Worker / Pages Functions) for edge HTTP endpoints
   - Node/Container for self-hosted deployment (K8s or VM)
     Use environment abstractions for R2/Cache/Tracer to support both.

2. Vector DB is external and reachable from both modes; do NOT attempt to run vector DB inside Workers.

3. KV / fast store:
   - Use Redis (managed) for fast metadata & presence flags in cloud-hosted deployments.
   - For Cloudflare-only deployments, use Workers KV for longer-lifetime items, and Redis for high-speed metadata (if available). Document tradeoffs.

Steps
A) Prepare runtime compatibility

- Factor `ZipResourceFetcher2` and `R2Storage` initialization behind `initializeR2Env(platformEnv)` so bindings injected at startup.
- Provide a Worker entrypoint that wraps the RAG HTTP handlers and sets `ZIP_FILES` binding and `caches` (Cache API).
- Provide a Node Express/fastify adapter that uses local file fallback (fs) or cloud R2 SDK.

B) Indexing & Vector DB

- Provision vector DB in staging (Qdrant cloud or self-hosted) and set env vars.
- Create an index batch job runner (Dockerized) that uses `ZipResourceFetcher2` to extract and write embeddings to vector DB and metadata to Redis/R2.
- Create migration scripts to backfill existing R2 content.

C) Staged rollout

- Deploy RAG Service behind new `/api/rag/*` endpoints on staging domain.
- Run side-by-side traffic tests: compare latencies vs existing MCP endpoints.
- Pre-warm common `rag:bundle:*` keys by running warm-up worker that hits top languages and references.
- When satisfied, flip routing for MCP endpoints to RAG-enabled handlers via feature flag and then DNS/switch.

D) Monitoring and rollback

- Metrics: p95 latency, cache hit-rate, embedding queue length, vector-db QPS, index job success rate.
- Setup alerting on increased error rate or latency.
- Rollback: switch endpoints back to old MCP by flipping feature flag / routing.

Operational notes

- Batch embeddings should be parallelized but rate-limited for provider costs.
- Keep index jobs idempotent; store `lastIndexedAt` per project in KV to allow incremental reindex.
- Maintain a manual `reindex` admin path for repair.

Env & Secrets (examples)

- `VECTOR_DB_URL`, `VECTOR_DB_KEY`
- `REDIS_URL`, `REDIS_PASSWORD`
- `R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `CF_API_TOKEN` (for R2 access in some modes)
- `EMBEDDING_PROVIDER` (openai|local)

Developer quick-commands (dockerized)

Build and run local indexer:

```bash
docker build -t rag-indexer -f deployments/Dockerfile.indexer .
docker run --env-file .env -v $PWD/cache:/cache rag-indexer index --project=owner/project
```

Start RAG service locally (node):

```bash
npm run build
NODE_ENV=development VECTOR_DB_URL=... REDIS_URL=... node dist/services/rag-server.js
```

Cloudflare deployment notes

- Worker script must NOT host vector DB; only call external vector DB endpoints.
- Provide an edge-friendly bundle cache in Cache API and warm it from the worker startup or via scheduled cron.
- If Redis is not available from Workers, keep critical metadata in Workers KV with explicit TTLs and accept consistency tradeoffs.

Next steps

- Create `docs/rag-plan/RAG_TASKS.md` with exact task list and commands, then scaffold `src/services/RagService.ts` and an MCP tool `rag_query` for dev testing.
