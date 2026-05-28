Detailed Specification — What to build and why

Purpose
This document provides the concrete, actionable specification an AI agent or engineer needs to implement the full rewrite: MCP Core, Skill Layer, RAG Service, Indexer, storage, caches, and deployment adapters. It prioritizes precise interfaces, data models, and orchestration rules.

Module boundaries

- `mcp-core` (src/mcp): tool & prompt registry, stdio adapter, REST shim. Tools must be pure functions that accept validated args and a `ServiceContext` and return `MCPToolResponse`.
- `skill` (src/skill): orchestrates calls to `mcp-core` and `rag-service`, performs bundle assembly, and runs generation prompts. Returns structured bundles to clients and exposes REST endpoints mirroring Skill primitives.
- `rag-service` (src/services/rag): exposes `indexResource`, `query`, `getBundle`, and health endpoints. Internally uses `vectorStore`, `kvStore`, and `r2Storage` interfaces.
- `indexer` (src/indexer): job worker that runs indexing pipelines using `ZipResourceFetcher2` for raw reads and writes embeddings to `vectorDB` and parsed artifacts to `R2` and `kvStore`.

Core interfaces

- VectorStore interface
  - `upsert(documents: EmbeddingDoc[])`
  - `query(embedding: number[], topK: number, filters?: Record<string,any>): Promise<QueryResult[]>`
  - `delete(filter)`
  - Choose Qdrant/Pinecone/Weaviate implementation.

- KVStore interface (Redis-backed)
  - `get(key)`, `set(key,value,opts)`, `del(key)`, `publish(channel,msg)`, `subscribe(channel,handler)`
  - Used for presence flags, `rag:bundle` pointers, job coordination, warm flags.

- R2Storage interface (already implemented in `src/functions/r2-storage.ts`)
  - `getFileWithInfo(key, contentType)`, `putFile(key, text, contentType, meta)`, `getZipWithInfo(key)` etc.

Data models & keys

- `doc_id`: `resource:${project}:${path}:chunk:${chunkIndex}`
- `r2Key` for stored extracted files: `owner/project@ref/files/${path}`
- KV keys:
  - `rag:bundle:${language}:${reference}` → JSON bundle
  - `rag:embed:${doc_id}` → small metadata
  - `resourceIndex:${project}` → JSON with file list and lastIndexedAt

Embedding document shape
{
id: string, // doc_id
text: string, // chunk text
embedding?: number[],
metadata: { language, resourceType, subject, path, project, r2Key, ref, chunkIndex, startToken, endToken, license }
}

Chunking rules

- USFM: chunk at verse level when possible; for long passages chunk into 256–512 token windows, overlap 40 tokens.
- TSV: one note per chunk; if note > 512 tokens chunk.
- Markdown: split by headings/paragraphs into 256–512 token chunks, overlap 40 tokens.
- Tokenization: use same tokenizer as embedding provider; default 512 token target.

Indexing idempotency

- Store `lastIndexedAt` per `resource` in KV. Workers should compute diff and only reindex changed files.
- Use `taskId` and dedupe map in Redis to avoid duplicate concurrency.

Error handling & retries

- Indexing jobs: 3 retries with exponential backoff (500ms → 2s → 8s), then mark failed and emit alert.
- RAG queries: soft-fallback to lexical search if vector DB fails.

Tracing & observability

- Each operation has `requestId` and X-Ray-style `tracer` provided in context.
- Emit metrics: `index.duration`, `index.success`, `query.latency`, `vector.latency`, `bundle.serve_latency`, `cache.hit_rate`.

Security & access

- Admin APIs protected by `ADMIN_TOKEN` env var or OAuth. Public APIs rate-limited and authenticated where needed.

Testing & dev modes

- Provide dev-only Node adapter: `RagServiceDev` which stores embeddings in memory and exposes same API. This will be used to implement tests and local iteration.

Next: read `ORCHESTRATION.md` and `DOOR43_INTEGRATION.md` for concrete job flows and resource handling.
