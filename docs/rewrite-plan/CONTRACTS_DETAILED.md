Detailed JSON Schemas — RAG & MCP Contracts

1. `rag_query` request schema (JSON Schema)
   {
   "$schema": "http://json-schema.org/draft-07/schema#",
   "type": "object",
   "properties": {
   "query": { "type":"string" },
   "language": { "type":"string" },
   "reference": { "type":"string" },
   "filters": { "type":"object", "additionalProperties": true },
   "k": { "type":"integer", "minimum":1, "maximum":100 },
   "enableExact": { "type":"boolean" },
   "verbosity": { "type":"string", "enum":["brief","full"] }
   },
   "required":["query"]
   }

2. `rag_query` response example
   {
   "documents": [
   {
   "id":"resource:owner:project:path:chunk:0",
   "text":"...",
   "score":0.95,
   "metadata":{ "language":"es-419","resourceType":"tsv","path":"notes/nt/1.tsv","r2Key":"owner/project@v1","license":"CC-BY-SA-4.0" },
   "provenance": { "sourceType":"tsv","excerptStart":0 }
   }
   ],
   "exactMatches": [],
   "trace": { "vectorLatencyMs": 15, "filtersApplied":["language:es-419"] }
   }

3. `getBundle` response example
   {
   "scripture": { "text":"...", "format":"usfm" },
   "notes": [{ "id":"...","text":"...","externalReference":{ "path":"bible/kt/love"}}],
   "tw":[...],
   "ta":[...],
   "cacheStatus":"edge"
   }

4. Admin `indexResource` request/response
   Request: { "resourceId":"owner/project","zipUrl":"...","force":false }
   Response: { "taskId":"uuid","status":"queued" }

5. Error schema
   {
   "type":"object",
   "properties": {
   "code": {"type":"string"},
   "message": {"type":"string"},
   "details": {}
   },
   "required":["code","message"]
   }

Store these JSON schemas as canonical references for tool implementers and for automated validation in MCP tool wrappers.
