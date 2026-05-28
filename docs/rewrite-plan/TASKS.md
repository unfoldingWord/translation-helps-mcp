Rewrite Plan Tasks (prioritized)

Phase 0 — Scaffolding

- [x] Create planning docs (this directory)
- [ ] Scaffold `RagService` (dev, in-memory index)
- [ ] Add MCP tool `rag_query` and `index_resource` (dev)

Phase 1 — Indexing & Storage

- [ ] Implement indexer worker (ZipResourceFetcher2 integration)
- [ ] Chunking/parsing pipelines for USFM/TSV/MD
- [ ] Embeddings pipeline (batch + provider)
- [ ] Vector DB integration (Qdrant)

Phase 2 — Retrieval & Skill

- [ ] Implement RAG retrieval handler (filters + ANN + rerank)
- [ ] Skill primitives and MCP wiring
- [ ] Bundle caching + warmers

Phase 3 — Deployment & Hardening

- [ ] Staging deployment (Hybrid plan)
- [ ] Backfill top languages, warm caches
- [ ] Performance testing and tuning
- [ ] Cutover and rollback plan execution

Phase 4 — Observability & Quality

- [ ] Monitoring dashboards and alerts
- [ ] Grounding QA and human evaluation loops
- [ ] Cost controls and rate limiting

Quick commands

- `npm run build && node dist/services/rag-server-dev.js` — run dev RagService
- `node dist/indexer/indexer.js --project owner/project` — run indexer for a project

If you'd like, I'll now scaffold `src/services/RagService.ts` and a minimal MCP tool `src/mcp/tools/ragQuery.ts` with in-memory vector store for local testing.
