# Translation Helps MCP website redesign

- Date: 2026-10-28
- Branch: `feat/site-redesign`, from `unfoldingword/v2` (`f51a7f6a`)
- Scope: the website in `web/`. The server, the REST API and the tools do not change.
- Reference: the obs-5m-mcp site redesign (unfoldingWord/obs-5m-mcp#22).

## Goal

The site explains what translation helps are and lets anyone see them work, without an AI model. It also tells developers how to connect the MCP server, the REST API and the SDKs.

It has two audiences in equal measure:
- developers who connect the MCP server or the REST API;
- translation people who want to know which resources exist and see them in use.

The chat leaves the site. Its code stays in the repository, outside the build, as the seed of a separate product with its own website. That product gets its own spec later.

## Decisions

| Topic | Decision |
|---|---|
| Line | `v2` (production from 2026-10-29). v1 (`main`, `ui/`) is not changed. |
| Name | **Translation Helps MCP**, bold and large. A line under it says what it is: unfoldingWord's translation helps for any AI assistant. |
| Look | Same family as the OBS-TF MCP site, with its own accent colour (see Style). |
| Approach | Rebuild `web/` from a clean slate on the same technical base (SvelteKit, `@sveltejs/adapter-cloudflare`, base path `/v2`). Old pages and styles are not reused. |
| Chat | Moved to `chat/` at the repository root, not built. `/chat` redirects to `/try`. |
| System pages | `/status` and `/metrics` stay, redesigned, linked from the footer only. `/debug` inspects chat traces, so it moves with the chat. |
| Try | Guided walk through one passage and all its helps, plus a Tools tab. |

## Site map

| Path | Content |
|---|---|
| `/` | Hero with the name and the one-line summary. A sample passage "anatomy": the verse with its notes, key terms, questions and Academy articles, each piece labelled with the tool that returns it. Then "What are translation helps", connect in three steps, and links to the official sources (unfoldingWord, Door43). |
| `/try` | Two tabs: **Guided** (one passage and all its helps) and **Tools** (run any of the 13 tools). |
| `/connect` | Per-client setup (Claude Desktop and Claude Code, Cursor, VS Code, ChatGPT, others), the MCP URL, the REST API base URL, the SDKs. |
| `/tools` | Tool reference generated at build time from `src/mcp/toolRegistry.ts`: name, title, description, arguments, an example call, a link to run it in Try. |
| `/docs` | Overview of the docs. |
| `/docs/resources` | Each resource: ULT, UST, Translation Notes, Translation Words and Word Links, Translation Questions, Translation Academy, OBS and its helps. What it is, who it is for, the licence, the Door43 link. |
| `/docs/workflow` | The order the server recommends: passage, context, passage index, then each help, then questions. Why it saves tokens. |
| `/docs/api` | The REST API, from `src/api/manifest` as today. |
| `/docs/sdks` | JavaScript/TypeScript and Python SDKs, and the `@translation-helps/*` library packages. |
| `/docs/languages` | How languages and organisations are found (`list_languages`, `list_resources`), and what language packs are. |
| `/docs/limits` | Rate limit (90 requests per minute by default), response sizes, `RESOURCE_NOT_AVAILABLE` with `isError: false`, upstream errors. Only fields the server sends. |
| `/status` | Health of the REST API, the MCP endpoint and each tool. No chat check. |
| `/metrics` | Request metrics from `/api/metrics`, restyled. |
| `/chat`, `/playground`, `/rag` | Redirect to `/try` (old links keep working). |

Every page works at phone width (375 px) with no horizontal scroll.

## Try

### Guided tab: one passage and all its helps

The steps follow the server's own workflow, so the walk shows both what exists and how an assistant asks for it.

1. **Pick.** Language (from `list_languages`) and passage, typed as `John 3:16`. Ready examples: John 3:16, Ruth 1:1-5, Titus 1:1.
2. **Text.** `get_passage` shows every version the language has (ULT and UST in English). A missing book shows the server's message, including the books that are available.
3. **Context.** `get_passage_context` gives the background.
4. **Map of helps.** `get_passage_index` lists the notes, key terms and Academy topics for the passage, without bodies. Each row is a button.
5. **Go deeper.** Pressing a row opens `get_note` (the full note, by `id`), `get_academy_article` (by `taArticle.path`) or `get_word_article` (by `twArticle.path`).
6. **Check.** `get_questions` returns the comprehension questions for the passage.

OBS has a short walk of its own in the same tab: `get_obs_story`, then `get_obs_notes` and `get_obs_questions`.

Each step shows:
- the exact call (tool and arguments), its size and time;
- three views: Rendered, JSON, JSON-RPC;
- "Open in Tools", with the same arguments ready to edit.

The state (tab, language, passage, step, open item) is in the URL hash, so a link reopens the same view. A broken or old link opens the guided tab.

On a phone, choosing something scrolls its result into view.

### Tools tab

- Pick any tool. Arguments come from the tool's live `inputSchema` (`tools/list`).
- Ready examples per tool. An example shows only when the live schema has the arguments it needs.
- "Copy as": curl (two steps: `initialize`, then `tools/call`, with `--max-time`), JSON-RPC body, MCP client config.
- Article search (`search_articles`, today the `/rag` page) is one of the tools here.

### Errors

- Missing language, book or passage: the server's `RESOURCE_NOT_AVAILABLE` message, shown as an answer, not as a failure.
- Rate limit (429): a notice with the wait time and a retry button.
- Network error or time-out (30 s): a message with a retry button.

## How the browser calls the server

- The browser calls the MCP endpoint on the same origin (`<origin>/v2/mcp`), read from `window.location.origin` at call time.
- The client is adapted from obs-5m-mcp `web/src/lib/mcp/client.ts`:
  - it reads SSE incrementally and stops at the response with the matching id, because the server can keep a stream open;
  - it sends one request at a time;
  - it keeps the `mcp-session-id`;
  - each request times out after 30 seconds.
- In local `vite dev`, where the Worker is not running, the client falls back to `/api/mcp-proxy`, which already runs the tools in-process.

## The chat moves to `chat/`

- **Moves** to `chat/` at the repository root, keeping the `web/src/...` folder layout:
  - `routes/chat/*`, `routes/api/chat/*`, `routes/api/agent/*`, `routes/(system)/debug/*`;
  - `lib/components/chat/*`, `lib/components/ui/*` (context quiz, phrase drill, challenge cards, draft workspace, checking checklist, note, word and scripture panels, resource workbench and threads), `lib/components/debug/*`;
  - `lib/server/agents/*`, `lib/server/skillChat.ts`, `lib/server/traceEvents.ts`, and `lib/server/i18n.ts` if only the chat uses it;
  - `lib/stores/*` (study session, drafts, checking checklist, session persistence);
  - any other file in `web/` that only the chat imports.
- **The chat's tests** move with it and stop running in CI, so they cannot fail on broken imports.
- **`chat/README.md`** says:
  - what the chat does;
  - that it is not built or deployed;
  - which repository code it depends on: `src/core/harness`, which stays where it is, and the `/api/tool` route;
  - that it is the seed of the new product.
- **Stays in `web/`:**
  - `/api/tool`, used by `/status` and needed later by the chat product;
  - `/api/metrics`, used by `/metrics`;
  - `/api/mcp-proxy`, the local-dev fallback for Try;
  - `/api/languages`, only if a page still uses it; otherwise it moves.
- **TypeScript, ESLint, Prettier and Vitest** exclude `chat/`.
- **The site no longer needs `OPENAI_API_KEY`.** Removing the secret from Cloudflare is the owner's decision, not part of this work.

## Style

Same family as the OBS-TF MCP site:
- the same type, a layout in the Sentry/Exa style, colour tokens on `:root` with a dark mode, and the same components (cards, code blocks, result viewer, tabs);
- the same icons (`lucide-svelte`).

What is its own:
- **Accent:** indigo ink, roughly `#2b4a7a` in light mode and `#8fb3e8` in dark mode. The second colour is a rubric red, roughly `#a2452f`. The OBS-TF accent is green and gold, so the two sites read as siblings, not as one site. Final values must pass WCAG AA contrast on both backgrounds.
- **Visual motif:** alignment. A Greek or Hebrew quote joined to the English words that translate it, taken from `quote.original` and `quote.aligned` in real `get_passage_index` rows. It is used in the hero and the anatomy, and needs no licensed artwork.

## Tests

- **Vitest** for the site's logic, copied and adapted from obs-5m-mcp with its tests:
  - MCP client;
  - hash state;
  - copy-as;
  - argument building from schemas;
  - guided-step building from a passage index.
- **Playwright**, against `wrangler dev` of the MCP Worker and the API Worker, with real MCP sessions:
  - the guided walk on John 3:16 reaches every step;
  - a note row opens the note;
  - a tool runs from the Tools tab;
  - a broken shared link opens the guided tab;
  - `/chat` redirects to `/try`;
  - no horizontal scroll at phone width on every page;
  - on a phone, choosing something shows its result.
- **The repository's CI stays green:** `npm run lint`, `npm run test:ci`, `npm run typecheck`, `svelte-check`, and the web build.

## Delivery

- The work happens in the sibling worktree `translation-helps-mcp-site`, with local commits per task. Another session works on #67 in `translation-helps-mcp-packs`; this work does not touch it.
- **The pull request** goes against `v2`, after the production switch on 2026-10-29. It is pushed only with the owner's OK.
- **A preview** of the branch runs as a separate Worker, like obs-5m-mcp PR #18, only with the owner's OK.
- **Merging to `v2` does not deploy.** Deploying to staging or production is a separate step, with the owner's OK.
- **No changeset is needed:** `translation-helps-mcp-web` is in the changesets `ignore` list. The server version does not change.

## Out of scope

- The new chat product: name, website, quizzes. It gets its own spec.
- v1 (`main`, `ui/`, the Pages project).
- Server, tool or REST API changes. If the redesign finds a server bug, it is reported as an issue, not fixed here.
- Removing Cloudflare secrets or changing deployment configuration.
