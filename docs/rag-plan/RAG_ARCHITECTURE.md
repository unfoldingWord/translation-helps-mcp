RAG Architecture for translation-helps-mcp

Purpose

- Capture the recommended Retrieval-Augmented Generation (RAG) architecture tailored to Door43 resources (USFM, TSV, Markdown) and chat-first workloads.

Three-layer overview

1. Ingest / Indexing (offline)

- Source: Door43 ZIPs (DCS), raw files in R2, or git archives.
- Steps: extract → normalize → parse (USFM → verses, TSV → rows, MD → article + metadata) → chunk → embed → store.
- Stores:
  - Vector DB: embeddings + chunk metadata (Qdrant/Weaviate/Pinecone/Milvus)
  - KV (Redis): small parsed items, index pointers, bundle presence flags
  - R2 (durable): raw files + parsed artifacts + archived bundles
- Emits: index events on Redis/pubsub or queue for cache invalidation / warm-up.

2. Retrieval / RAG Service (online)

- Responsibilities: accept queries, apply strict metadata filters, run ANN search, rerank results, assemble bundles (scripture, notes, TW/TA references), provide provenance and cache indicators.
- Inputs: Vector DB + KV + R2 via `ZipResourceFetcher2` + `R2Storage`.
- API: `rag_query`, `getBundle`, `indexResource` (admin).

3. Orchestration / Skill / MCP (API layer)

- High-level primitives for chat creators: `fetch_passage_with_notes_and_links`, `rag_query`, `get_bundle`.
- Uses RAG Service for semantic retrieval and `ZipResourceFetcher2` for authoritative content and long excerpts.
- Returns structured bundles with `metadata` and `provenance` to the chat generator.

Communication patterns

- Ingest writes embeddings + metadata and signals `index:updated` events.
- Retrieval subscribes to index events, invalidates bundles and memory caches, optionally triggers warm-up.
- Orchestration calls Retrieval (HTTP/gRPC/MCP) and performs exact fetches to R2 for final assembly.

Caching

- Multi-tier caches (preserve existing pattern):
  1. Memory cache: hot chunks/bundles (sub-ms).
  2. Edge / Cache API: parsed bundles, small JSON (5–60m TTL).
  3. KV (Redis): embedding presence flags, index pointers, warm flags (long TTL or manual invalidation).
  4. R2: raw files and large artifacts (durable).
- Cache keys examples:
  - `scripture:${language}:${reference}:${format}`
  - `rag:embed:${r2Key}:${chunkIndex}`
  - `rag:bundle:${language}:${reference}`

Indexing specifics for Door43

- Normalize `externalReference` and `rc://` links into canonical paths.
- Index both raw text and parsed objects (TSV rows, markdown metadata).
- Store chunk backrefs so answers can point to exact file+offset.

Vector schema (metadata highlights)

- `id` (doc_id): resource:${project}:${path}:chunk:${i}
- `language`, `resourceType` (scripture|tsv|md), `subject`, `project`, `path`, `r2Key`, `ref` (book:chapter:verse|null), `chunkTokens`, `license`

Operational notes

- Prefer an externally-hosted vector DB (Qdrant/Pinecone) co-located with R2 region where possible.
- Batch embedding generation and use idempotent workers with dedupe.
- Instrument: p95 latency, cache hit-rate, embedding queue depth, rerank time, hallucination rate metrics.

Compatibility with current codebase

- Reuse `ZipResourceFetcher2`, `R2Storage`, and `externalReference` normalization.
- Keep the existing cache-first pattern in `ZipResourceFetcher2` and `R2Storage`.

Next: consult `RAG_CONTRACTS.md` for precise API shapes and examples.
