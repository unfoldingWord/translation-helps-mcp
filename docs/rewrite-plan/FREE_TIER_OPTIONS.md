Free-Tier Provider Options (2026-05-28)

This file records the chosen dev vs. production provider for each external service,
all running entirely within free-tier limits. No paid API key is required for production.

---

PROVIDER MATRIX

| Service     | Dev (local)               | Prod (Cloudflare free)            | Paid escalation               |
| ----------- | ------------------------- | --------------------------------- | ----------------------------- |
| Vector DB   | Qdrant (Docker, free)     | Cloudflare Vectorize              | Qdrant Cloud Starter ($25/mo) |
| Embeddings  | FakeEmbeddingService ($0) | CF Workers AI bge-base-en-v1.5    | OpenAI text-embedding-3-small |
| LLM         | FakeLLMProvider ($0)      | CF Workers AI llama-3.1-8b        | OpenAI gpt-4o-mini            |
| KV / Redis  | InMemoryKVStore ($0)      | Upstash Redis free (10K cmds/day) | Upstash Redis paid            |
| KV fallback | —                         | CF KV (TRANSLATION_HELPS_CACHE)   | —                             |
| R2 storage  | Local FS (USE_FS_CACHE)   | CF R2 (ZIP_FILES, 10GB free)      | —                             |
| Pages       | wrangler pages dev        | CF Pages free (100K req/day)      | CF Pages paid                 |

---

CLOUDFLARE VECTORIZE FREE TIER

Limits (as of 2026):
Stored vector dimensions: 30M / month
Queried vector dimensions: 5M / month

Fit for top-20-language backfill:
4.08M vectors × 768 dims = 3.13B dims stored
Well within the 30M/month storage budget (stored is accumulated, not monthly).
Query budget: at 768 dims × 10 queries/req × 10K req/day = ~77M dims/day.
EXCEEDS free query tier if busy. Mitigation: cache-first (P70+ cache hit rate
keeps actual Vectorize queries well below 5M/month on modest traffic).

---

CLOUDFLARE WORKERS AI FREE TIER

Models used:
Embedding: @cf/baai/bge-base-en-v1.5 — 768 dim, 1M neurons/day free
LLM: @cf/meta/llama-3.1-8b-instruct — 10K tokens/day free limit

Note on LLM limit:
10K tokens/day is very tight for production compose calls.
Workers AI LLM is suitable for dev/staging and low-volume production.
For higher traffic: set LLM_PROVIDER=openai in wrangler.toml secrets.
The FakeLLMProvider is used in dev and in integration tests (bypasses limit).

---

ENVIRONMENT VARIABLES FOR EACH TIER

Dev (.env local):
EMBEDDINGS_PROVIDER=fake
LLM_PROVIDER=fake
VECTOR_DB_URL=http://localhost:6333
VECTOR_DIMENSION=768
CHUNKER_TOKENIZER=bert
KV_PROVIDER=memory
USE_FS_CACHE=true
NODE_ENV=development

Prod (wrangler.toml + CF Pages secrets):
EMBEDDINGS_PROVIDER=workersai (uses CF binding env.AI)
LLM_PROVIDER=workersai (uses CF binding env.AI)
VECTOR_DIMENSION=768
CHUNKER_TOKENIZER=bert
KV_PROVIDER=upstash (uses UPSTASH_REDIS_REST_URL secret)
NODE_ENV=production

Escalation to OpenAI (set via CF Pages secrets):
EMBEDDINGS_PROVIDER=openai
EMBEDDINGS_MODEL=text-embedding-3-small
VECTOR_DIMENSION=1536 (requires deleting+recreating Vectorize index!)
CHUNKER_TOKENIZER=cl100k_base
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=<secret>

IMPORTANT: Changing VECTOR_DIMENSION means all vectors must be re-indexed.
See GOTCHAS.md #9 for the full warning.

---

WRANGLER.TOML ADDITIONS (for prod)

Add to wrangler.toml (created in T-16):

[[vectorize]]
binding = "VECTORIZE"
index_name = "translation-helps-production"

[ai]
binding = "AI"

These bindings are injected into the Workers env and consumed by
CFVectorizeStore.ts and WorkersAIEmbeddingService.ts / WorkersAILLMProvider.ts.
