# Translation Helps MCP

**Door43 translation content for AI assistants — MCP and a full HTTP REST API**

---

## In one sentence

We give **assistants** and **apps** reliable access to **scripture, notes, questions, terms, and training** from the Door43 world — **structured**, not copy-paste from the web. Same capabilities over **MCP** (`/api/mcp`) or **REST** (`/api/...`) — use whichever fits your stack.

---

## Why MCP? (short version)

**Parable:** You ask someone to **drive a nail** but give no **hammer** — lots of talk, no finish.

**MCP** hands the assistant a **small rack of named tools** (fetch scripture, list languages, …) instead of open-ended access. **Translation Helps** is that rack for Bible translation content.

---

## What you get

|                       |                       |
| --------------------- | --------------------- |
| **Scripture**         | Passages you choose   |
| **Notes & questions** | Verse-level helps     |
| **Key terms**         | Terms + articles      |
| **Training**          | Academy articles      |
| **Discovery**         | Languages & resources |

Real published data — not mocks.

---

## Door43 vs this server

**Door43 / DCS** = where **repos and files** live (source of truth).

**Translation Helps** = **workflow layer** on top: one API shape for common tasks, discovery endpoints, JSON/MD/TSV as needed, plus validation and caching — so you **don’t** rewire catalog + ZIP + USFM/TSV **yourself** for every integration.

**Raw DCS API?** Fine for deep work on repos. For “helps for this verse in this language,” you’d still **glue** many steps. We’re the **fast path** for that job.

---

## Endpoint surface (why “small” matters)

|                     | **[DCS (Gitea) API](https://git.door43.org/api/swagger)** | **[TC Helps — MCP Tools](https://tc-helps.mcp.servant.bible/mcp-tools)** |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Role**            | Whole platform: repos, users, issues, releases, hooks, …  | **Translation helps** only: scripture, notes, words, discovery, …        |
| **OpenAPI paths**   | **~312** (Swagger `paths`; version tracks Gitea/DCS)      | **11** MCP tools + **6** prompts (curated for this product)              |
| **HTTP operations** | **~484** (GET/POST/PUT/… across those paths)              | **One** MCP HTTP entry + separate **REST** routes for the same fetches   |

Same Door43 **content** underneath — different **scope**: encyclopedia vs **short menu** tuned for translators and AI.

_DCS counts from the published OpenAPI at [git.door43.org](https://git.door43.org/api/swagger) (~v1.25.x). TC Helps counts from the live tool + prompt registry._

---

## REST or MCP?

|                | **REST** (`/api/...`) | **MCP** (`/api/mcp`) |
| -------------- | --------------------- | -------------------- |
| **Who drives** | You or your script    | The assistant        |
| **Best for**   | Known steps, CI, curl | Chat, IDE, Inspector |

Same deployment — **same content** behind both.

---

## Where to try

|            |                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------- |
| **Site**   | `https://tc-helps.mcp.servant.bible/`                                                          |
| **Health** | `.../api/health`                                                                               |
| **REST**   | `.../api/fetch-scripture`, `.../api/list-languages`, etc. — **curl**, scripts, any HTTP client |
| **MCP**    | `.../api/mcp`                                                                                  |

_Local: `cd ui && npm run dev` → often `http://localhost:8174` — same **`/api/*`** REST routes and MCP on one host._

---

## Code & packages

|                             |                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**              | **[unfoldingWord/translation-helps-mcp](https://github.com/unfoldingWord/translation-helps-mcp)** — open source: SvelteKit UI, MCP + REST API, docs, tests, examples               |
| **JavaScript / TypeScript** | **[`@translation-helps/mcp-client`](https://www.npmjs.com/package/@translation-helps/mcp-client)** (npm) — typed client for hosted or self-run servers; wraps tool calls over HTTP |
| **Python**                  | **[`translation-helps-mcp-client`](https://pypi.org/project/translation-helps-mcp-client/)** (PyPI) — async client (`httpx`), optional adapters for OpenAI-style tool lists        |

_Install:_ `npm install @translation-helps/mcp-client` · `pip install translation-helps-mcp-client` · more packages live under **`packages/`** and **`clients/`** in the repo.\_

---

## Live demo (3 minutes)

1. **Inspector:** `npx @modelcontextprotocol/inspector` → connect to **`.../api/mcp`**
2. **`list_languages`** — show real data
3. **`fetch_scripture`** — `JHN 3:16`, `en` — add optional notes or words if time

---

## Extras (if time)

- **Prompts** — bundled workflows (e.g. passage report). See **`MCP_PROMPTS_GUIDE.md`**
- **Repo example** — `examples/mcp-chat-demo` — chat + LLM + MCP

---

## Demo tips

- Book codes: **`JHN`**, **`TIT`** — not full book names in parameters
- Often **omit** `organization` unless you need one publisher

---

## Close

**What to do next:** open the site, hit **`/api/health`**, try one **REST** `GET` (e.g. **`fetch-scripture`**) or run Inspector + MCP **`fetch_scripture`** once.

---

# Thank you

**Translation Helps MCP** — trusted content, **MCP + REST**, simple tools.
