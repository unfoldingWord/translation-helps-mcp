# Translation Helps MCP Website Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `web/` as a clean-slate site in the OBS-TF MCP family, with a guided walk through one passage and all its helps, and move the chat out of the build into `chat/`.

**Architecture:** SvelteKit with `@sveltejs/adapter-cloudflare` under base path `/v2`, served by the existing Worker (`src/worker.ts` falls through to SvelteKit). Content pages are prerendered. The browser calls the MCP endpoint on the same origin (`<origin>/v2/mcp`) with a small client adapted from obs-5m-mcp. Site logic lives in plain TypeScript modules under `web/src/lib/`, tested by the root Vitest run in `tests/web/`. Components stay thin.

**Tech Stack:** Svelte 5 (runes), SvelteKit 2, Tailwind CSS v4, lucide-svelte, Vitest (root config), Playwright (`@playwright/test`, already in `web/`).

**Spec:** `docs/superpowers/specs/2026-10-28-site-redesign-design.md`

**Reference implementation:** the obs-5m-mcp site at `C:/Users/LENOVO/Git/Github/obs-5m-mcp-builds/web` (its `master`), with its tests in `C:/Users/LENOVO/Git/Github/obs-5m-mcp-builds/tests/web` and `tests/e2e`. "Adapt from obs `<path>`" means read that file, keep its behaviour and its tests, and change only what this plan says.

## Global Constraints

- Work only in the worktree `C:/Users/LENOVO/Git/Github/translation-helps-mcp-site`, on branch `feat/site-redesign`. Never touch `translation-helps-mcp-packs` (another session's #67 work) or `translation-helps-mcp-2`.
- Commit locally at the end of each task. Never push, open a PR, deploy, or create Cloudflare resources.
- The server, the REST API, the tools and `src/` do not change. A server bug found along the way is written down for an issue, not fixed.
- Base path stays `/v2` (`web/svelte.config.js`). Every internal link uses `base` from `$app/paths`.
- Name: **Translation Helps MCP**. One-line summary: "unfoldingWord's translation helps for any AI assistant."
- Accent: indigo ink, about `#2b4a7a` (light) and `#8fb3e8` (dark). Second colour: rubric red, about `#a2452f`. Final values pass WCAG AA on both backgrounds.
- Every page: no horizontal scroll at 375 px.
- The site needs no AI model and no `OPENAI_API_KEY`.
- English UI copy, short and plain.
- Licences: unfoldingWord resources are CC BY-SA 4.0. Every page that shows their content links to its Door43 source.
- No changeset (the web package is in the changesets `ignore` list). No server `VERSION` change.

## Review Focus

1. **The same tool called twice by a fast double click or a quick step change.** The page should show the latest answer only, never a stale one, and never fire repeated calls. Test in Task 5 (`GuidedWalk` ignores a superseded answer).
2. **A passage with no notes or no key terms (e.g. a verse with an empty index).** The map step should say "No notes for this passage" instead of an empty box, and "Go deeper" should be skipped. Test in Task 5.
3. **A language with no ULT/UST** (e.g. `es-419`). The text step shows the server's `RESOURCE_NOT_AVAILABLE` message with the books available, as an answer, and the walk can continue to the other steps. Test in Task 5.
4. **An old shared link** (`#…` from the previous playground, or a hash that is not base64 JSON). It opens the guided tab, never a blank page. Test in Task 3.
5. **Local dev without the Worker running.** `npm run dev` alone must show a clear "Can't reach the server at …" message on Try, not a hang. Test in Task 3 (`classifyOutcome` on a network error) and the 30 s timeout.

---

## File Structure

```
chat/                                   (moved, not built)
  README.md
  web/src/...                           same layout as before the move
  tests/unit/...                        chat-only tests that imported web code
web/
  src/app.css                           tokens, light/dark, base styles (new)
  src/app.html                          (rewritten)
  src/routes/+layout.svelte, +layout.ts (new; prerender = true)
  src/routes/+page.svelte               home
  src/routes/try/+page.svelte
  src/routes/connect/+page.svelte
  src/routes/tools/+page.server.ts, +page.svelte
  src/routes/docs/+layout.svelte, +page.svelte
  src/routes/docs/{resources,workflow,api,sdks,languages,limits}/+page.svelte (+ api/+page.server.ts)
  src/routes/(system)/status/+page.svelte, metrics/+page.svelte (prerender = false)
  src/routes/{chat,playground,rag}/+page.server.ts   redirect to /try
  src/lib/site.ts                       SITE, nav, endpointFor
  src/lib/theme.ts, reveal.ts, markdown.ts
  src/lib/mcp/{client,outcome,session}.ts
  src/lib/endpoint.ts
  src/lib/try/{hashState,fields,copyAs,rendered,presets}.ts
  src/lib/try/guided.ts                 guided-walk logic (pure)
  src/lib/try/obs.ts                    OBS mini-walk logic (pure)
  src/lib/try/{GuidedWalk,ObsWalk,ToolRunner}.svelte
  src/lib/components/{SiteHeader,SiteFooter,ThemeToggle,Button,Callout,CodeTabs,CopyPill,Markdown,ResultViewer,ToolForm,AlignedQuote}.svelte
  src/lib/home/{anatomy.ts,snapshot.json,AnatomyExplorer.svelte}
  src/lib/catalog.ts                    tool reference from the MCP manifest
  src/lib/connect/clients.ts
  src/lib/resources.ts                  the resource family, for home + /docs/resources
  playwright.config.ts, tests/e2e/site.spec.ts
scripts/capture-home-snapshot.ts        writes web/src/lib/home/snapshot.json from a live server
tests/web/*.test.ts                     site logic tests (root Vitest picks up tests/**)
```

`web/src/lib/renderMarkdown.ts` stays in `web/` (Try renders notes and articles with it) and so does its test `tests/unit/render-markdown-rc.test.ts`. The chat's copy imports it from `web/`.

---

### Task 1: Move the chat out of the build

**Files:**
- Move (with `git mv`, keeping paths under `chat/web/src/`): `web/src/routes/chat/*`, `web/src/routes/api/chat/*`, `web/src/routes/api/agent/*`, `web/src/routes/(system)/debug/*`, `web/src/lib/components/chat/*`, `web/src/lib/components/ui/*`, `web/src/lib/components/debug/*`, `web/src/lib/server/agents/*`, `web/src/lib/server/skillChat.ts`, `web/src/lib/server/traceEvents.ts`, `web/src/lib/stores/*`, and every other `web/src` file that, after these moves, nothing left in `web/src` imports (check `web/src/lib/server/i18n.ts`, `web/src/lib/server/runTool.ts`, `web/src/routes/api/languages`, `web/src/lib/JsonViewer.svelte`).
- Create: `chat/README.md`, `web/src/routes/chat/+page.server.ts` (redirect).
- Modify: `web/src/routes/(system)/status/+page.svelte` (remove the chat SSE check only; the redesign is Task 9), `web/src/routes/+page.svelte` and `web/src/routes/+layout.svelte` (remove links to `/chat`), root `.prettierignore` / `eslint.config.*` / `tsconfig.json` / `vitest.config.ts` only if they would otherwise pick up `chat/`.
- Test: any root test under `tests/` that imports a moved file moves to `chat/tests/unit/`.

**Interfaces:**
- Produces: `/chat` answers `308` to `${base}/try`. `web/` no longer contains chat code. `chat/README.md` lists what the chat depends on outside `chat/`: `src/core/harness/*`, `web/src/lib/renderMarkdown.ts`, the Worker's `/v2/api/tool`.

- [ ] **Step 1:** List importers. Run `git grep -n -E "components/(ui|chat|debug)|server/(agents|skillChat|traceEvents)|lib/stores|api/(chat|agent)" -- web/src tests` and record every file outside the move list that imports one of them.
- [ ] **Step 2:** `git mv` the files in the list. Remove the `/chat` links and the chat SSE check named above.
- [ ] **Step 3:** Write `web/src/routes/chat/+page.server.ts` exporting `load` that throws `redirect(308, `${base}/try`)` (`base` from `$app/paths`), with `export const prerender = false`. `/try` does not exist yet, which is expected: Task 4 adds it.
- [ ] **Step 4:** Write `chat/README.md`: what the chat does (OpenAI chat with scholar and checker agents, context quizzes, phrase drills, draft workspace, checking checklist), that it is not built, tested or deployed, its dependencies (above), and that it is the seed of a separate product.
- [ ] **Step 5:** Verify:
  - `npm ci` succeeds.
  - `npm run typecheck` passes.
  - `npx svelte-check --tsconfig ./tsconfig.json` passes, run in `web/`.
  - `npm run lint` passes.
  - `npm run test:ci` passes, with the same count as before minus the moved tests.
  - `npm run build` passes.
  - `git grep -n -E "from ['\"][^'\"]*(components/(ui|chat|debug)|skillChat|traceEvents|lib/stores)" -- web/src` prints nothing.
- [ ] **Step 6:** Commit: `Move the chat out of the website into chat/`.

### Task 2: Clean slate, design tokens and site shell

**Files:**
- Delete: every remaining route under `web/src/routes` except `api/tool`, `api/metrics`, `api/mcp-proxy`, `(system)/status`, `(system)/metrics`, `chat/+page.server.ts`; delete `web/src/lib/components/docs/*`, `web/src/lib/paths.ts` once nothing imports them, and old styles in `web/src/app.css`.
- Create: `web/src/app.css`, `web/src/app.html`, `web/src/routes/+layout.svelte`, `web/src/routes/+layout.ts`, `web/src/routes/+page.svelte` (placeholder hero only; Task 7 fills it), `web/src/routes/{playground,rag}/+page.server.ts` (redirects), `web/src/lib/site.ts`, `web/src/lib/theme.ts`, `web/src/lib/reveal.ts`, `web/src/lib/components/{SiteHeader,SiteFooter,ThemeToggle,Button,Callout,CodeTabs,CopyPill}.svelte`.
- Adapt from obs: `web/src/app.css`, `app.html`, `lib/site.ts`, `lib/theme.ts`, `lib/reveal.ts`, `lib/components/*` (the ones listed), `routes/+layout.svelte`.
- Test: `tests/web/site.test.ts`.

**Interfaces:**
- Produces:
  - `SITE: { name: 'Translation Helps MCP'; tagline: string; repo: 'https://github.com/unfoldingWord/translation-helps-mcp'; door43: 'https://git.door43.org/unfoldingWord' }`.
  - `nav: { href: string; label: string }[]` = Try, Connect, Tools, Docs (paths without base).
  - `footerNav` = Status, Metrics, GitHub, Door43.
  - `endpointFor(origin: string): string` returns `${origin}/v2/mcp`.
  - CSS tokens `--bg --surface --ink --ink-2 --line --line-strong --accent --accent-2 --on-accent --danger`, as Tailwind theme colours `bg surface ink ink-2 line line-strong accent accent-2 on-accent danger`, same names as obs.

- [ ] **Step 1: Write the failing test** `tests/web/site.test.ts`:
  - `endpointFor('https://x.dev')` is `'https://x.dev/v2/mcp'`;
  - `nav.map(n => n.label)` equals `['Try','Connect','Tools','Docs']`;
  - `SITE.name` is `'Translation Helps MCP'`.
- [ ] **Step 2:** Run `npx vitest run tests/web/site.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the files above.
  - **`app.css`:** the tokens with the accent values from Global Constraints; dark mode by `prefers-color-scheme`, overridable by `data-theme`, as in obs.
  - **`+layout.ts`:** `export const prerender = true; export const trailingSlash = 'never';`.
  - **`(system)/*`:** set `export const prerender = false` in their `+page.ts`.
  - **Redirects:** `/playground` and `/rag` redirect with `308` to `${base}/try` like `/chat`.
  - **Header:** the name in bold as a wordmark, and a "Connect" button.
- [ ] **Step 4:** Run the test (PASS), then `npm run build` and `npx svelte-check` in `web/` (0 errors).
- [ ] **Step 5:** Commit: `Start the website from a clean slate with the site shell`.

### Task 3: Browser MCP client, outcome and Try state

**Files:**
- Create: `web/src/lib/mcp/client.ts`, `web/src/lib/mcp/outcome.ts`, `web/src/lib/mcp/session.ts`, `web/src/lib/endpoint.ts`, `web/src/lib/try/hashState.ts`.
- Modify: `web/vite.config.ts` (add `'/v2/mcp'` to `server.proxy`, same target as `'/mcp'`).
- Adapt from obs: `lib/mcp/client.ts`, `lib/mcp/outcome.ts`, `lib/mcp/session.ts`, `lib/try/hashState.ts`, and its tests `tests/web/mcp-client.test.ts`, `tests/web/try-state.test.ts`.
- Test: `tests/web/mcp-client.test.ts`, `tests/web/try-state.test.ts`.

**Interfaces:**
- Produces (types as in obs `client.ts`): `JsonSchema`, `Exchange`, `ToolInfo`, `CallResult`, `McpHttpError`, `McpHttpClient` (constructor `(endpoint: string, fetchImpl?: typeof fetch)`; `initialize()`, `listTools(): Promise<ToolInfo[]>`, `callTool(name, args): Promise<CallResult>`), `Outcome`, `classifyOutcome(...)`, `connect(endpoint): Promise<ToolInfo[]>`, `RunResult`, `run(endpoint, tool, args): Promise<RunResult>`, `hasParam(tools, tool, param): boolean`.
- `endpoint(): string` returns `endpointFor(window.location.origin)` in the browser at call time, `endpointFor(DEFAULT_ORIGIN)` on the server. `DEFAULT_ORIGIN = 'https://translation-helps-mcp-v2.unfoldingword.workers.dev'`.
- `TryState = { tab: 'guided' | 'obs' | 'tools'; tool?: string; args?: Record<string, unknown>; lang?: string; ref?: string; step?: GuidedStepId; open?: { kind: 'note' | 'academy' | 'word'; key: string }; story?: number }`. `encodeTryState(s): string` (`'#'` + base64url JSON), `decodeTryState(hash, knownTools): TryState`. `GuidedStepId` comes from Task 5. Declare it here as `'pick' | 'text' | 'context' | 'map' | 'deeper' | 'check'`, and Task 5 imports it from this file.

- [ ] **Step 1: Write the failing tests.** Port obs's tests unchanged in behaviour. Add:
  - `classifyOutcome({ status: 200, result })` with `structured.code === 'RESOURCE_NOT_AVAILABLE'` or text starting `RESOURCE_NOT_AVAILABLE` gives `{ kind: 'not-available', message }`. Check which field the server puts the code in by calling `get_passage` for `es-419` John 3:16 against staging once, and write the fixture from that answer.
  - `classifyOutcome({ status: 0, error: new TypeError('Failed to fetch') })` gives `{ kind: 'error', message }` whose message starts with `Can't reach the server at`.
  - `decodeTryState('#not-base64', tools)` and `decodeTryState('#' + btoa('{"tab":"chat"}'), tools)` both give `{ tab: 'guided' }`.
  - Round trip of `{ tab: 'guided', lang: 'en', ref: 'John 3:16', step: 'map' }`.
- [ ] **Step 2:** Run `npx vitest run tests/web/mcp-client.test.ts tests/web/try-state.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Adapt the modules. `classifyOutcome` gets the endpoint for the network-error message (`Can't reach the server at ${endpoint}`).
- [ ] **Step 4:** Run the tests (PASS).
- [ ] **Step 5:** Commit: `Add the browser MCP client and the Try page state`.

### Task 4: Try page with the Tools tab

**Files:**
- Create: `web/src/routes/try/+page.svelte`, `web/src/lib/try/ToolRunner.svelte`, `web/src/lib/try/fields.ts`, `web/src/lib/try/copyAs.ts`, `web/src/lib/try/rendered.ts`, `web/src/lib/try/presets.ts`, `web/src/lib/components/{ToolForm,ResultViewer,Markdown}.svelte`, `web/src/lib/markdown.ts`.
- Adapt from obs: the same names, and its tests `tests/web/copy-as.test.ts`, `tests/web/markdown.test.ts`, the field tests in `tests/web/review-fixes.test.ts`.
- Test: `tests/web/fields.test.ts`, `tests/web/copy-as.test.ts`, `tests/web/rendered.test.ts`, `tests/web/presets.test.ts`.

**Interfaces:**
- Consumes: Task 3 client, session, outcome, hashState, endpoint.
- Produces:
  - `Preset = { label: string; tool: string; args: Record<string, unknown>; needs?: string[] }`, and `PRESETS: Preset[]` with at least one per tool;
  - `visiblePresets(tools: ToolInfo[]): Preset[]`, which keeps a preset only when the tool exists and every name in `needs` is in its live schema;
  - `ResultViewer` props `{ tool: string; result: CallResult | null; outcome: Outcome | null; pending: boolean; onretry: () => void }`;
  - the Try page tabs Guided / OBS / Tools, driven by `TryState`.
- `markdown.ts` `renderMarkdown(md)` wraps `web/src/lib/renderMarkdown.ts` (Door43 rc links) and sanitizes with DOMPurify. It does not use obs's version.

- [ ] **Step 1: Write the failing tests.**
  - **Fields and copy-as:** ported from obs.
  - **`rendered.test.ts`:** a `get_note` result renders as markdown; a `list_languages` result renders as a JSON summary.
  - **`presets.test.ts`:** each `PRESETS` entry's `tool` is in `TOOL_REGISTRY` (import from `../../src/mcp/toolRegistry.js`); every name in `needs` is a property of that tool's input schema (`zod-to-json-schema` of `inputSchema`, as `src/mcp/manifest.ts` builds it); `visiblePresets` drops a preset whose `needs` the live schema lacks.
  - **Search:** a preset for `search_articles` exists, which replaces `/rag`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - The Try page connects once (`connect(endpoint())`), shows "Connected · N tools", and writes `TryState` to the hash on every change (`history.replaceState`).
  - The Tools tab: tool picker, form from the live schema, presets, Run, ResultViewer (Rendered / JSON / JSON-RPC), Copy as (curl, JSON-RPC, MCP config).
  - The Guided and OBS tabs show placeholders until Tasks 5 and 6.
- [ ] **Step 4:** Run the tests (PASS). Then run the site locally:
  - `npm run dev:api` (8788), then `npm run dev:worker` (8787) after `npm run build`.
  - Open `http://localhost:8787/v2/try#…tools…`, run `get_passage {"reference":"John 3:16","language":"en"}`, and see ULT and UST.
  - Stop both servers.
- [ ] **Step 5:** Commit: `Add the Try page with a tool runner`.

### Task 5: Guided walk: one passage and all its helps

**Files:**
- Create: `web/src/lib/try/guided.ts`, `web/src/lib/try/GuidedWalk.svelte`.
- Test: `tests/web/guided.test.ts`, with fixtures `tests/web/fixtures/passage-index-john-3-16.json` and `tests/web/fixtures/passage-index-empty.json`. Capture the first from staging (`get_passage_index {"reference":"John 3:16","language":"en"}`, `structuredContent`). Write the second by hand, with empty `notes`, `words`, `issues` and `keyTerms`.

**Interfaces:**
- Consumes: `GuidedStepId` and `TryState` (Task 3), `run`, `ResultViewer` (Task 4).
- Produces:
  - `GUIDED_STEPS: { id: GuidedStepId; title: string; tool: string | null }[]`, in the order pick / text `get_passage` / context `get_passage_context` / map `get_passage_index` / deeper (tool depends on the row) / check `get_questions`;
  - `EXAMPLES = ['John 3:16', 'Ruth 1:1-5', 'Titus 1:1']`;
  - `stepCall(step: GuidedStepId, lang: string, ref: string): { tool: string; args: Record<string, unknown> } | null` (null for `pick` and `deeper`);
  - `mapRows(index: unknown): { kind: 'note' | 'academy' | 'word'; key: string; label: string; quote?: { original: string; aligned: string } }[]`. A note row has key `id`, label `taArticle.title ?? 'Note'`, and its `quote`. An academy row comes from `issues[]`: key `path`, label `` `${title} (${count})` ``. A word row comes from `keyTerms[]`: key `path`, label `` `${title} (${count})` ``.
  - `deeperCall(row, lang): { tool: string; args: Record<string, unknown> }`: `get_note {id, language}`, `get_academy_article {path, language}`, `get_word_article {path, language}`. Check the argument names against each tool's `inputSchema` in `src/mcp/tools/`, and use those names.

- [ ] **Step 1: Write the failing tests** in `tests/web/guided.test.ts`:
  - `GUIDED_STEPS.map(s => s.id)` equals `['pick','text','context','map','deeper','check']`.
  - `stepCall('text','en','John 3:16')` equals `{ tool: 'get_passage', args: { reference: 'John 3:16', language: 'en' } }`. Same shape for `context` and `check`.
  - `mapRows(johnFixture)`:
    - has at least one row of each kind;
    - every note row has `quote.original` and `quote.aligned` as non-empty strings;
    - every `deeperCall(row,'en')` names a tool in `TOOL_REGISTRY`, with args that pass that tool's zod `inputSchema.safeParse`.
  - `mapRows(emptyFixture)` is `[]` (Review Focus 2).
  - `mapRows(null)` and `mapRows({})` are `[]`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `guided.ts`, then `GuidedWalk.svelte`:
  - **Layout:** steps list on the left (a select on phones), the result on the right. Back and Next buttons. "Open in Tools" with the step's call.
  - **Map step:** one button per row, grouped by kind. With no rows it says "No notes or key terms for this passage" and Next skips `deeper` (Review Focus 2). For note rows, `AlignedQuote` shows the quote.
  - **Deeper step:** shows the call for the row the person pressed, which is stored in `TryState.open`.
  - **Answers that are not available** (`not-available`) show as an answer with the server's message, and Next stays enabled (Review Focus 3).
  - **Latest answer only:** each call gets a sequence number, and an answer whose number is not the latest is dropped. A closed component never writes state (an `alive` flag, as in obs `GuidedSession.svelte`) (Review Focus 1).
  - **Phones:** after a choice, `revealOnNarrow(resultEl)`.
- [ ] **Step 4:** Add the superseded-answer test: export `latestOnly<T>()`, a function that returns `{ next(): number; isLatest(n: number): boolean }` from `guided.ts`. Test that after `next()` twice, `isLatest(1)` is false and `isLatest(2)` is true. Use it in the component.
- [ ] **Step 5:** Run the tests (PASS). Run the site locally as in Task 4 and walk John 3:16 to the end, then `es-419` John 3:16, which shows the not-available message at Text and still reaches Check. Stop the servers.
- [ ] **Step 6:** Commit: `Add the guided walk through one passage and all its helps`.

### Task 6: OBS walk

**Files:**
- Create: `web/src/lib/try/obs.ts`, `web/src/lib/try/ObsWalk.svelte`.
- Test: `tests/web/obs.test.ts`.

**Interfaces:**
- Produces:
  - `OBS_STEPS: { id: 'story' | 'notes' | 'questions'; title: string; tool: string }[]` = `get_obs_story`, `get_obs_notes`, `get_obs_questions`;
  - `obsCall(step, lang: string, story: number, frame?: number): { tool; args }`, with argument names from those tools' `inputSchema`.
- Consumes: the same as Task 5 (`run`, `ResultViewer`, `TryState.story`).

- [ ] **Step 1: Write the failing test.** For each step, `obsCall(step,'en',1)` names the step's tool, with args that pass its `inputSchema.safeParse`. With a frame, `obsCall('notes','en',1,5)` has args that also pass.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Story picker 1–50 and an optional frame. Same layout and the same latest-answer guard as `GuidedWalk`.
- [ ] **Step 4:** Run the test (PASS). Locally, story 1 shows its notes and questions.
- [ ] **Step 5:** Commit: `Add the OBS walk to the Try page`.

### Task 7: Home page

**Files:**
- Create: `web/src/lib/resources.ts`, `web/src/lib/home/anatomy.ts`, `web/src/lib/home/snapshot.json`, `web/src/lib/home/AnatomyExplorer.svelte`, `web/src/lib/components/AlignedQuote.svelte`, `scripts/capture-home-snapshot.ts`.
- Modify: `web/src/routes/+page.svelte`.
- Adapt from obs: `lib/anatomy/AnatomyExplorer.svelte` (live answer when the server has it, saved excerpt otherwise).
- Test: `tests/web/home.test.ts`.

**Interfaces:**
- Produces:
  - `RESOURCES: { id: 'ult'|'ust'|'tn'|'tw'|'twl'|'tq'|'ta'|'obs'; name: string; summary: string; forWhom: string; tool: string; door43: string }[]`. Each `door43` is a `https://git.door43.org/unfoldingWord/en_<id>` repo URL (`en_ult`, `en_ust`, `en_tn`, `en_tw`, `en_twl`, `en_tq`, `en_ta`, `en_obs`). Check each one exists before writing it. Also used by `/docs/resources` (Task 8).
  - `ANATOMY_PARTS: { id: 'text'|'notes'|'words'|'questions'|'academy'; title: string; call: { tool: string; args: Record<string, unknown> } }[]`, all for `John 3:16`, `en`.
  - `snapshot.json`: `Record<AnatomyPart['id'], string>` (an excerpt of at most 700 characters each), plus `alignment: { original: string; aligned: string }[]` (2–4 rows from `get_passage_index` notes).
- `scripts/capture-home-snapshot.ts [origin]` (default `DEFAULT_ORIGIN`) calls each `ANATOMY_PARTS` call over MCP and writes `snapshot.json`. Run it with `npx tsx`. It is never run in the build.

- [ ] **Step 1: Write the failing test** `tests/web/home.test.ts`:
  - `RESOURCES` has the 8 ids in that order;
  - every `tool` is in `TOOL_REGISTRY`;
  - every `ANATOMY_PARTS[i].call` passes its tool's `inputSchema.safeParse`;
  - `snapshot.json` has a non-empty excerpt of 700 characters or fewer for every part id;
  - `alignment` has 2–4 rows with non-empty `original` and `aligned`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `resources.ts` and `anatomy.ts`, then run `npx tsx scripts/capture-home-snapshot.ts` against staging to write `snapshot.json`.
- [ ] **Step 4:** Build the home page:
  - **Hero:** name, tagline, "Try it" and "Connect" buttons, and `AlignedQuote` cycling through `alignment`.
  - **Then:** the anatomy explorer, "What are translation helps" from `RESOURCES` (cards with a Door43 link each), connect in three steps, official sources (unfoldingWord, Door43, the licence).
- [ ] **Step 5:** Run the test (PASS), then `npm run build`.
- [ ] **Step 6:** Commit: `Add the home page with the passage anatomy`.

### Task 8: Connect, Tools reference and Docs

**Files:**
- Create: `web/src/lib/connect/clients.ts`, `web/src/routes/connect/+page.svelte`, `web/src/lib/catalog.ts`, `web/src/routes/tools/+page.server.ts`, `web/src/routes/tools/+page.svelte`, `web/src/routes/docs/+layout.svelte`, `web/src/routes/docs/+page.svelte`, `web/src/routes/docs/{resources,workflow,sdks,languages,limits}/+page.svelte`, `web/src/routes/docs/api/+page.server.ts`, `web/src/routes/docs/api/+page.svelte`.
- Adapt from obs: `lib/connect/clients.ts`, `lib/catalog.ts`, `routes/connect`, `routes/tools`, `routes/docs/+layout.svelte`, `routes/docs/limits`, and their tests `tests/web/connect.test.ts`, `tests/web/catalog.test.ts`.
- Test: `tests/web/connect.test.ts`, `tests/web/catalog.test.ts`, `tests/web/docs.test.ts`.

**Interfaces:**
- Consumes:
  - `buildMcpManifest({ mcpEndpoint })` from `src/mcp/manifest.ts` (via `$mcp/manifest.js`) for `/tools`;
  - `$api/manifest.js` for `/docs/api`, as the current `docs/api/+page.server.ts` does;
  - `RESOURCES` (Task 7).
- Produces:
  - `CLIENTS(endpoint): ClientSetup[]` for Claude Desktop, Claude Code, Cursor (deeplink), VS Code (deeplink), ChatGPT, Other;
  - `buildToolCatalog(manifest): ToolDoc[]`, grouped `discovery` (list_languages, list_resources, search_articles), `passage` (get_passage, get_passage_context, get_passage_index, get_questions), `articles` (get_note, get_academy_article, get_word_article), `obs` (the three OBS tools).

- [ ] **Step 1: Write the failing tests.**
  - `connect.test.ts`: ported from obs, with the TH endpoint.
  - `catalog.test.ts`: every tool in `MCP_TOOLS` appears exactly once, in the group above, with an example call that passes its `inputSchema`.
  - `docs.test.ts`: the text of `docs/limits/+page.svelte` names `90` requests per minute and `RESOURCE_NOT_AVAILABLE`, and names only error codes present in `src/core/errors.ts` (read both files as text and compare the `[A-Z_]{4,}` codes).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the pages.
  - **`/docs/workflow`:** the server's order (passage, then context, then index, then each help, then questions), why the index saves tokens, with one example call per step, linking to Try.
  - **`/docs/languages`:** what `list_languages` and `list_resources` return, and what a language pack is, from `docs/LANGUAGE_PACKS_INFRA.md`, in two paragraphs for readers, not operators.
  - **`/docs/sdks`:** the JS/TS and Python SDKs and the `@translation-helps/*` packages, from `packages/*/README.md`.
- [ ] **Step 4:** Run the tests (PASS), then `npm run build`.
- [ ] **Step 5:** Commit: `Add the Connect, Tools and Docs pages`.

### Task 9: Status and Metrics

**Files:**
- Modify (rewrite): `web/src/routes/(system)/status/+page.svelte`, `web/src/routes/(system)/metrics/+page.svelte`, and `web/src/routes/(system)/+layout.svelte`. Remove the last one if the site layout covers it.
- Create: `web/src/lib/status.ts`.
- Test: `tests/web/status.test.ts`.

**Interfaces:**
- Produces: `STATUS_CHECKS: { id: string; label: string; tool: string; args: Record<string, unknown> }[]`, with one check per tool in `MCP_TOOLS` using the tool's catalog example (Task 8), plus `rest-health` (`GET` of the REST API health URL the current status page uses) and `mcp-initialize`.
- `/status` runs the checks in order and shows ok / not available / failed with time. `/metrics` shows `/api/metrics` as today, restyled.

- [ ] **Step 1: Write the failing test.** `STATUS_CHECKS` covers every `MCP_TOOLS` name exactly once, and no check's id or label contains `chat`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Both pages are linked from the footer only.
- [ ] **Step 4:** Run the test (PASS). Locally, `/v2/status` shows every check ok.
- [ ] **Step 5:** Commit: `Redesign the status and metrics pages`.

### Task 10: Browser tests and final checks

**Files:**
- Create: `web/playwright.config.ts`, `web/tests/e2e/site.spec.ts`.
- Modify: `web/package.json` (scripts `test:e2e`), `.gitignore` (Playwright output).
- Adapt from obs: `playwright.config.ts`, `tests/e2e/site.spec.ts`.

**Interfaces:**
- `playwright.config.ts` runs `npm run build` first. Its two `webServer` entries:
  - API: `npx wrangler dev --config ../wrangler.api.toml --port 8798`;
  - MCP: `npx wrangler dev --config ../wrangler.toml --port 8797 --var API_BASE_URL:http://localhost:8798`.
  
  `baseURL: 'http://localhost:8797/v2'`. These ports avoid the default 8787 and 8788, which other sessions use. If either port is busy, the run stops and says so; it never kills other processes.

- [ ] **Step 1:** Write `site.spec.ts`. Each test is named for what it checks:
  - `guided walk on John 3:16 reaches every step`: Next through every step; the map shows at least one note button; pressing it shows the note.
  - `a language without ULT shows the not-available answer and continues`: `es-419`.
  - `a tool runs from the Tools tab`: `list_languages`.
  - `a broken shared link opens the guided tab`.
  - `/chat, /playground and /rag redirect to /try`.
  - `the OBS walk shows story 1`.
  - `no horizontal scroll at phone width`: for `/`, `/try`, `/connect`, `/tools`, `/docs` and each docs page, `/status`.
  - `on a phone, choosing a guided step brings its result into view`.
- [ ] **Step 2:** Run `npm run test:e2e` in `web/`. Expected: all pass. Fix the site, not the tests, unless a test is wrong about the spec.
- [ ] **Step 3:** Run the full check from the root:
  - `npm ci`;
  - `npm run lint`;
  - `npm run typecheck`;
  - `npm run test:ci`;
  - `npx svelte-check --tsconfig ./tsconfig.json` in `web/`;
  - `npm run build`.
  
  All pass. Stop every `wrangler dev` started.
- [ ] **Step 4:** Commit: `Add browser tests for the website`.
- [ ] **Step 5:** Request the whole-branch review (superpowers:requesting-code-review), at high effort. Check each finding, fix the confirmed ones in this task, re-run Step 3, and commit.
