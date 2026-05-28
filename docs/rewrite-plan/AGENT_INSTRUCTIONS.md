Agent Instructions — how to use this rewrite plan

Purpose
This file tells an AI agent exactly how to consume and execute the rewrite plan in `docs/rewrite-plan/`.

Start here

1. Read `README.md` for the overall scope and contents.
2. Read `OVERVIEW.md` to understand goals, stakeholders, and success metrics.
3. Read `DETAILED_SPEC.md` for data models, module boundaries, interfaces, and exact behavior expectations.
4. Read `ARCHITECTURE.md` for the system layout and runtime patterns.
5. Read `CONTRACTS.md` and `CONTRACTS_DETAILED.md` for canonical API/tool contracts and JSON schemas.
6. Read `ORCHESTRATION.md` for job flow, cache invalidation, warmers, and fault tolerance.
7. Read `DOOR43_INTEGRATION.md` to understand how Door43 resources are retrieved, normalized, indexed, and cached.
8. Read `DEPLOYMENT.md` to understand the Cloudflare-compatible rollout and deployment options.

Execution path

1. Identify existing code boundaries in the repo:
   - MCP core: `src/mcp/*`
   - RAG services: `src/services/*`
   - indexer: `src/indexer/*`
   - UI REST endpoints: `ui/src/routes/api/*`
2. Scaffold the dev service first:
   - create `src/services/RagService.ts` with `indexResource`, `query`, `getBundle`
   - implement a dev in-memory vector index and embedding stub
   - add `src/mcp/tools/ragQuery.ts` and expose it in `src/mcp/tools-registry.ts`
3. Add tests for contract compliance using the JSON schema examples.
4. Implement storage adapters and connect to `ZipResourceFetcher2`.
5. Add cache/warmers and orchestration after the basic service works.

What is covered

- High-level architecture across MCP, Skill, RAG, indexer, storage, and deployment
- API contracts and data models
- Door43-specific retrieval and caching patterns
- Orchestration and job flows
- Deployment strategy for replacing Cloudflare MCP

What still may need refinement

- exact existing source-file mappings for every new class
- vector DB provider implementation details
- LLM prompt templates and reranker details (this comes next)

Conclusion
Yes: this directory now contains enough planning material for an AI to understand the rewrite and begin implementing it. The additional `AGENT_INSTRUCTIONS.md` file makes the execution path explicit and reduces ambiguity.
