Overview — Full Rewrite Goals

Scope

- Rebuild the MCP as a chat-first service that exposes tools and prompts to chatbots and other consumers.
- Create a complementary Skill layer: high-level chat primitives built on top of MCP tools and the RAG service.
- Add a robust Retrieval-Augmented Generation (RAG) subsystem for semantic retrieval over Door43 resources.
- Replace current Cloudflare MCP deployment with a deployment strategy that can run both edge-compatible and self-hosted modes.

Primary goals

- Low-latency, cache-first responses for chat bots (sub-500ms typical for cached bundles)
- Deterministic provenance for every returned statement
- Modular architecture so components (MCP, Skill, RAG, Indexer) can be scaled independently
- Backwards-compatible MCP tool registry and REST equivalents for existing consumers

Stakeholders

- Chatbot developers (Skill consumers)
- Translation reviewers and linguists (content users)
- Ops (deployment and monitoring)

Success metrics

- P95 query latency ≤ 500ms for cached bundles
- Cache hit-rate ≥ 70% for common queries after warm-up
- Grounding precision ≥ 95% in human audits (no unsupported claims)
