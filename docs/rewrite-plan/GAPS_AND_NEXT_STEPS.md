Remaining Gaps & Next Steps

Critical gaps not yet covered

1. MCP Prompts (major)
   - Current repo has prompts in `src/mcp/prompts-registry.ts` that are chat-specific.
   - Plan doesn't specify: how prompts are redesigned for RAG-aware responses, how they remain backwards-compatible, how new prompts for Skill primitives are added.
   - Action: create `docs/rewrite-plan/MCP_PROMPTS.md` with:
     - existing prompt list and behavior
     - revised prompts that include RAG query instructions
     - new Skill-specific prompts
     - prompt versioning and migration strategy

2. Skill Layer implementation details (major)
   - We have the concept but not the execution spec.
   - Need: concrete function signatures, orchestration logic (when to call RAG vs exact fetch), response assembly rules.
   - Action: create `docs/rewrite-plan/SKILL_LAYER.md` with:
     - Skill primitive definitions (exact function signatures)
     - orchestration pseudo-code (e.g., how `fetch_passage_with_notes` chains RAG + exact fetch)
     - bundle assembly rules
     - error handling and fallback paths

3. Generation templates & prompt engineering (major)
   - How is the LLM prompted with retrieval results?
   - Citation enforcement and grounding rules?
   - How do we prevent hallucinations?
   - Action: create `docs/rewrite-plan/GENERATION_TEMPLATES.md` with:
     - system prompt template
     - context insertion rules (max tokens, truncation)
     - citation format and enforcement
     - grounding checks and fallbacks

4. Reranking specifics (medium)
   - Current spec mentions "lexical BM25 or small LLM reranker" but no implementation detail.
   - Action: add section to `docs/rewrite-plan/DETAILED_SPEC.md` with:
     - lexical reranker (BM25 algorithm, library choice)
     - LLM reranker (which model, cost/latency tradeoff)
     - rerank depth and scoring rules

5. Cache key generation & invalidation (medium)
   - We have examples but not a systematic spec.
   - Action: create `docs/rewrite-plan/CACHING_STRATEGY.md` with:
     - cache key generation functions (deterministic, sortable)
     - TTL rules per cache layer
     - invalidation triggers and backreference maps
     - warm-up heuristics

6. Development environment & local setup (medium)
   - How do developers run the full stack locally?
   - Action: create `docs/rewrite-plan/DEV_ENVIRONMENT.md` with:
     - docker-compose for Redis + Qdrant (dev mode)
     - local env vars template
     - how to backfill test data
     - local test commands

7. Testing & validation strategy (medium)
   - How do we ensure rewrite doesn't break existing MCP clients?
   - How do we validate grounding and cite accuracy?
   - Action: create `docs/rewrite-plan/TESTING_STRATEGY.md` with:
     - regression tests for existing MCP tools
     - contract compliance tests for new tools
     - integration tests for MCP + RAG + Skill
     - grounding accuracy validation (human + automated)

8. Migration & backwards compatibility (medium)
   - How do existing SDK/CLI consumers move to the new setup?
   - Action: add section to `DEPLOYMENT.md` or new `MIGRATION.md` with:
     - feature flags and versioning
     - deprecation timeline for old endpoints
     - client SDK update path

Recommended sequence

1. Start with **MCP_PROMPTS.md** — existing prompts must be understood and revised first.
2. Then **SKILL_LAYER.md** — the Skill is the orchestration glue.
3. Then **GENERATION_TEMPLATES.md** — how responses are actually generated.
4. Then scaffolding and dev environment setup.

If you want, I can write all 4 of these now in parallel, then we'll have a complete spec and can start implementation.
