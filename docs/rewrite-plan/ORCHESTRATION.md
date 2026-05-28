Orchestration & Producer/Consumer Patterns

Overview
This document specifies how jobs, queries, cache invalidation, and warmers are coordinated so the pieces "snap" together reliably.

Components

- Job Queue: Redis + BullMQ (or alternative), handles `index-resource`, `warm-bundle`, `reindex` jobs.
- Workers: stateless Node workers that process queue jobs; can scale horizontally.
- Coordinator: small service that schedules periodic jobs (cron) and watches index events to trigger warmers.
- Coalescer: in-memory or Redis-based request coalescing for identical `language:reference` queries.

Job lifecycle: `index-resource`

1. Admin enqueues job `index:resource:{resourceId}` with `taskId` and `force` flag.
2. Job scheduler pushes to queue; workers pick up, set `taskLock` in Redis to avoid duplicates.
3. Worker obtains ZIP via `ZipResourceFetcher2` and enumerates files.
4. Worker parses, chunks, creates EmbeddingDocs.
5. Worker batches embeddings and calls `vectorStore.upsert`.
6. Worker writes parsed artifacts to R2 and updates `resourceIndex:${project}` in KV and publishes `index:updated` event with list of paths.
7. Coordinator receives `index:updated` and enqueues `warm-bundle` for top affected references.
8. Worker marks job done, clears `taskLock`.

Warmers & prefetch

- Warmers accept `language` and list of `references` and call `getBundle` to populate memory and edge caches.
- Warmers limited to N concurrent to avoid overload; use token bucket per warm-run.

Query coalescing

- For identical incoming queries (`query+language+reference+filters`), use Redis pub/sub to register pending queries and have only one upstream vector/kv fetch; once done publish result to waiting consumers.

Cache invalidation

- On `index:updated`, invalidate `rag:bundle:*` entries whose `resource` or `path` appear in the event. Use `resource->references` backrefs to compute affected bundles.

Backpressure

- If embedding provider queue grows above threshold, pause new admin-triggered indexing and alert ops.
- If vector DB QPS high, throttle reranker and decrease rerank depth.

Retries and idempotency

- Index tasks are idempotent by `resource`+`refTag`+`lastIndexedAt` checks; partial progress is written atomically for each file.

Observability & dashboards

- Queue length, worker concurrency, index job latencies, warm-run success, cache hit-rate, vector latency, bundle serve latency.

Security notes

- Workers validate `taskId` and admin token before enqueuing index jobs.

Edge compatibility

- Workers should be light: accept `getBundle` and `rag_query` calls, but delegate heavy rerankers and embeddings to central Node services.
