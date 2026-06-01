# Translation Helps MCP v2

A proper [Model Context Protocol](https://modelcontextprotocol.io) server giving LLMs direct access to Bible translation resources — scripture text, notes, words, and Academy articles from [unfoldingWord](https://unfoldingword.org).

## Quick Start

### Connect to Claude Desktop / Cursor

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "translation-helps": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://translation-helps-mcp.workers.dev/mcp"
      ]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "translation-helps": {
      "url": "https://translation-helps-mcp.workers.dev/mcp"
    }
  }
}
```

**Direct HTTP** (Streamable MCP):

```bash
curl -X POST https://translation-helps-mcp.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Available Tools

| Tool                           | Description                               |
| ------------------------------ | ----------------------------------------- |
| `fetch_scripture`              | Bible text (ULT/UST) for any reference    |
| `fetch_translation_notes`      | Exegetical notes for a passage            |
| `fetch_translation_word_links` | Translation Words at a reference          |
| `fetch_translation_word`       | Full dictionary article (by path or term) |
| `fetch_translation_academy`    | Translation Academy articles              |
| `fetch_translation_questions`  | Comprehension questions for a passage     |
| `list_languages`               | All available language codes              |
| `list_subjects`                | All available resource subjects           |
| `list_resources_for_language`  | Resources for a language                  |
| `rag_query`                    | Semantic search over all resources        |
| `get_bundle`                   | All translation helps for a passage       |
| `index_resource`               | Admin: index a resource for RAG           |

## Architecture

```
Cloudflare Worker
├── /mcp  →  TranslationHelpsMCP (McpAgent Durable Object)
│            Streamable HTTP + SSE, structured outputs, trace IDs
└── /*    →  SvelteKit website (Workers Assets)
             Landing · Playground · Docs · Metrics
```

- **Transport**: Streamable HTTP + SSE via `McpAgent` (Cloudflare Durable Objects)
- **Storage**: KV (cache) + R2 (ZIP persistence) + Vectorize (RAG)
- **AI**: Workers AI for embeddings, Reranker for relevance
- **Observability**: Analytics Engine metrics, structured JSON logs → GitHub Issues

## SDKs

- **JavaScript/TypeScript**: `packages/js-sdk/`
- **Python**: `packages/python-sdk/`

## Development

```bash
# Install deps
npm install
cd web && npm install && cd ..

# Type check
npm run typecheck

# Lint
npm run lint

# Test (81 unit + contract tests)
npm test

# Run locally (requires wrangler auth)
npm run dev:worker

# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:prod
```

## Versioning

This project uses [Changesets](https://github.com/changesets/changesets) for version management.

```bash
# Add a changeset for your change
npm run changeset

# Release (auto-run in CI)
npm run release
```

## License

MIT — See [LICENSE](LICENSE)
