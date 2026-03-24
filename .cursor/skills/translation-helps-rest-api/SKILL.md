---
name: translation-helps-rest-api
description: >-
  Use Translation Helps HTTP REST endpoints under /api/* instead of the MCP
  server at /api/mcp. Use when the user wants curl, scripts, fetch(), or
  server-side HTTP without MCP tooling; when integrating apps that do not speak
  MCP; or when comparing or replacing MCP with direct REST calls.
---

# Translation Helps: REST API instead of MCP

## When to use REST vs MCP

- **REST (`/api/...`)** — You choose the URL, query parameters, and order of calls. Use for **scripts, tests, mobile/web clients, backend jobs**, and any stack that speaks HTTP only.
- **MCP (`/api/mcp`)** — For **AI assistants** and hosts that discover **tools** and **prompts** through the Model Context Protocol. Same data often; different **interaction style**.

Do **not** assume MCP is required to access translation content. The SvelteKit app exposes **parallel REST routes** for the same capabilities.

## Base URLs

| Environment  | Origin                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| Hosted       | `https://tc-helps.mcp.servant.bible`                                   |
| Local UI dev | `http://localhost:8174` (default; confirm with `npm run dev` in `ui/`) |

All paths below are prefixed with the origin, e.g. `GET https://tc-helps.mcp.servant.bible/api/health`.

## MCP tool → REST route (quick map)

| MCP-style need                     | REST path                                        | Notes                                                      |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Health                             | `GET /api/health`                                | Cache/KV status often included                             |
| List languages                     | `GET /api/list-languages`                        | Query params per endpoint                                  |
| List subjects                      | `GET /api/list-subjects`                         |                                                            |
| Resources for a language           | `GET /api/list-resources-for-language`           |                                                            |
| Scripture                          | `GET /api/fetch-scripture`                       | `reference`, `language`, optional `organization`, `format` |
| Translation notes                  | `GET /api/fetch-translation-notes`               |                                                            |
| Translation questions              | `GET /api/fetch-translation-questions`           |                                                            |
| Word links in passage              | `GET /api/fetch-translation-word-links`          |                                                            |
| Translation word article           | `GET /api/fetch-translation-word`                | Often needs `path` from links                              |
| Translation Academy                | `GET /api/fetch-translation-academy`             | `path`, `language`, etc.                                   |
| Execute a **prompt** (MCP prompts) | `POST /api/execute-prompt`                       | Body with prompt name + args — see UI and docs             |
| Tool metadata / discovery          | `GET /api/list-tools`, `GET /api/tools-metadata` | Introspection without MCP                                  |

Exact query and body shapes match the SvelteKit `+server.ts` handlers under `ui/src/routes/api/<name>/`.

## Conventions agents should follow

1. Prefer **`docs/IMPLEMENTATION_GUIDE.md`** and **`docs/UW_TRANSLATION_RESOURCES_GUIDE.md`** for parameters (book codes, `organization`, `format=json|md`).
2. Use **3-letter USFM book codes** in `reference` where applicable (`JHN`, not `"John"`).
3. For **local development**, start the UI (`cd ui && npm run dev`) and hit `http://localhost:8174/api/health` first.
4. **MCP config** for IDEs is unrelated to REST — if the user says they do not use MCP, implement against **`/api/*`** only.

## Minimal smoke test (hosted)

```bash
curl -sS "https://tc-helps.mcp.servant.bible/api/health"
curl -sS "https://tc-helps.mcp.servant.bible/api/fetch-scripture?reference=JHN%203:16&language=en&format=json"
```

Adjust host for local dev.
