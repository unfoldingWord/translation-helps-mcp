Development Environment Setup

Prerequisites

- Node.js 18+
- npm or yarn
- Docker & Docker Compose (for local Redis and Qdrant)
- Python 3.8+ (optional, for embedding generation scripts)

Local stack setup (Docker Compose)

Create `docker-compose.dev.yml` in repo root:

```yaml
version: "3.8"
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  redis_data:
  qdrant_data:
```

Start services:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

Environment variables (`.env.dev`)

```
# Storage
R2_BUCKET_NAME=dev-bucket
R2_ACCOUNT_ID=dev
CF_API_TOKEN=dev-token (or use local FS fallback)
USE_FS_CACHE=true

# Vector DB
VECTOR_DB_URL=http://localhost:6333
VECTOR_DB_COLLECTION=translation-helps-dev

# Cache & KV
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=

# Embeddings (dev mode uses fake embeddings)
EMBEDDINGS_PROVIDER=fake
# OR for real embeddings:
OPENAI_API_KEY=...
EMBEDDINGS_MODEL=text-embedding-3-small

# Admin
ADMIN_TOKEN=dev-secret

# Logging
LOG_LEVEL=debug
NODE_ENV=development
```

Local project structure (source)

```
src/
  mcp/
    tools-registry.ts
    prompts-registry.ts
    tools/
      ragQuery.ts (new)
  services/
    RagService.ts (new)
    RagServiceDev.ts (new, in-memory index)
  indexer/
    indexer.ts (new)
  skill/
    SkillService.ts (new)
    orchestration.ts (new)
ui/
  src/routes/
    api/
      skill/
        [...].ts (new endpoints)
```

First-time setup

```bash
# 1. Install deps
npm install

# 2. Start Docker services
docker-compose -f docker-compose.dev.yml up -d

# 3. Build
npm run build

# 4. Load test data (optional)
node dist/scripts/load-test-data.js --language es_xxx --sample

# 5. Run dev server
npm run dev
```

Dev commands

```bash
# Start the dev RAG service (in-memory)
npm run dev:rag

# Run indexer on a test ZIP
npm run indexer -- --project owner/project --zipUrl https://...

# Run tests
npm run test

# Run integration tests
npm run test:integration

# Watch mode (rebuild on file changes)
npm run watch

# Lint and format
npm run lint
npm run format
```

Testing the stack

1. Test RAG service:

```bash
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What does love mean?",
    "language": "es-419",
    "k": 5
  }'
```

2. Test Skill endpoint:

```bash
curl -X POST http://localhost:3000/skill/fetch-passage \
  -H "Content-Type: application/json" \
  -d '{
    "language": "es-419",
    "reference": "JHN 3:16"
  }'
```

3. Test MCP tool:

```bash
node dist/src/index.js << EOF
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "rag_query",
    "arguments": {
      "query": "notes for John 3",
      "language": "en",
      "reference": "JHN 3:16"
    }
  }
}
EOF
```

Loading test data

Create `scripts/load-test-data.ts`:

- Downloads a small Door43 ZIP (e.g., Spanish ULT + notes)
- Uses `ZipResourceFetcher2` to extract
- Runs through indexer pipeline
- Populates Qdrant and Redis
- Usage: `npm run indexer -- --project es_xxx --sample`

Debugging

- Redis CLI: `docker exec -it <redis-container> redis-cli`
- Qdrant API: `http://localhost:6333/api/collections`
- Logs: `tail -f logs/dev.log` (if using file logging)

Tips

- Use `LOG_LEVEL=debug` to see detailed traces
- Mock embeddings in dev: `EMBEDDINGS_PROVIDER=fake` generates deterministic vectors
- Keep R2 fallback to FS (`USE_FS_CACHE=true`) in dev
- Use smaller test zips to speed up indexing iterations

Next: read `GAPS_AND_NEXT_STEPS.md` to see what other gaps remain, or proceed to implementation with `AGENT_INSTRUCTIONS.md`.
