RAG Implementation Task List

1. Scaffold `RagService` (dev) — implement basic `indexResource`, `query`, `getBundle` stubs and an in-memory vector store for testing.
2. Add MCP tool `rag_query` that calls `RagService.query`.
3. Implement chunking & embedding pipeline (dev with local sentence-transformers or fake embeddings).
4. Wire vector DB (Qdrant) integration and Redis metadata store.
5. Create indexing workers with job queue (BullMQ) and idempotent indexing.
6. Implement reranker and provenance attachments.
7. Implement cache warmers and prefetchers.
8. End-to-end tests and performance benchmarks.

Commands

- `npm run build && node dist/services/rag-server.js` — start dev service
- `node scripts/index-backfill.js --project owner/project` — run indexer for a project

Schedule

- Week 1: tasks 1–3 (scaffold + dev pipeline)
- Week 2: tasks 4–6 (vector DB, rerank, provenance)
- Week 3: tasks 7–8 (warmers, tests, deploy)
  RAG Tasks and Quickstart

Tasks

- [ ] Implement `RagService` scaffold in `src/services/RagService.ts` (dev-mode: in-memory index)
- [ ] Implement MCP tool `rag_query` in `src/mcp/tools` wired to `RagService` (dev).
- [ ] Implement indexing worker (`indexer/indexer.ts`) that uses `ZipResourceFetcher2` and emits `index:updated` events.
- [ ] Provision vector DB (staging), set `VECTOR_DB_URL`.
- [ ] Implement Redis KV usage for presence flags and bundle pointers.
- [ ] Add warm-up scripts for top N languages/references.
- [ ] Add integration tests for `rag_query` responses and provenance fields.

Local quickstart (dev)

1. Install deps

```bash
npm install
```

2. Start a dev rag-server (in-memory index)

```bash
npm run build && node dist/services/rag-server-dev.js
```

3. Run a local index job (small sample)

```bash
node dist/indexer/indexer.js --sample=tests/sample-zip
```

Notes

- Keep `ZipResourceFetcher2` as canonical fetcher for raw files.
- Use the existing caching pattern (memory → Cache API → R2) during retrieval.

If you want, I can now scaffold the `RagService` and `rag_query` MCP tool with a minimal in-memory vector index for development.
