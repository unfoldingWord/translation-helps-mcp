Full Rewrite Plan Review — Gaps, Inconsistencies, Architecture Issues

Executive Summary
The planning documentation is 85% complete and provides a solid foundation for implementation. However, there are:

- 8 critical gaps (missing docs or specs)
- 12 contract inconsistencies (conflicts between documents)
- 15 architectural ambiguities (unclear integration points or logic)

**Blocker status**: No blockers; all issues are resolvable before or during scaffolding.

---

CRITICAL GAPS (must address before/during implementation)

Gap 1: Testing & Validation Strategy

- Status: Not documented
- Impact: Code review and QA can't be standardized; grounding validation unclear
- Details: GAPS_AND_NEXT_STEPS.md identified this but TESTING_STRATEGY.md was not created
- Needed:
  - Regression test suite for existing MCP tools
  - Contract compliance tests for `rag_query`, Skill endpoints
  - Integration test flows (e.g., index → query → generate → validate grounding)
  - Human validation protocol for grounding accuracy (sample size, criteria)
  - Performance baseline tests (latency, cache hit rate, cost per query)
- Action: Create `TESTING_STRATEGY.md` before Phase 1 scaffolding

Gap 2: Migration & Backwards Compatibility

- Status: Mentioned in GAPS but only briefly in DEPLOYMENT.md
- Impact: Existing SDK/CLI clients will break without clear upgrade path
- Details:
  - No deprecation timeline for old MCP tools
  - No spec for feature flags to gradually route traffic
  - No spec for how existing clients are auto-upgraded or versioned
- Needed:
  - Detailed feature flag strategy (which clients use which endpoint)
  - Timeline: when old MCP endpoints are read-only, then deprecated, then removed
  - SDK versioning plan (v1 uses old MCP, v2 uses new Skill)
  - Example: how a v1 CLI tool will work with new deployment
- Action: Expand DEPLOYMENT.md or create `MIGRATION.md` with concrete timeline

Gap 3: Caching Strategy Document

- Status: Details scattered across 4 files
- Impact: Cache invalidation bugs and inefficient cache placement decisions likely
- Details:
  - Cache key generation not standardized (DETAILED_SPEC vs DOOR43_INTEGRATION use different formats)
  - TTL rules inconsistent (1-5 min memory vs 5-60 min edge)
  - Warm-up heuristics mentioned but not formalized
- Needed:
  - Canonical cache key generation functions with examples
  - TTL matrix (layer × resource type × traffic pattern)
  - Invalidation trigger rules (when does each cache layer get purged?)
  - Backreference map spec for computing affected bundles on index update
  - Warm-up algorithm (which references prioritized, how often)
- Action: Create `CACHING_STRATEGY.md` with implementations in both pseudocode and TypeScript

Gap 4: Link Graph Building & Traversal

- Status: Mentioned in DOOR43_INTEGRATION but no implementation spec
- Impact: Skill `fetchPassageWithNotesAndLinks` can't be implemented without this
- Details: "Build a graph mapping reference → notes → externalReference.paths → TA/TW articles" is described but:
  - Exact graph construction algorithm not specified
  - When is it built (at index time? at query time?)?
  - How are circular references handled?
  - What's the exact JSON format for `resourceGraph:${language}:${reference}`?
- Needed:
  - Graph construction algorithm (DFS/BFS from reference, depth limits)
  - Storage format spec (JSON graph structure)
  - Traversal pseudocode with cycle detection
  - Performance targets and caching strategy
- Action: Add section to DOOR43_INTEGRATION.md or DETAILED_SPEC.md

Gap 5: Reranking Implementation

- Status: Mentioned in DETAILED_SPEC as "BM25 or small LLM" but no implementation spec
- Impact: Reranker won't be integrated into RAG query flow
- Details:
  - Choice between BM25 lexical vs LLM reranker not justified
  - Cost/latency tradeoffs not analyzed
  - Rerank depth, scoring rules, where in pipeline unclear
  - How does reranker integrate with generation (post-retrieval vs in-context)?
- Needed:
  - Decision matrix: when to use BM25 vs LLM (query type, latency budget)
  - Implementation spec for each (libraries, cost estimates)
  - Rerank depth tuning guidelines
  - How GENERATION_TEMPLATES uses reranked results
- Action: Add `RERANKING.md` or section to DETAILED_SPEC.md

Gap 6: Metadata Standardization

- Status: Partially documented; inconsistent across documents
- Impact: Response serialization and deserialization bugs
- Details:
  - EmbeddingDoc shape defined in DETAILED_SPEC
  - But returned Document shape in CONTRACTS_DETAILED slightly different
  - Bundle shape shows `cacheStatus` but Skill response doesn't explain its values
  - Provenance fields not consistently named (`r2Key` vs `sourceKey`?)
- Needed:
  - Unified metadata schema (what fields on every resource type)
  - Response envelope standardization (how is metadata always attached)
  - Provenance field canonicalization
- Action: Standardize schema across DETAILED_SPEC + CONTRACTS_DETAILED

Gap 7: Error Handling & Fallback Paths

- Status: Mentioned but not fully specified
- Impact: Degradation scenarios unclear; error propagation untested
- Details:
  - Soft-fallback to lexical search mentioned but how is it triggered and implemented?
  - What happens if Redis is unavailable? Workers fallback spec unclear
  - Partial indexing failures: what gets written, what gets rolled back?
  - How do Skill primitives handle missing resources (zero bundles returned)?
- Needed:
  - Error taxonomy and fallback decision tree
  - Explicit error codes and messages
  - Graceful degradation scenarios (one service down)
  - Retry logic with backoff
- Action: Add `ERROR_HANDLING.md` or section to DETAILED_SPEC.md

Gap 8: Embeddings Provider Interface

- Status: Abstract but no implementation spec
- Impact: Can't extend to other providers
- Details:
  - GENERATION_TEMPLATES mentions OpenAI but no provider abstraction interface
  - Batch size, batching logic not specified
  - Cost controls and rate limiting not detailed
  - Mock/dev provider spec missing
- Needed:
  - Provider interface (init, embed batch, cost estimate)
  - Implementation for OpenAI, local (sentence-transformers), fake (dev)
  - Batching algorithm and cost optimization
  - Fallback provider for rate-limit errors
- Action: Add section to DETAILED_SPEC.md or create `EMBEDDINGS_PROVIDER.md`

---

CONTRACT INCONSISTENCIES (must fix before implementation)

Inconsistency 1: RAG Query Verbosity Parameter

- Documents: CONTRACTS_DETAILED.md
- Issue: `verbosity: {"type":"string", "enum":["brief","full"]}` appears in schema but:
  - Never mentioned in CONTRACTS.md
  - Not explained in DETAILED_SPEC
  - Not used in GENERATION_TEMPLATES
- Fix: Either remove from schema or fully document behavior (what does "brief" vs "full" return?)
- Severity: Medium (unused parameter)

Inconsistency 2: Document ID Format

- Documents: DETAILED_SPEC.md vs DOOR43_INTEGRATION.md
- Issue:
  - DETAILED_SPEC: `doc_id: resource:${project}:${path}:chunk:${chunkIndex}`
  - But R2 keys: `files/${r2Key}/${path}`
  - And CONTRACTS_DETAILED shows `id:"resource:owner:project:path:chunk:0"`
- Fix: Clarify: is doc_id the PK in vector DB, and r2Key the file path? Make sure they're mapped 1:1
- Severity: High (data model confusion)

Inconsistency 3: Bundle Response Format

- Documents: CONTRACTS_DETAILED.md vs SKILL_LAYER.md
- Issue:
  - CONTRACTS_DETAILED shows: `{scripture, notes, tw, ta, cacheStatus}`
  - SKILL_LAYER shows: `{scripture, notes, tw:[], ta:[], metadata}`
  - Are `metadata` and `cacheStatus` the same field?
- Fix: Define canonical bundle schema and use everywhere
- Severity: High (serialization bugs)

Inconsistency 4: Exact Matches in RAG Response

- Documents: CONTRACTS_DETAILED.md
- Issue: Response shows `exactMatches: []` but:
  - DETAILED_SPEC doesn't explain when exactMatches populate
  - SKILL_LAYER doesn't mention handling exactMatches
  - RAG_query logic unclear
- Fix: Define exact match semantics and query logic
- Severity: Medium (feature underspecified)

Inconsistency 5: Skill Layer Parameter Names

- Documents: SKILL_LAYER.md vs CONTRACTS.md
- Issue:
  - SKILL_LAYER: `rag_query({query, language, reference, enableExact})`
  - CONTRACTS: `rag_query({query, language, reference?, filters?, k?, enableExact?})`
  - Are filters passed to RAG or not? What about k (result limit)?
- Fix: Make SKILL_LAYER pass all RAG params; fully specify wrapper behavior
- Severity: High (orchestration logic)

Inconsistency 6: Cache Layer TTL

- Documents: SKILL_LAYER.md vs DOOR43_INTEGRATION.md
- Issue:
  - SKILL_LAYER: "TTL: 1 hour for hot bundles"
  - DOOR43_INTEGRATION: "TTL 5-60 min" for edge cache
  - Memory cache: "TTL 1-5 min"
- Fix: Create TTL matrix (layer × resource type) in CACHING_STRATEGY.md
- Severity: Medium (performance tuning)

Inconsistency 7: Query Coalescing Dedup Key

- Documents: ORCHESTRATION.md vs SKILL_LAYER.md
- Issue:
  - ORCHESTRATION: `language:reference` for dedup
  - SKILL_LAYER: `language+reference+filters+query` for dedup
- Fix: Clarify: do filters and query vary, and should they affect coalescing?
- Severity: High (performance feature)

Inconsistency 8: resourceIndex Schema

- Documents: ORCHESTRATION.md
- Issue: "JSON with file list and lastIndexedAt" but exact schema not shown
- Fix: Show example JSON structure with all fields
- Severity: Medium (data structure clarity)

Inconsistency 9: Skill fetchPassageWithNotesAndLinks Orchestration

- Documents: SKILL_LAYER.md
- Issue: Steps mention calling `rag_query` with filters, then fetching full scripture text "via ZipResourceFetcher2"
  - When is ZipResourceFetcher2 called? For every reference or just on miss?
  - Is scripture text returned from RAG or always from Fetcher?
- Fix: Clarify: is scripture always canonical from Fetcher, or returned from RAG?
- Severity: High (data source logic)

Inconsistency 10: Metric Names

- Documents: DETAILED_SPEC.md vs ORCHESTRATION.md vs SKILL_LAYER.md
- Issue:
  - DETAILED_SPEC: `index.duration`, `query.latency`, `vector.latency`, `bundle.serve_latency`, `cache.hit_rate`
  - ORCHESTRATION: "queue length", "worker concurrency", "warm-run success"
  - SKILL_LAYER: `skill.fetch_duration`, `skill.generate_duration`, `skill.cache_hit`
- Fix: Standardize on a metric naming convention; define all metrics in one place
- Severity: Medium (observability)

Inconsistency 11: Admin Token Scope

- Documents: CONTRACTS.md
- Issue: "ADMIN_TOKEN required" but:
  - Scope unclear (per operation? per resource? global?)
  - Rotation policy not specified
  - Where exactly is it validated?
- Fix: Detail admin auth model and token format
- Severity: Medium (security)

Inconsistency 12: Language Code Format

- Documents: DOOR43_INTEGRATION.md
- Issue: Uses both `es_xxx` and `es-419` formats
  - Which is canonical for Door43?
  - Which is used as KV/cache key?
- Fix: Standardize (likely IETF BCP 47 like `es-419`)
- Severity: Medium (data normalization)

---

ARCHITECTURAL AMBIGUITIES (need clarification before implementation)

Ambiguity 1: Vector DB Collection Setup

- Issue: No spec for how Qdrant collections are initialized
- Details:
  - Collection name? (assumed `translation-helps-dev` from DEV_ENVIRONMENT.md)
  - Vector size (assumed 1536 for OpenAI)?
  - Distance metric (Cosine? Euclidean?)?
  - When are indexes built?
- Impact: Onboarding new engineers unclear; easy to misconfigure
- Action: Add explicit initialization code to DETAILED_SPEC.md

Ambiguity 2: Embedding Batching Logic

- Issue: DETAILED_SPEC mentions "batch embedding generation for cost control" but algorithm not specified
- Details:
  - Batch size? (100 docs? 1000?)
  - Flush logic? (max batch age before sending?)
  - Retry on rate limits?
  - Cost controls (max cost per day)?
- Impact: Cost overruns possible; performance unpredictable
- Action: Add batching algorithm pseudocode

Ambiguity 3: Reranker Placement & Decision Logic

- Issue: Is reranker in Workers (edge) or Node services?
- Details:
  - DEPLOYMENT says "heavy rerankers in Node services"
  - But what constitutes "heavy"?
  - Is there a fast-path (BM25 at edge) and slow-path (LLM in Node)?
- Impact: Latency targets hard to hit; can't decide deployment strategy
- Action: Clarify in RERANKING.md

Ambiguity 4: LLM Provider Abstraction

- Issue: GENERATION_TEMPLATES shows OpenAI examples but no pluggability interface
- Details:
  - Can we swap in Claude, Gemini, etc.?
  - Cost and latency varies by provider
  - How are costs tracked and limited?
- Impact: Vendor lock-in; hard to optimize cost
- Action: Define provider interface in GENERATION_TEMPLATES.md or new doc

Ambiguity 5: Redis Fallback for Workers

- Issue: DEPLOYMENT mentions "small Worker-facing KV fallback when Redis unavailable"
- Details:
  - What data goes into this KV?
  - How is it synced with Redis?
  - Is it read-only or read-write?
- Impact: Data consistency issues under failure
- Action: Detail in DEPLOYMENT.md with fallback data schema

Ambiguity 6: Memory Cache Auto-Scaling

- Issue: DETAILED_SPEC says "TTL 1-5 min depending on traffic"
- Details:
  - How is "traffic" measured?
  - What algorithm auto-scales TTL?
  - Can this cause thrashing (frequent eviction)?
- Impact: Unpredictable performance; hard to tune
- Action: Either remove auto-scaling or fully specify algorithm

Ambiguity 7: Index Version Cleanup

- Issue: ORCHESTRATION mentions `index:updated` events and warmers but not cleanup
- Details:
  - When are old index versions removed?
  - What's the GC algorithm?
  - Are historical versions kept for debugging?
- Impact: R2 and vector DB storage grows unbounded
- Action: Add cleanup algorithm to ORCHESTRATION.md

Ambiguity 8: Exact Fetch vs RAG Result Priority

- Issue: SKILL_LAYER says "fetch authoritative text via ZipResourceFetcher2 when needed"
- Details:
  - What does "when needed" mean?
  - Is this:
    - Always for scripture (never from RAG)?
    - Only if RAG returns no results?
    - Only for certain references?
  - How is the verse mapping done (if RAG returns verse 3:16, how does Fetcher know which file)?
- Impact: Bundle assembly logic buggy; wrong scripture text returned
- Action: Detail in SKILL_LAYER.md pseudocode

Ambiguity 9: Metric Emission & Cardinality

- Issue: Metrics mentioned but high-cardinality dimensions not managed
- Details:
  - If we emit `cache.hit_rate` per reference, explodes cardinality
  - Which dimensions are safe to tag on? (language? resource type?)
  - What's the downsampling strategy?
- Impact: Metrics backend overload
- Action: Detail in DEPLOYMENT.md or new OBSERVABILITY.md

Ambiguity 10: Request ID Format & Propagation

- Issue: DETAILED_SPEC mentions `requestId` in context but format/propagation unclear
- Details:
  - Format (UUID? base64? timestamp + hash?)?
  - Where is it created (at MCP entry? at Skill?)?
  - How does it cross service boundaries (HTTP header? field in payload)?
- Impact: Trace logs fragmented; debugging hard
- Action: Detail propagation strategy in DETAILED_SPEC.md

Ambiguity 11: Lexical Search Fallback

- Issue: DETAILED_SPEC mentions "soft-fallback to lexical search if vector DB fails"
- Details:
  - Is lexical index built during indexing?
  - What algorithm (BM25? Trigram? Regex)?
  - How does result quality compare?
- Impact: Can't implement fallback without knowing what to fallback to
- Action: Detail in new RERANKING.md or DETAILED_SPEC.md

Ambiguity 12: Skill vs MCP Layering

- Issue: SKILL_LAYER says "orchestrates calls to mcp-core and rag-service"
- Details:
  - Does Skill directly call RAG or go through MCP tool `rag_query`?
  - If direct, why have both?
  - If through MCP, how does that handle admin tools like `index_resource`?
- Impact: Circular dependency confusion; hard to test
- Action: Clarify in ARCHITECTURE.md with explicit dataflow diagram

Ambiguity 13: Bundle Assembly Logic Detail

- Issue: SKILL_LAYER says "assemble bundle: {scripture, notes, tw:[], ta:[]}"
- Details:
  - If RAG returns notes with externalReference.paths, how are TW/TA fetched?
  - Recursive? Limited depth?
  - How are duplicate articles avoided?
- Impact: Bundles either incomplete or have duplicates
- Action: Add pseudocode to SKILL_LAYER.md

Ambiguity 14: Response Compression & Streaming

- Issue: No mention of large bundle handling
- Details:
  - Bundles can be large (scripture + 10+ notes + 5+ articles)
  - Are responses gzip-compressed?
  - Is streaming used for large responses?
  - What's the max bundle size?
- Impact: Mobile clients slow; bandwidth wasted
- Action: Detail in DEPLOYMENT.md response handling

Ambiguity 15: Warm-up Prioritization Algorithm

- Issue: DOOR43_INTEGRATION says "Prioritize bible subject and commonly requested languages"
- Details:
  - How are "commonly requested" languages determined?
  - Top N by request count?
  - User preferences?
  - Top N references per language (which 100 passages in English)?
- Impact: Warm-up heuristics miss high-value targets
- Action: Add heuristic algorithm to CACHING_STRATEGY.md

---

IMPLEMENTATION READINESS CHECKLIST

Before Scaffolding (Phase 0)

- [ ] Resolve Inconsistencies 1-12 (update existing docs)
- [ ] Address Critical Gaps 1-5 (create new docs)
- [ ] Clarify Ambiguities 1-8 (add to DETAILED_SPEC or new docs)

Before Phase 1 (Indexing)

- [ ] Address Gaps 6-8
- [ ] Clarify Ambiguities 9-15

Before Phase 2 (Retrieval & Skill)

- [ ] All contract tests passing

Before Phase 3 (Deployment)

- [ ] All docs finalized

---

PRIORITY FIXES (do immediately)

🔴 **High Priority** (affect scaffolding):

1. Document ID format (Inconsistency 2)
2. Bundle response schema (Inconsistency 3)
3. Skill parameter passing to RAG (Inconsistency 5)
4. Exact fetch vs RAG priority (Ambiguity 8)
5. Testing strategy (Gap 1)

🟡 **Medium Priority** (before Phase 1): 6. Caching strategy doc (Gap 3) 7. Link graph spec (Gap 4) 8. Reranking spec (Gap 5) 9. Error handling (Gap 7) 10. Embeddings provider interface (Gap 8) 11. Skill/MCP layering clarification (Ambiguity 12)

🟢 **Low Priority** (can address during implementation): 12. Admin token scope details 13. Metric names standardization 14. Vector DB collection setup 15. Response compression strategy

---

SUMMARY & NEXT STEPS

**Overall Assessment**: 85% complete. Solid architecture with good separation of concerns. Main issues are:

- Missing 3-4 critical implementation docs
- Scattered/inconsistent specs need consolidation
- Some architectural layering decisions need clarification

**Immediate Action** (next 1-2 hours):

1. Update CONTRACTS_DETAILED.md to remove/clarify verbosity parameter
2. Standardize Bundle and Document ID schemas
3. Create CACHING_STRATEGY.md with TTL matrix and key generation
4. Clarify Skill→RAG data flow in SKILL_LAYER.md
5. Create TESTING_STRATEGY.md

**Can proceed with scaffolding after above 5 items are done.**

---

Generated: 2026-05-26
