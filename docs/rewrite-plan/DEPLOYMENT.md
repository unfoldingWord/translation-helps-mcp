Rewrite Deployment & Cloudflare MCP Replacement

Goals

- Deploy the new MCP/Skill/RAG stack while ensuring an easy rollback to the current Cloudflare MCP.

Deployment options

- Edge-first: Cloudflare Workers + external Vector DB + Redis (if reachable) + R2
- Hybrid: Edge Workers for read-only bundle serving + central Node services (K8s) for indexer, embedding, and heavy reranking
- Full self-hosted: Node services in K8s with Qdrant and Redis co-located; Workers not used

Recommended plan (Hybrid)

1. Implement code to run in two runtimes (Workers-compatible entrypoints + Node services).
2. Host vector DB (Qdrant) in same region as R2 for latency.
3. Use Redis for metadata/queues; expose a small Worker-facing KV fallback when Redis is unavailable.
4. Use feature flags to route MCP traffic to new endpoints progressively.

Rollout steps

- Stage 0: Deploy RAG service and Skill on staging with staging vector DB and Redis.
- Stage 1: Run indexer backfill for top N languages, warm caches.
- Stage 2: Deploy edge cache endpoints that serve `get_bundle` from Cache API; still call old MCP for tool calls.
- Stage 3: Flip feature flag for selected clients to use new `rag_query`/Skill primitives.
- Stage 4: Full cutover once metrics are stable.

Rollback

- Preserve old MCP deployment and route back via flag/DNS if issues.

Operational checklist

- Metrics dashboards: latency, QPS, cache hit-rate, embedding queue, index job errors
- Alerts: p95 > 1s, error rate > 1%, embedding backlog growth
- Backfill scripts and manual reindex tools available to operators

Secrets / env

- `VECTOR_DB_URL`, `VECTOR_DB_API_KEY`
- `REDIS_URL`, `REDIS_PASSWORD`
- `R2_*` bindings for Cloudflare or S3-like credentials for self-hosted
- `EMBEDDINGS_PROVIDER` credentials
