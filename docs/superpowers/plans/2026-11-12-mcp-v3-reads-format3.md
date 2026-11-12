# C4: the `/v3` MCP tools read format 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Run it with the lp3 agents as `.claude/lp3-controller.md` says.

**Goal:** The seven `/v3` MCP tools of translation-helps-mcp (`th_get_passage`, `th_get_passage_index`, `th_get_notes`,
`th_get_questions`, `th_get_article`, `th_search`, `th_list_resources`) answer from the format 3 language packs the Worker
already serves, wherever a pack covers the call, with the same inputs and the same outputs as today, and use today's path for
everything else.

**Architecture:**
- **The hook is `ApiClient.get`.** Every `/v3` tool reads its data through `ApiClient.get(path, params)`
  (`src/mcp/apiClient.ts`), which today calls the API Worker. A new layer, `src/packs3/`, answers some of those paths
  **in the MCP Worker**, with the same JSON the API Worker returns, built from format 3 segments read from the R2 binding
  `LANGUAGE_PACKS` (`v3/catalog/{lang}.seg`, `v3/seg/{id}.seg`). When it cannot answer, `get` calls the API Worker as
  today. The tools' code, schemas, paging and messages do not change, so their contract holds by construction. The
  contract is then checked call by call against today's answers.
- **Why not in the API Worker** (where `packViews.ts` lives, as the proposal says): the staging MCP Worker binds the
  **production** API Worker (`wrangler.toml` `[env.preview]` → `translation-helps-api-v2`), and only the MCP Worker
  has `PACKS_V3` and the staging bucket per environment. Hooking in the MCP Worker makes staging read format 3 and
  production keep its current behaviour (`PACKS_V3 = "off"`) with no production change. This is decision 2 for Abel.
- **The library** `@bt-synergy/language-pack-client` comes in as a **vendored ESM bundle** built from a pinned tc-study
  commit (`vendor/language-pack-client/`), with only `openFromSegments`, `verifyCatalogFile` and types. It is not on npm
  and the repo has no git dependencies (decision 1).
- **Memory is bounded by what the Worker is allowed to call.** Only `book`, `orig`, `passage`, `articles` and
  `article` run in the Worker; readers are recycled by a byte budget. The map queries are forbidden here (measurements
  below).

**Tech Stack:** TypeScript, Cloudflare Workers (`nodejs_compat`), vitest (`npx vitest run`), wrangler 4, Bun only to
build the vendored bundle from tc-study.

**Spec:**
- The format: `packages/language-pack-v3/spec/` in tc-study master (`ac276343`), with `serving.md` (routes and R2 keys)
  and `catalog.md` (signatures).
- The tool contract: the `/v3` tools as they are on `uw/v2` (`408c84b0`): `src/mcp/v3/tools/*.ts`, their tests
  `tests/unit/v3-*.test.ts` and `tests/contracts/mcp-v3.contract.test.ts`, and the live answers of the staging Worker.
- The proposal: tab Plan, section «C4: translation-helps-mcp», of https://claude.ai/artifact/5Vw6P8Bm3bo51VkTRwsuPA.

## Measurements (2026-11-12, tc-study master `ac276343`, staging data, Bun 1.3 on Windows)

Done before planning with `openFromSegments` over HTTP from the staging Worker (en rev 3, es-419 rev 3, common rev 2,
all signed with key `78d2e6299a2de4d0`). Heap is `process.memoryUsage().heapUsed` after `Bun.gc(true)`, one process per
query. Bun's JSC heap is not V8's: Task 1 repeats the numbers that matter under V8 with a 128 MB cap.

| Query (en unless noted) | Segments | Downloaded | Heap after | Time |
| --- | --- | --- | --- | --- |
| verify both catalogs | 2 | 33 KB | ~3 MB | 1.3 s |
| `passage('tit 1:1')` (book + `map` with parts) | 61 | 0.18 MB | 12 MB | 3.0 s |
| `book('psa')` (11.1 MB inflated) | 1 | 1.10 MB | **38 MB** | 1.5 s |
| `passage('psa 23:1-3')` | 61 | 1.24 MB | 51 MB | 3.3 s |
| `articles('ta:translate')` / `tw:kt` / `tw:names` / `tw:other` | 1 each | 0.13–0.26 MB | 5 MB | 0.4–1.2 s |
| map cores only (`mapsOf(…, {coreOnly})`) | 4 | 0.56 MB | 43 MB | 1.2 s |
| `mapsOf(['xmap','map','xtopics','topics'])` with parts | 254 | 1.79 MB | 96 MB | 7.9 s |
| `aligned` (17 units) | 17 | 3.74 MB | **292 MB** | 2.4 s |
| `books({article})`, `topics({book})`, `concept`, `lookup` (they call `maps()`, aligned included) | 211–271 | 5.4–5.5 MB | **295–510 MB** | 9.5–11 s |
| `renderings({strong:'G5485'})` (opens every NT book) | 131 | 20.9 MB | **~1.5 GB** | 46 s |
| es-419 `book('rut')`, `articles(…)`, `aligned` | 1 / 1 / 16 | ≤0.28 MB | ≤14 MB | ≤1.4 s |

Conclusions the plan relies on:
- The seven tools need only `book`, `orig`, `passage`, `articles`/`article` and the catalog. Those fit: Psalms, the
  largest book, is the worst case (C4.4: under 128 MB with Psalms in English).
- `maps()`, `lookup`, `books`, `topics`, `concept`, `renderings` and `search` must not run in the Worker as the
  library is today. They are what the new tools and BT Servant's questions need (decision 3); they wait for a library
  change in tc-study.
- Each segment is fetched once per reader, but the reader keeps every decoded segment for its lifetime, so the Worker
  must recycle readers (Task 3).
- Staging has no OBS units and the books carry no USFM: OBS and `format: "usfm"` stay on today's path.

## Decisions for Abel before this runs

1. **How the library gets in.** Recommended: a vendored bundle (`vendor/language-pack-client/index.js`, a few hundred KB),
   rebuilt by a script from a tc-study commit and checked by a test against its recorded sha256. Alternatives: publish
   `@bt-synergy/language-pack-client` to npm (a release process in tc-study), or a git dependency (npm cannot install a
   workspace subfolder from git without a build step).
2. **Where format 3 is read: in the MCP Worker, under `ApiClient.get`** (recommended, see Architecture), instead of in
   the API Worker's `packViews.ts` as the proposal says. The proposal is updated after the run (Deviations).
3. **Scope: the seven tools only.** C4.3 (`list_topics`, `get_article_usage`, `get_book_keywords`,
   `get_article_section`) and BT Servant's three questions (notes by Academy article across books, key terms by Strong
   across books, bridge-language phrases) need the map queries, which today use 300 MB to 1.5 GB. They become **C4b**:
   first a library change in tc-study (map queries read only the units and parts they need, never `aligned` unless
   asked; renderings per book), then the new tools. "How many metaphors in Jonah" is already answered by
   `th_get_passage_index` on `JON` (`issues`), and this plan serves that from format 3.
4. **`th_list_resources` stays on today's path.** Without a language it lists every language in the Door43 catalog, and
   with a language it lists OBS and books format 3 does not have yet. Format 3 has two languages. It reads format 3 when
   it covers most of what Door43 lists.
5. **Test fixtures in the repo:** about 2 MB of real staging segments (en Titus, es-419 Ruth, two article groups each,
   the catalogs), CC BY-SA, with a README naming the sources. Alternative: tests build nothing and the unit tests use
   fakes only, which weakens Tasks 5–9.

## Global Constraints

- **Worktree and branch:** `C:/Users/LENOVO/Git/Github/wt/th-c4`, branch `feat/mcp-v3-reads-format3` from `uw/v2`
  (`408c84b0`). PRs go into `v2`. Never touch `C:/Users/LENOVO/Git/Github/translation-helps-mcp` (someone else's
  uncommitted changes) or other worktrees.
- **Commits** in English, a title and a body that says why, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Local only: no push, PR, merge, deploy or upload without Abel's yes.
- **No secrets.** Only public keys appear in files (`PACKS_V3_TRUSTED_KEYS`). No token or credential in a file, commit,
  log or brief.
- **Production is not touched.** `[env.production]` keeps `PACKS_V3 = "off"` and gets `PACKS_V3_TRUSTED_KEYS = ""`;
  with either, format 3 reads are off and every call goes to the API Worker exactly as today. The staging key is never
  trusted in production; the production key, when Abel makes one, goes only in `[env.production]`.
- **The contract does not change.** No change to any tool's input schema, output schema, description, name, order,
  `available: false` payload, hints or text summary. `tests/contracts/mcp-v3.contract.test.ts`, every
  `tests/unit/v3-*.test.ts` and `tests/contracts/not-available-and-source.contract.test.ts` pass unchanged.
- **Format 3 never says "not available".** When format 3 cannot answer a call completely, `get` asks the API Worker,
  which decides as today. Format 3 answers only what it fully has.
- **Fallback is per call and silent** for the caller: no format 3 catalog for the language, a catalog that fails
  verification, a book or resource the catalog does not list, a segment missing or bad, OBS, `format=usfm`, study notes
  or questions, any path not in the adapter table, or any exception. Each fallback is logged once per isolate per
  `(lang, reason)` with `console.warn("packs3 fallback", …)`.
- **Signatures are required.** A catalog is used only if `verifyCatalogFile(bytes, { trustedKeys }, { from: "network" })`
  accepts it with keys from `PACKS_V3_TRUSTED_KEYS` (`"<keyId>:<64 hex>,…"`). No keys means no format 3 reads.
  Staging key: `78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911`.
- **Allowed library calls in the Worker:** `verifyCatalogFile`, `openFromSegments`, and on a reader `book`, `orig`,
  `passage`, `articles`, `article`, `listed`, `unitOf`, `size`, `installed`, `revisions`, `problems`. A test fails if
  `src/packs3/**` calls anything else on a reader (Task 3).
- **R2 keys are those of `serving.md`:** `v3/catalog/{lang}.seg`, `v3/catalog/common.seg`, `v3/seg/{id}.seg`; the language
  goes through `normalizePackLanguage` (es → es-419). Reads use the `LANGUAGE_PACKS` binding directly, not HTTP.
- **`meta.cache` of a format 3 answer is `"pack"`**, a value the tools already map to `hit` (`src/mcp/tools/shared.ts:278`).
- **Tests:** `npx vitest run <file>`. Implementers send output to a file in the ledger folder and read only the summary
  (`.claude/lp3-controller.md`). The full suite (`npm run test:ci`) and `npx tsc --noEmit` pass before each commit.

## Review Focus

1. **A call format 3 answers differently from today with the same data release** (labels, verse numbering, quote
   alignment, introductions, ids, ordering). Task 10's comparison runs each call both ways and fails on any difference
   not in the known-differences file with a reason. Tasks 5–9 each add a unit test that pins one real answer (fixtures)
   field by field.
2. **A language or book format 3 does not have** (fr; es-419 `MAT`; en OBS) must answer exactly as today. Task 4 tests
   that `get` calls the API with the same path and params for each fallback reason, and Task 10's call list includes
   them.
3. **Psalms and other large books, several at once, in one isolate.** Task 1 runs the Psalms calls under V8 with
   `--max-old-space-size=128`; Task 3 tests that a reader is recycled past its budget while an in-flight call keeps its
   reader; S4 tails staging for `exceededMemory` / `exceededCpu`.
4. **A catalog revised while an isolate holds the old one.** Task 2 tests that after the refresh interval a changed
   ETag loads the new catalog and new readers use it, and that a reader never mixes segments from two catalogs.
5. **A bad or unsigned catalog in the bucket** (wrong key, unsigned, corrupt) must not break any tool. Task 2 tests that
   each one falls back and logs once.

## Execution with the lp3 agents

As in phases 1–3 (`.claude/lp3-controller.md`, copied into this worktree):

| Agent | Model | Use |
| --- | --- | --- |
| `lp3-implementer` | sonnet | one task or fix round, from its brief file |
| `lp3-reviewer` | sonnet | one task's review, from brief, report and diff |
| `lp3-runner` | haiku | any test or build run the controller needs |
| final reviewers | opus | three in parallel at the end |

- **One controller session** (Sonnet), started by the supervisor (this planning session), runs the plan in
  `wt/th-c4` only. No two implementers at once.
- **Ledger:** `C:/Users/LENOVO/Git/Github/wt/th-c4/.superpowers/sdd/2026-11-12-c4/progress.md`, with `plan-path` and
  `global-constraints.md` (this plan's section, verbatim) beside it. Briefs, reports and review diffs go in the same folder.
- **Handoffs** (`RELEVO`) after Task 3, Task 6 and Task 9. The supervisor runs the 15-minute `CronCreate` check for
  this run and deletes it at `FIN:`.
- **Codex** reviews read-only, after the task's own review: Task 2 (signature trust and catalog refresh), Task 3 (memory
  budget and reader recycling) and Task 6 (notes and word links, the largest contract surface). Recipe:
  `C:\Users\LENOVO\.claude\projects\C--Users-LENOVO-Git-Github-servos\memory\codex-cli-windows.md`.
- **Final review:** three Opus reviewers in parallel: (1) `src/packs3/` core and the hook, Tasks 1–4; (2) passage,
  notes, word links and questions, Tasks 5–7; (3) articles, search and the comparison, Tasks 8–10. Each gets its part
  of the diff, the ledger's deferred items and rulings, and the known-differences file.

---

## Part A: reading format 3 in the Worker

### Task 1: Vendored library and the V8 measurement

**Files:**
- Create: `scripts/vendor-language-pack-client.mjs`, `vendor/language-pack-client/{index.js,index.d.ts,SOURCE.json,LICENSE,README.md}`,
  `scripts/measure-packs3.mjs`, `docs/packs3-measurements.md`
- Test: `tests/unit/packs3-vendor.test.ts`

**Interfaces:**
- Produces: `vendor/language-pack-client/index.js`, an ESM bundle exporting exactly `openFromSegments`,
  `verifyCatalogFile`, `ClientError`, and the types `PackReader`, `VerifiedCatalog`, `TrustPolicy`, `Answer`,
  `PassageData`, `ArticleData` (in `index.d.ts`). `SOURCE.json`: `{ repo: "unfoldingWord/tc-study", commit, built,
  bundleSha256, bytes }`.
- Usage: `node scripts/vendor-language-pack-client.mjs --tc-study <path to a tc-study checkout at the commit>`. It
  builds with `bun build <entry> --target=browser --format=esm --minify` from a temporary entry file that re-exports
  only the names above, so jszip and the store code are left out. It copies the library's LICENSE.

- [ ] **Step 1: Write the failing tests** in `packs3-vendor.test.ts`:
  - `the bundle matches SOURCE.json` — sha256 of `index.js` equals `bundleSha256`, and `bytes` matches.
  - `the bundle exports exactly the allowed names` — `Object.keys(await import(...)).sort()` equals
    `["ClientError","openFromSegments","verifyCatalogFile"]`.
  - `the bundle has no jszip and no node: imports` — the text has no `jszip`, `JSZip`, `from "node:` or `require(`.
  - `the bundle is under 400 KB`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/packs3-vendor.test.ts`; expected: FAIL (no bundle).
- [ ] **Step 3: Write the script and build** from `C:/Users/LENOVO/Git/Github/wt/lp3-c5` (tc-study master
  `ac276343`; read-only, use `git -C … worktree` or `git archive` into a temporary folder if it needs `bun install`).
- [ ] **Step 4: Run** the test; expected: PASS.
- [ ] **Step 5: Measure under V8.** `scripts/measure-packs3.mjs --base https://translation-helps-mcp-v2-preview.unfoldingword.workers.dev`
  verifies en, es-419 and common with the staging key, opens a reader, and runs in sequence, recording
  `process.memoryUsage().heapUsed` after `global.gc()` and the wall time of each: `book('psa')`, `passage('psa 119:1-8')`,
  `passage('psa 23:1-3')`, `orig('psa')`, `articles('tw:kt')`, `articles('ta:translate')`, then the same reader for
  `book('isa')` and `book('jer')`. Run it as `node --expose-gc --max-old-space-size=128 scripts/measure-packs3.mjs` and
  again with `--max-old-space-size=64`. Write the table to `docs/packs3-measurements.md` with the Bun table above.
  **Gate:** if the 128 MB run fails or the heap after Psalms exceeds 80 MB, stop and return `BLOCKED` with the numbers;
  the controller asks the supervisor.
- [ ] **Step 6: Commit** `packs3: vendor the language pack client and measure it under V8`.

### Task 2: Keys, catalogs and segments from R2

**Files:**
- Create: `src/packs3/keys.ts`, `src/packs3/catalogs.ts`, `src/packs3/segments.ts`,
  `tests/fixtures/packs3/` (with `README.md`), `scripts/fetch-packs3-fixtures.mjs`
- Test: `tests/unit/packs3-catalogs.test.ts`

**Interfaces:**
- Consumes: `verifyCatalogFile` (Task 1), `normalizePackLanguage` from `src/api/routes/packs.ts`.
- Produces:
  - `parseTrustedKeys(value: string | undefined): Record<string, Uint8Array> | null`: `null` for unset, empty or any
    malformed entry (logs once); each entry is `<16 hex>:<64 hex>` and the key id must equal the first 16 hex digits of
    the sha256 of the 32 bytes.
  - `type Packs3Env = { LANGUAGE_PACKS?: R2Bucket; PACKS_V3?: string; PACKS_V3_TRUSTED_KEYS?: string }`.
  - `getCatalogs(env: Packs3Env, lang: string, now?: number): Promise<Catalogs3 | null>` where
    `type Catalogs3 = { lang: string; key: string; catalogs: VerifiedCatalog[] }` (language then common) and `key` is
    `"<lang id>+<common id>"`. `null` means "no format 3 here", with a reason logged once.
  - `segmentGetter(env: Packs3Env): (id: string) => Promise<Uint8Array | undefined>`.
  - `resetPacks3CachesForTests(): void`.
- Rules:
  - Per isolate, a catalog pair is reused for 60 s. After that the next call re-reads with `onlyIf: { etagDoesNotMatch }`;
    an unchanged ETag keeps the verified pair without verifying again.
  - A missing language catalog is remembered for 300 s.
  - A catalog that fails verification is remembered as missing for 300 s and logged once, with the error code.
  - The language catalog's `requires` must name the common catalog's id; otherwise `null`, reason `common-mismatch`.
  - Segments: an isolate LRU of compressed bytes, at most 16 MB; a hit does not touch R2.
- Fixtures: `fetch-packs3-fixtures.mjs` downloads from the staging Worker the en and es-419 and common catalogs, en
  `book:tit`, `orig:tit`, es-419 `book:rut`, `orig:rut`, `art:tw:kt` and `art:ta:translate` for both languages, and
  the en and es-419 `map` units with their parts, into `tests/fixtures/packs3/v3/…` under their R2 keys. It writes
  `index.json` (ids, sizes, sources). The README states the CC BY-SA sources and the command. Target: 2.5 MB or less.

- [ ] **Step 1: Fixtures.** Run the script; check the size; commit them in this task.
- [ ] **Step 2: Write the failing tests**, with a fake bucket over the fixture folder (`src/packs/dirBucket.ts` or a
  copy of the `fakeBucket` of `tests/unit/packs-v3.test.ts`):
  - `parseTrustedKeys`: the staging key parses; `""`, `"x"`, a 63-hex key, and a key id that does not match its key
    all give `null`.
  - `loads and verifies en with the staging key`; `es is es-419`.
  - `no keys → null`, `PACKS_V3 off → null`, `no bucket → null`.
  - `unknown language → null and one R2 read in 300 s`.
  - `catalog signed by another key → null, logged once`; `unsigned published catalog → null`;
    `corrupt catalog bytes → null`.
  - `reuses the pair for 60 s` (count R2 gets with an injected `now`); `after 60 s an unchanged ETag is not verified
    again`; `a changed ETag loads the new catalog`.
  - `common id not the one required → null, reason common-mismatch`.
  - `segment LRU`: the second get of an id makes no R2 call; past 16 MB the least recently used is evicted.
- [ ] **Step 3: Run**; expected: FAIL. **Step 4: Implement.** **Step 5: Run**; expected: PASS.
- [ ] **Step 6: Commit** `packs3: verified catalogs and cached segments from R2`.

### Task 3: Readers within a memory budget

**Files:**
- Create: `src/packs3/readers.ts`
- Test: `tests/unit/packs3-readers.test.ts`, `tests/unit/packs3-allowed-calls.test.ts`

**Interfaces:**
- Consumes: `getCatalogs`, `segmentGetter` (Task 2); `openFromSegments` (Task 1).
- Produces: `withReader<T>(env: Packs3Env, lang: string, use: (r: PackReader, c: Catalogs3) => Promise<T>): Promise<T | null>`.
  `null` when `getCatalogs` is `null`.
- Rules:
  - One live reader per `Catalogs3.key`, at most two live readers per isolate (least recently used dropped).
  - Each reader counts the compressed bytes of the units it has opened (`reader.size(unit)` the first time a `book:`,
    `orig:` or `art:` unit is read through the wrapper). Past **3 MB** (≈ 30 MB inflated; Psalms alone is 1.17 MB), the
    next `withReader` starts a fresh reader; calls already running keep theirs.
  - The values (2 readers, 3 MB) are constants at the top of the file. Task 1's numbers can lower them; any change is
    recorded in the ledger.

- [ ] **Step 1: Write the failing tests:**
  - `same catalogs → same reader`; `new catalog key → new reader`.
  - `budget`: with a fake reader whose `size()` is set, opening units past 3 MB makes the next call get a new reader,
    while a call holding the old one still finishes with it.
  - `at most two readers` across three languages.
  - `allowed calls`: `packs3-allowed-calls.test.ts` reads every file under `src/packs3/` and fails if it finds a call on a
    reader to anything outside the list in Global Constraints (`maps`, `mapsOf`, `lookup`, `books`, `topics`,
    `concept`, `context`, `renderings`, `search`, `segments`).
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run**; PASS.
- [ ] **Step 5: Commit** `packs3: one reader per catalog pair, recycled past a byte budget`.

### Task 4: The hook in `ApiClient.get`, the switch and the routing table

**Files:**
- Create: `src/packs3/answer.ts`
- Modify: `src/mcp/apiClient.ts` (`get`), `src/mcp/stateless.ts` (per-request mode), `src/worker.ts` (`Env`: `PACKS_V3_TRUSTED_KEYS`,
  `PACKS_V3_DEBUG`), `wrangler.toml` (`[vars]`, `[previews]`, `[env.preview]`: the staging key and `PACKS_V3_DEBUG = "on"`;
  `[env.production]`: `PACKS_V3_TRUSTED_KEYS = ""`, no `PACKS_V3_DEBUG`)
- Test: `tests/unit/packs3-hook.test.ts`

**Interfaces:**
- Produces:
  - `type Packs3Mode = "auto" | "off" | "only"`.
  - `answerFromPacks3(env: Packs3Env, path: string, params: Record<string, string | number | undefined>): Promise<unknown | undefined>`.
    It looks the path up in `ADAPTERS: Array<{ match: (path: string) => boolean; run: (env, path, params) => Promise<unknown | undefined> }>`.
    No match, or `run` gives `undefined`, means fall back; an exception is caught, logged as a fallback, and gives
    `undefined`.
  - `ApiClient` gains an optional second constructor argument `{ packs3?: Packs3Env & { mode?: Packs3Mode } }`. In
    `get`, mode `auto` (default) tries `answerFromPacks3` first; `off` skips it; `only` throws
    `ApiClientError("PACKS3_FALLBACK", <reason>, 404, false)` instead of calling the API (for the comparison only).
  - The mode comes from the request header `x-th-packs3: off | only`, honoured only when `env.PACKS_V3_DEBUG === "on"`;
    `stateless.ts` passes it with the env the tools receive. Tasks 5–9 add entries to `ADAPTERS`.
- [ ] **Step 1: Write the failing tests:**
  - `no adapters → every get calls the API with the same URL as before` (compare the URL the fake `API` fetcher sees
    for each path the seven tools use).
  - `an adapter answer is returned and the API is not called`.
  - `adapter undefined or throwing → API called once, fallback logged once per (lang, reason)`.
  - `PACKS_V3 off, or no keys → API called, adapters never run`.
  - `x-th-packs3 ignored without PACKS_V3_DEBUG`; `off` skips adapters; `only` gives `PACKS3_FALLBACK` and makes no
    API call.
  - `production config`: parse `wrangler.toml` and assert `[env.production]` has `PACKS_V3 = "off"`,
    `PACKS_V3_TRUSTED_KEYS = ""` and no `PACKS_V3_DEBUG`.
  - The existing `tests/contracts/mcp-v3.contract.test.ts` passes unchanged.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run** the new test and `npm run test:ci`; PASS.
- [ ] **Step 5: Commit** `packs3: try format 3 under ApiClient.get, with a debug mode for comparisons`.

---

## Part B: the adapters (one API path each, same JSON as the API Worker)

Each adapter reads the API route it replaces (`src/api/routes/<route>.ts`) for the exact response JSON, reuses that
route's exported pure helpers instead of copying them, and returns `undefined` whenever the route would have answered
from something format 3 does not have. Each task's test pins one real answer from the fixtures field by field, and the
"would fall back" cases.

### Task 5: Scripture (`/api/v1/scripture`)

**Files:** Create `src/packs3/adapters/scripture.ts`; modify `src/packs3/answer.ts` (register). Test
`tests/unit/packs3-scripture.test.ts`.

**Interfaces:** `scriptureFromPacks3(env, params: { reference: string; language: string; format?: string }): Promise<ScriptureApiResponse | undefined>`,
where `ScriptureApiResponse` is the type `handleScripture` returns (export it from `scripture.ts` if it is not exported).

- Fall back: `format` other than `text`; OBS; a book the language catalog does not list; a cross-book reference; a
  reference the reader rejects (`ClientError` `E_ARG`) after the route's own reference parsing.
- Versions: one per text resource of the book, in the roles and order `scriptureVersionsForBook` and
  `pickPrimaryScriptureEntries` give (literal, simplified, original); the original from `orig(book)`.
  `resourceType` and `source` exactly as the route gives them today: es-419 TIT 1:1 is
  `tpl` / `https://git.door43.org/es-419_gl/es-419_glt/archive/v42.zip`, then `gst` … `v40.zip`, then `ugnt` …
  `el-x-koine_ugnt/archive/v0.34.zip`, and text starts with the verse number (`"1 Pablo, siervo de Dios…"`).
  `versionsNote` from `describeStandIns`. `meta.cache: "pack"`.
- [ ] **Steps:** failing tests (`es-419 TIT 1:1` and `en TIT 1:1-3`, every field; `format usfm`, `OBS 3:5`, `MAT 5:1` in
  es-419, `fr` → `undefined`) → FAIL → implement → PASS → `npm run test:ci` → commit
  `packs3: scripture from format 3 books`.

### Task 6: Notes and word links (`/api/v1/notes`, `/api/v1/word-links`)

**Files:** Create `src/packs3/adapters/helps.ts`; modify `src/packs3/answer.ts`. Test `tests/unit/packs3-helps.test.ts`.

**Interfaces:** `notesFromPacks3(env, params)` and `wordLinksFromPacks3(env, params)`, each `Promise<unknown | undefined>`
returning the JSON of `handleNotes` / `handleWordLinks` for the same params, including `fields=index` for a whole book.

- Rows: the TSV row shape the routes return (the mapping `notesFromViews` / `wordLinksFromViews` in `packViews.ts` already
  makes; reuse its row builder and `sourceFromPackView`'s shape), with `gatewayQuote{original, aligned, simple}`, the
  book introduction, chapter introductions and `taArticle` / `twArticle` paths as today.
- Fall back: study notes; OBS; the resource absent from the book in the catalog; a notes row format 3 cannot place.
- [ ] **Steps:** failing tests (`en TIT 1:1` notes and word links, every field of the first two rows and the counts;
  `en TIT` whole book with `fields=index`, total counts and the `front:intro` row; `es-419 RUT 1:1` notes with
  `alignedQuote`; fallbacks) → FAIL → implement → PASS → commit `packs3: notes and word links from format 3`.
  Codex reviews this task.

### Task 7: Questions (`/api/v1/questions`)

**Files:** Create `src/packs3/adapters/questions.ts`; modify `src/packs3/answer.ts`. Test `tests/unit/packs3-questions.test.ts`.

**Interfaces:** `questionsFromPacks3(env, params): Promise<unknown | undefined>`, the JSON of `handleQuestions`.

- [ ] **Steps:** failing tests (`en TIT 1:1-3` every record field and `source`; `es-419 RUT 1` count; OBS and study →
  `undefined`) → FAIL → implement → PASS → commit `packs3: questions from format 3`.

### Task 8: Articles (`/api/v1/words/{path}`, `/api/v1/academy/{path}`)

**Files:** Create `src/packs3/adapters/articles.ts`; modify `src/packs3/answer.ts`. Test `tests/unit/packs3-articles.test.ts`.

**Interfaces:**
- `articleCatalogFromPacks3(env, lang, kind: "tw" | "ta"): Promise<ArticleCatalog<WordArticle | AcademyArticle> | undefined>`,
  the same `ArticleCatalog` type `articleCatalog.ts` builds from Door43, built from the article groups (`tw:kt`,
  `tw:names`, `tw:other`; `ta:translate`, `ta:checking`, `ta:process`, `ta:intro`), cached per catalog key.
- `wordsPathFromPacks3(env, path, params)` and `academyPathFromPacks3(env, path, params)`: the JSON of `handleWordsPath`
  / `handleAcademyPath` (`requestedPath`, `prepared=1`), resolving terms and rc links with the routes' own matching over
  that catalog (`jsonArticleMatch`), so `resolvedFrom`, `candidates` and `otherCandidates` come out the same.
- Ids: `bible/kt/grace` ↔ `tw:kt/grace`; `translate/figs-metaphor` ↔ `ta:translate/figs-metaphor`. `related` from
  `ArticleData.related` with titles, as the route shapes it today.
- [ ] **Steps:** failing tests (`bible/kt/grace` en, `translate/figs-metaphor` en and es-419 with `related`;
  the term `metaphor`, the term `gracia` in es-419; an rc link; an unknown path → the same not-found JSON the route
  gives, or `undefined` if the route would ask Door43 again) → FAIL → implement → PASS → commit
  `packs3: Translation Words and Academy articles from format 3`.

### Task 9: Search (`/api/v1/search`)

**Files:** Create `src/packs3/adapters/search.ts`; modify `src/packs3/answer.ts`. Test `tests/unit/packs3-search.test.ts`.

**Interfaces:** `searchFromPacks3(env, params: { q, language, limit?, types? }): Promise<unknown | undefined>`, the JSON of
`handleSearch`, ranking with the route's own ranking function over `articleCatalogFromPacks3` (Task 8). If the ranking
is not a pure exported function, export it from `search.ts` without changing it.
- [ ] **Steps:** failing tests (`"figures of speech"`, `"covenant"` tw only, `"abstract nouns"` ta only in en;
  `"metáfora"` in es-419; the same top results and order as the route gives over the same titles) → FAIL → implement
  → PASS → commit `packs3: article search from format 3`.

---

## Part C: proof

### Task 10: The comparison, local first

**Files:** Create `scripts/compare-packs3.mjs`, `tests/contracts/packs3-calls.json`, `tests/contracts/packs3-known-diffs.json`,
`docs/packs3-comparison.md`; modify `docs/LANGUAGE_PACKS_INFRA.md` (a section on format 3 reads: switch, keys, fallback,
budget, debug header).

- `packs3-calls.json`: at least 30 en and 20 es-419 calls of the seven tools, from real translator questions, each
  `{ tool, args, expect: "pack" | "fallback" }`. They must include: `th_get_passage` JHN 3:16, TIT 1:1-3, PSA 23,
  PSA 119:1-8, RUT 1:1 (es-419), OBS 3:5, TIT 1:1 with `format usfm`; `th_get_passage_index` JON (whole book, the
  `figs-metaphor` count), TIT 1, PSA 23; `th_get_notes` JON 1:3 (es-419), TIT 1:1 with `phrase`, ids from an index
  call, `JHN 1:intro`; `th_get_questions` RUT 1 (es-419), TIT 1, study on OBS 3; `th_get_article` `bible/kt/grace`,
  `translate/figs-metaphor`, `covenant`, `metáfora` (es-419), an rc link, `detail summary`; `th_search` "figures of
  speech", "gracia" (es-419); `th_list_resources` es-419 and es-419 + JON; and fallbacks: `fr` passage, es-419 MAT 5:1.
- `compare-packs3.mjs --base <url> [--base-b <url>]` calls each tool twice through MCP `tools/call`: with
  `x-th-packs3: off` and with `x-th-packs3: only` on one base, or plain on two bases. It removes `requestId`,
  `meta.timings`, `meta.cache` and the text summary's `[cache]` tag, compares the JSON, and fails on any difference that
  is not in `packs3-known-diffs.json` (`{ tool, args, path, reason }`). `expect: "pack"` calls must not give
  `PACKS3_FALLBACK` under `only`; `expect: "fallback"` calls must. Different data releases (a field shows `v91` on one
  side and `v92` on the other) are reported apart, not failed. It writes `docs/packs3-comparison.md` (counts, every
  difference, timings per call).
- [ ] **Step 1:** Write the call list and the script.
- [ ] **Step 2: Local run.** Download the staging bucket's v3 keys into a scratch folder outside the repo (the fixture
  script with `--all`), run the MCP Worker with `wrangler dev` over a local R2 filled from that folder, the
  staging key and `PACKS_V3_DEBUG=on`, `API_BASE_URL` pointed at the production API Worker (as staging does today).
  Run the comparison on that base. Every difference is fixed or entered in the known-differences file with its reason;
  the reasons go to the controller, who records each as a ruling (the supervisor asks Abel about any that changes what
  a caller sees).
- [ ] **Step 3:** Update the infra doc; commit `packs3: comparison of every tool call, format 3 against today`.

## Gate (local)

- Every task reviewed; Codex on Tasks 2, 3 and 6; the three final Opus reviews done and their findings fixed or ruled.
- `npm run test:ci` and `npx tsc --noEmit` pass; the v3 contract and unit tests unchanged.
- Task 10's local comparison passes with every known difference ruled.
- Task 1's V8 numbers are within the gate.

## Staging (each step waits for Abel's yes, asked separately)

- **S1. Push** `feat/mcp-v3-reads-format3` to `uw` (unfoldingWord/translation-helps-mcp).
- **S2. Draft PR into `v2`.** The description says merging deploys production, where `PACKS_V3 = "off"` and
  `PACKS_V3_TRUSTED_KEYS = ""` keep every call on today's path.
- **S3. Deploy the branch to the staging Worker** `translation-helps-mcp-v2-preview` (`scripts/deploy-staging.sh`, `--env preview`),
  with Abel's own wrangler login.
- **S4. Check staging.** Run `compare-packs3.mjs --base https://translation-helps-mcp-v2-preview.unfoldingword.workers.dev`
  with the call list, while `wrangler tail translation-helps-mcp-v2-preview --env preview --format json` runs; zero
  `exceededMemory` / `exceededCpu` outcomes and no unexpected `packs3 fallback`. Then the same real questions in en and
  es-419 asked plainly (no header), and the report.

Production is not in this plan: it needs the production signing key in `[env.production]`, `PACKS_V3 = "on"` there, and
format 3 published to the `language-packs` bucket, each with Abel's yes.

## Deviations from this plan

(The controller records them here as they happen.)
