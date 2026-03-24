---
marp: true
theme: default
paginate: true
footer: Translation Helps MCP
style: |
  section { font-size: 28px; }
  code { font-size: 0.85em; }
---

# Translation Helps MCP

**What it is, what it does, and how to connect an OpenAI model**

---

## What is MCP?

**Model Context Protocol (MCP)** is a standard way for apps (IDEs, assistants, scripts) to give an LLM **structured tools**: list resources, fetch scripture, run lookups—instead of pasting huge text blobs into the chat.

- The **server** exposes **tools** and **prompts** over a defined protocol.
- The **client** (Cursor, Claude Desktop, or your own code) connects and lets the model **call** those tools when needed.

---

## What does _this_ MCP server do?

It connects AI assistants to **real Bible translation content** from **Door43 / DCS** (Door43 Content Service):

| You get                        | Examples                                             |
| ------------------------------ | ---------------------------------------------------- |
| Scripture                      | Multiple translations for a passage                  |
| Translation Notes              | Verse-level explanations (TSV-backed)                |
| Translation Words              | Term articles (by **path**, e.g. `bible/kt/grace`)   |
| Word links, Questions, Academy | Links in passage, comprehension Qs, training modules |
| Discovery                      | Languages, subjects, resources per language          |

**No mock data in production paths**—responses come from upstream catalogs and resources.

---

## Tools and prompts (at a glance)

**~9 tools** — e.g. `fetch_scripture`, `fetch_translation_notes`, `list_languages`, `list_resources_for_language`, plus word links, questions, translation word (**path**), translation academy (**path**).

**~5 prompts** — guided workflows (e.g. _translation helps for a passage_) so the model chains steps with sensible defaults.

Use **prompts** when you want one high-level task; use **tools** when you want explicit parameters.

---

## Two ways to use it

### 1. REST API (simplest to try)

`GET` or documented routes under the API base, e.g.:

```text
GET .../api/fetch-scripture?reference=John%203:16&language=en&format=json
```

Good for **curl**, scripts, and **fetch** from a web app.

### 2. MCP over HTTP (for LLM tool calling)

Post JSON-RPC-style requests to the **MCP endpoint** (same deployment: `/api/mcp` on the hosted site).

Good when your app lists tools and executes `tools/call` after the model chooses a tool.

---

## Production URLs (reference)

| Purpose     | Example                                         |
| ----------- | ----------------------------------------------- |
| Site + docs | `https://tc-helps.mcp.servant.bible/`           |
| Health      | `https://tc-helps.mcp.servant.bible/api/health` |
| REST        | `https://tc-helps.mcp.servant.bible/api/...`    |
| MCP         | `https://tc-helps.mcp.servant.bible/api/mcp`    |

_(Exact paths follow your deployment; always check `/api/health` first.)_

---

## Local development

From the repo:

```bash
cd ui && npm run dev
```

Default dev server (typical): **`http://localhost:8174`**

- REST: `http://localhost:8174/api/<endpoint>`
- MCP: `http://localhost:8174/api/mcp`

Run **health** before tests: `GET /api/health`.

---

## Connecting OpenAI: the idea

1. **Discover tools** — `POST` to MCP with `tools/list` (or use a fixed list from your build).
2. **Map** each MCP tool to an OpenAI **function** / **tool** schema (`name`, `description`, `parameters`).
3. **Chat** with `tools` enabled and `tool_choice: "auto"`.
4. When the model returns `tool_calls`, **execute** them by `POST`ing `tools/call` to the same MCP URL with the JSON arguments.
5. **Send tool results** back as `role: "tool"` messages and repeat until the model answers.

Same pattern works for **Azure OpenAI** (change base URL and API version).

---

## Minimal pattern (Node / fetch)

Concept only—adapt URLs and auth for your environment:

```javascript
const MCP_URL = "https://tc-helps.mcp.servant.bible/api/mcp";

async function mcpToolsList() {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  return res.json();
}

async function mcpToolCall(name, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return res.json();
}
```

Wire `mcpToolsList()` → OpenAI `tools: [...]`, then `mcpToolCall` inside your tool-execution loop.

---

## OpenAI Chat Completions (sketch)

```javascript
const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Fetch John 3:16 in English." }],
    tools: openAiToolsFromMcp, // built from tools/list
    tool_choice: "auto",
  }),
});
```

Parse `tool_calls` from the assistant message, run `mcpToolCall`, append results, **call the API again** until there are no more tool calls.

---

## Using Cursor (or similar) with this repo

Add an MCP server entry that runs the **stdio** server from the project (see your `mcp.json` pattern):

```json
{
  "mcpServers": {
    "translation-helps": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/translation-helps-mcp-2"
    }
  }
}
```

Then the editor’s AI can use the tools without writing HTTP glue—**remote HTTP** is for custom apps and hosted integrations.

---

## Good defaults for the model

- Prefer **organization** and **language** explicitly when comparing resources.
- For **translation words** and **academy**, use **`path`** (e.g. `bible/kt/grace`, `translate/figs-metaphor`) from word-links or notes—not deprecated `term` / `moduleId` alone.
- Use **`format=md`** on REST when you want markdown tuned for LLMs.

---

## Where to read more

- Repo **README** — features, deployment, quick `curl` examples.
- **HOW_TO_USE_PROMPTS.md** / **MCP_PROMPTS_GUIDE.md** — prompt workflows.
- **docs/MCP_LLM_REFERENCE_IMPLEMENTATION.md** — deeper LLM + MCP loop.

---

# Thank you

**Translation Helps MCP** — real translation resources for AI-assisted Bible translation workflows.
