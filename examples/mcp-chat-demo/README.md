# OpenAI + Translation Helps MCP (demo)

Minimal **React + Vite** chat UI plus a small **Express** API that:

1. Calls **OpenAI** (`chat.completions` with tool calling) using **`OPENAI_API_KEY`** from the repo (usually the root `.env`).
2. Talks to this project’s MCP server with **`fetch` only** on the server — no `@translation-helps/mcp-client` SDK (`server/mcpHttp.ts`).

The browser never sees your API key; only the local Node process does.

## Prerequisites

- **Node 18+**
- **`OPENAI_API_KEY`** — same places as the main **Svelte** app: preferably the **repository root** `.env` (see root `.env.example`), or **`ui/.env`** (where SvelteKit/Vite loads `OPENAI_API_KEY` for `routes/api/chat-stream`). The demo loads both, then `examples/mcp-chat-demo/.env` (see `server/env.ts`).
- **MCP URL** reachable from your machine (default: hosted Translation Helps MCP). For local UI + local MCP, use `http://localhost:8174/api/mcp` while `cd ui && npm run dev` is running.

## Run

```bash
cd examples/mcp-chat-demo
npm install
npm run dev
```

This runs **Vite on port 5274** and mounts the Express **`/api`** routes **on the same dev server** (no second terminal, no proxy to another port).

Open the printed URL (e.g. `http://localhost:5274`).

Optional env (repo root `.env` or `examples/mcp-chat-demo/.env`):

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
MCP_URL=https://tc-helps.mcp.servant.bible/api/mcp
```

Optional client env (Vite):

```bash
VITE_MCP_URL=http://localhost:8174/api/mcp npm run dev
```

### Advanced

- **`npm run dev:split`** — Vite + separate API on **5275** (same as older setup).
- **`npm run build && npm run preview`** — static client only; **`/api` is proxied to 5275**. In another terminal run **`npm run dev:server`** so the API is available, or use **`npm run dev`** for local testing instead.

## What to demo

1. Confirm **OpenAI key: configured** and **MCP: reachable** after load.
2. Ask for scripture or notes; the model calls MCP tools until it returns a final answer.

## Limitations

- Tool and result size depend on the chosen **OpenAI** model context window.
- Production **`vite preview`** does not embed the API; use **`npm run dev`** for demos, or run **`dev:server`** alongside **`preview`**.
