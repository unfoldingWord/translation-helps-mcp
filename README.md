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
        "https://translation-helps-mcp-v2.workers.dev/mcp"
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
      "url": "https://translation-helps-mcp-v2.workers.dev/mcp"
    }
  }
}
```

**Direct HTTP** (Streamable MCP):

```bash
curl -X POST https://translation-helps-mcp-v2.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Available Tools

### Progressive-Disclosure Workflow Tools (on `/mcp`)

These 13 tools are the MCP surface (also available at `POST /api/tool`). They are
designed for a progressive, conversation-style retrieval flow and accept flexible
argument forms (see [Argument Normalization](#argument-normalization) below).
All tools call the REST Data API via `ApiClient`.

| Tool                  | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| `list_languages`      | All available language codes (with optional substring filter) |
| `list_resources`      | Availability summary of resource types for a language         |
| `get_passage`         | Bible text in all available versions for a reference          |
| `get_passage_context` | Notes, Translation Words, and questions for a passage         |
| `get_passage_index`   | Chapter-level index of available notes for quick navigation   |
| `get_note`            | Single exegetical note by reference + quote                   |
| `get_academy_article` | Translation Academy article by path (e.g. `figs-metaphor`)    |
| `get_word_article`    | Translation Words dictionary entry by path                    |
| `get_questions`       | Comprehension/discussion questions for a passage              |
| `search_articles`     | Lexical search over TA + TW catalogs                          |
| `get_obs_story`       | Open Bible Stories story text by number                       |
| `get_obs_notes`       | Translation notes for an OBS story                            |
| `get_obs_questions`   | Discussion questions for an OBS story                         |

## Argument Normalization

The MCP server accepts flexible argument shapes from LLMs that may not always
produce the exact parameter names defined in tool schemas:

- **Decomposed references**: `{book, chapter, verse}` → `reference` (`"JHN 3:16"`)
- **Path synonyms**: `word_id`, `article_id`, `term_id` → `path`
- **Language aliases**: `language_code`, `lang` → `language`
- **Null coercion**: `null` or array-typed `arguments` objects are treated as `{}`

This normalization happens in `src/mcp/normalizeToolArgs.ts` before Zod
validation, so tools never see malformed inputs.

## Architecture

```
Cloudflare Worker
├── /mcp  →  TranslationHelpsMCP (McpAgent Durable Object)
│            Streamable HTTP + SSE, structured outputs, trace IDs
└── /*    →  SvelteKit website (Workers Assets)
             Landing · Playground · Docs · Metrics
```

- **Transport**: Streamable HTTP + SSE via `McpAgent` (Cloudflare Durable Objects)
- **Storage**: KV (resource + catalog cache) + R2 (ZIP persistence)
- **Article discovery**: Lexical search over TA/TW catalogs (`search_articles`) — no vector store required
- **Observability**: Analytics Engine metrics, structured JSON logs

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

# Test (436 unit + contract tests)
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
