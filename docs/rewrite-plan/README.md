Translation-Helps Full Rewrite Plan — Document Index

Updated: 2026-05-28

This directory contains the complete specification for the greenfield rewrite of the
translation-helps MCP server, Skill layer, RAG subsystem, and deployment.

START HERE: AGENT_RUNBOOK.md — single entry point for autonomous execution.

---

REQUIRED READING (in order)

| File                      | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| AGENT_RUNBOOK.md          | Kickoff doc: env setup, read order, gates, abort criteria        |
| AGENT_INSTRUCTIONS.md     | How to execute the greenfield rewrite step-by-step               |
| GLOSSARY.md               | Terminology: ULT, TN, rc://, tc-ready, doc_id, r2Key, bundle     |
| OVERVIEW.md               | Goals, success metrics, stakeholders                             |
| CODEBASE_INVENTORY.md     | Per-directory delete/keep/port verdicts; domain invariants       |
| SCAFFOLD_AUDIT.md         | Per-file verdicts on in-progress scaffolding; harvest notes      |
| DETAILED_SPEC.md          | Module boundaries, interfaces, data models, exact behavior       |
| ARCHITECTURE.md           | System architecture, component layout, data-flow diagrams        |
| CONTRACTS.md              | Summary of all API and tool contracts                            |
| CONTRACTS_DETAILED.md     | Canonical JSON schemas (wins on schema conflicts)                |
| ORCHESTRATION.md          | Job lifecycle, cache invalidation, warmers, fault tolerance      |
| DOOR43_INTEGRATION.md     | Door43 retrieval, normalization, storage, caching rules          |
| CACHING_STRATEGY.md       | TTL matrix, key generators, invalidation, warm-up algorithm      |
| LINK_GRAPH.md             | Link graph construction, storage, traversal with cycle detection |
| RERANKING.md              | BM25 vs LLM decision matrix, reranker placement                  |
| ERROR_HANDLING.md         | Error taxonomy, codes, retry/backoff, degradation tree           |
| EMBEDDINGS_PROVIDER.md    | Provider interface, OpenAI/local/fake impls, batching            |
| GENERATION_TEMPLATES.md   | LLM prompt engineering, grounding, citation parsing              |
| SKILL_LAYER.md            | Skill primitives, orchestration pseudocode, bundle assembly      |
| MCP_PROMPTS.md            | MCP prompt registry: existing + RAG-aware redesign               |
| DEPLOYMENT.md             | Cloudflare Pages hybrid deployment, rollout stages               |
| GOTCHAS.md                | Platform constraints, known traps, common mistakes               |
| OBSERVABILITY.md          | Canonical metric names, cardinality, request-ID propagation      |
| SECURITY_AND_LICENSING.md | Admin auth, rate limits, license enforcement                     |
| COST_MODEL.md             | Embedding/LLM/storage cost math, daily caps                      |
| MILESTONES_BRANCH_PLAN.md | Milestone targets, git branching, PR/commit conventions          |
| TESTING_STRATEGY.md       | Test pyramid, contract test restoration, grounding protocol      |
| TASKS.md                  | Task graph T-00..T-16 (dependency-ordered, PR-sized)             |
| DEV_ENVIRONMENT.md        | Local Docker Compose setup, .env.dev template, test commands     |
| FREE_TIER_OPTIONS.md      | Dev vs. prod provider matrix; all-free-tier deployment guide     |
| GAPS_AND_NEXT_STEPS.md    | Historical gap list (superseded by new docs; kept for reference) |

---

RELATED DOCS (outside this directory)

docs/UW_TRANSLATION_RESOURCES_GUIDE.md — Definitive Door43 domain guide (MUST READ)
docs/rag-plan/RAG_ARCHITECTURE.md — RAG architecture deep dive
docs/rag-plan/RAG_CONTRACTS.md — RAG API contracts (superseded by CONTRACTS_DETAILED.md)
docs/rag-plan/RAG_DEPLOYMENT_PLAN.md — RAG deployment notes
docs/rag-plan/RAG_TASKS.md — RAG-specific task list
.cursor/rules/mcp-sdk-sync.mdc — SDK sync rule (enforce on every tool change)
.cursor/rules/taskmaster/dev_workflow.mdc — Taskmaster workflow

---

ARCHIVED

\_archive/REVIEW_FINDINGS_2026-05-26.md — Original gap/inconsistency audit
(All items resolved and folded into the docs above as of 2026-05-28.)
