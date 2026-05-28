Skill Layer — high-level chat primitives and orchestration

Purpose
The Skill layer sits above MCP tools and coordinates calls to RAG, exact fetchers, and LLM generation. It exposes REST/SDK endpoints for chatbot developers.

Core Skill primitives

1. `fetchPassageWithNotesAndLinks(language, reference, options?)`
   - Fetches scripture + notes + linked TW/TA articles for a passage.
   - Returns: fully-assembled bundle with text, metadata, and citations.
   - Orchestration:
     1. Call `rag_query({query: "notes for this passage", language, reference, enableExact: true, filters: {resourceType:["tsv"]}})`
     2. Extract `externalReference.path` values pointing to TW/TA articles.
     3. For each path, call `rag_query` again to fetch linked articles.
     4. Fetch full scripture text via `ZipResourceFetcher2` for authoritative text (using `reference` to extract exact verses).
     5. Assemble bundle: `{ scripture, notes, tw:[], ta:[], metadata }`.
     6. Cache bundle in `rag:bundle:${language}:${reference}`.
   - Latency goal: <500ms (cache hit) / <1s (miss)

2. `generateTranslationHelp(bundle, userPrompt, options?)`
   - Takes a bundle and user prompt, generates narrative help.
   - Calls LLM with bundle context and enforces grounding.
   - Returns: `{ response, citations:[] }` (citations include r2Key, path, excerpt).
   - Latency goal: <2s (LLM call)

3. `queryRAG(query, language?, reference?, filters?)`
   - Low-level RAG query wrapper.
   - Direct pass-through to RAG service, but ensures response format includes provenance.

4. `composeTranslationReport(reference, language, userPrompt?)`
   - Combines `fetchPassageWithNotesAndLinks` + `generateTranslationHelp`.
   - All-in-one endpoint for a complete translation help report.

SDK interface (TypeScript)

```typescript
interface SkillClient {
  fetchPassageWithNotesAndLinks(
    language: string,
    reference: string,
    options?: { includeTA?: boolean; includeEtymology?: boolean },
  ): Promise<TranslationBundle>;

  generateTranslationHelp(
    bundle: TranslationBundle,
    userPrompt: string,
    options?: { maxTokens?: number; citations?: boolean },
  ): Promise<GeneratedResponse>;

  queryRAG(
    query: string,
    options?: {
      language?: string;
      reference?: string;
      filters?: object;
      k?: number;
    },
  ): Promise<RAGQueryResult>;

  composeTranslationReport(
    reference: string,
    language: string,
    userPrompt?: string,
  ): Promise<TranslationReport>;
}
```

REST endpoints

- `POST /skill/fetch-passage` → `fetchPassageWithNotesAndLinks`
- `POST /skill/generate` → `generateTranslationHelp`
- `POST /skill/query` → `queryRAG`
- `POST /skill/compose` → `composeTranslationReport`

Error handling & fallbacks

- If RAG returns no results: return `{ error: "no_resources_found", fallback: "Please rephrase your question or try a different passage." }`
- If LLM generation fails: return last successful bundle with error flag.
- If ZipResourceFetcher2 fetch fails: still return bundle with partial data and warning flag.

Orchestration rules

- Coalesce identical concurrent requests (by `language:reference` key).
- Respect cache status: if bundle is hot, skip RAG query and return immediately.
- Pre-warm common bundles: top 20 languages × top 100 passages.
- Respect rate limits per user/session.

Caching

- Bundle cache key: `rag:bundle:${language}:${reference}`
- TTL: 1 hour for hot bundles, refresh on index updates
- Memory cache: last 10 bundles per session

Instrumentation

- Metrics: `skill.fetch_duration`, `skill.generate_duration`, `skill.cache_hit`
- Logs: bundle fetch and generation calls with request ID and timing

Next: read `GENERATION_TEMPLATES.md` to see how LLM calls are constructed.
