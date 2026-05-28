Rewrite Contracts — MCP, Skill, RAG

MCP Tools (exposed to MCP clients)

- `list_tools()`
- `call_tool(name, args)` — existing; keep contract but expand tool list
- New tools to add:
  - `rag_query({query, language, reference?, filters?, k?, enableExact?})`
  - `index_resource({resourceId|zipUrl, force?, priority?})`
  - `get_bundle({language, reference, includeNotes?, includeTW?, prewarm?})`

Skill Primitives (HTTP/SDK)

- `POST /skill/fetch_passage_with_notes` -> accepts `language`, `reference`, `options` and returns structured `bundle` for generation
- `POST /skill/compose_help` -> takes `bundle` + `userPrompt` and returns generated content with citations

RAG Service (internal public API)

- `POST /rag/query` — contract in `docs/rag-plan/RAG_CONTRACTS.md`
- `POST /rag/index` — admin
- `GET /rag/bundle/:language/:reference` — cached bundle

Provenance fields

- Every returned document must include: `r2Key`, `path`, `project`, `license`, `excerptStart`, `excerptEnd`, `cacheStatus`

Error schema

- `{ code:string, message:string, details?:any, retryable?:boolean }`

SDK surfaces

- JS/TS: `client.mcp.callTool()`, `client.skill.fetchPassage()`, `client.rag.query()`
- Ensure SDK surfaces `cacheStatus` and `provenance` in returned objects

Authentication & Admin

- Admin APIs must require an `ADMIN_TOKEN` or OAuth-based role; indexing endpoints rate-limited and logged.
