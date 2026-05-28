RAG API Contracts and Schemas

1. `rag_query` (primary retrieval endpoint / MCP tool)

Request (JSON):
{
"query": "string",
"language": "es-419",
"reference": "JHN 3:16", // optional
"filters": { "resourceType": ["scripture","tsv"], "subject": ["Translation Notes"] },
"k": 10,
"enableExact": true,
"verbosity": "brief" // or full
}

Response (JSON):
{
"documents": [
{
"id": "resource:es_xxx:bible/kt/love:chunk:2",
"text": "...",
"score": 0.92,
"chunkIndex": 2,
"metadata": { "resourceType":"md","path":"bible/kt/love","project":"es_xxx","language":"es-419","r2Key":"xyz","license":"CC-BY-SA-4.0" },
"provenance": { "sourceType":"md","excerptStart":1200 },
"cacheStatus": "memory"
}
],
"exactMatches": [{ "type":"verse","text":"For God so loved...","citation":{...} }],
"trace": { "vectorLatencyMs": 12, "filtersApplied": ["language:es-419"] }
}

2. `indexResource` (admin)
   Request: { "resourceId": "owner/project", "zipUrl": "https://...", "force": true }
   Response: { "taskId":"uuid", "status":"queued" }

3. `getBundle`
   Request: { "language":"es-419", "reference":"JHN 3:16", "includeNotes": true }
   Response: { "scripture":{...}, "notes":[...], "tw":[...], "ta":[...], "cacheStatus":"edge" }

4. Bundle / Document metadata schema (sample)
   {
   "doc_id": "resource:owner:project:path:chunk:idx",
   "path": "bible/kt/love",
   "r2Key": "owner/project@ref/files/bible/kt/love.md",
   "resourceType": "md",
   "language": "es-419",
   "subject": "Translation Academy",
   "ref": null,
   "license": "CC-BY-SA-4.0",
   "chunkIndex": 2,
   "startToken": 1024,
   "endToken": 1280
   }

5. Errors & Warnings

- Standardize errors: { code: string, message: string, details?: any, retryable?: boolean }
- Return `warnings` array on `rag_query` when filters removed or resources missing.

6. Security

- Every response must include license & provenance fields for each document.
- Admin APIs require an authenticated token and must be rate-limited.

7. SDK wrapper (JS/TS) surface

- `client.rag.query(opts)` → structured response
- `client.rag.getBundle(language, reference)` → bundle
- `client.rag.index(resourceId, opts)` → returns taskId

Use these contracts as canonical references for MCP tool wiring and the Skill layer.
