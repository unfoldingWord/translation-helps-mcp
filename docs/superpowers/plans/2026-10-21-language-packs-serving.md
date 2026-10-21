# Language packs serving (plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep language packs current in R2 without anyone running a command: a workflow builds them, the MCP Worker
serves them under `https://tc-helps.mcp.servant.bible/v2/packs/`, and asks for a build when a language is missing or
older than Door43.

**Architecture:** The generator from plan 1 (`publish-language`, in unfoldingWord/tc-study) runs in a GitHub Actions
workflow in that same repository. The MCP Worker (`translation-helps-mcp-v2`, which already receives every `/v2/*`
request on the host through the Pages proxy) gets:

- the pack routes;
- a freshness check;
- the dispatch of that workflow;
- a daily cron for es-419 and en;
- measuring through `ANALYTICS`.

Builds report their state in R2 next to the catalog, so the Worker never needs KV as a lock.

**Tech Stack:** GitHub Actions (ubuntu-latest, Bun 1.3), Cloudflare Workers (wrangler 4.90, R2, KV, Analytics
Engine, cron triggers), Vitest 3 (MCP repo), bun test (tc-study).

**Spec:** `docs/superpowers/specs/2026-10-20-language-packs-online-design.md` (this repo).
**Plan 1** (done; catalog entry, paths, CLI): `unfoldingWord/tc-study` `docs/superpowers/plans/2026-10-20-language-packs-generator.md`.

## Global Constraints

- **Bucket paths, unchanged from plan 1:**
  - `catalog/<compat>/<lang>.json`
  - `packs/<compat>/<lang>/<sha256>.langpack.zip`
  - `packs/<compat>/originals/<sha256>.langpack.zip`
  - `v1/<lang>/...`
- **Build state:** new, `status/<compat>/<lang>.json` = `{ state: 'running' | 'ok' | 'failed', at: ISO, failures: number, run: url, started?: ISO }`;
  `started` is set by the workflow's `running` write (right before the build reads Door43) and kept by `ok`/`failed`;
  the Worker's own `running` mark at dispatch has none. The freshness loop breaker compares a release with `started`
  (or, when absent, `at` minus the 300-min job timeout), never with `at`.
- **Buckets:**
  - `language-packs-staging` (bound in `[env.preview]`) and `language-packs` (bound in `[env.production]`), in account
    `5a3ffd86…`;
  - binding name `LANGUAGE_PACKS` in both wrangler files;
  - base config binds the staging bucket.
- **Pack responses:**
  - entry: `application/json`, `Cache-Control: no-cache`, ETag = the R2 etag, 304 on `If-None-Match`;
  - pack: `application/zip`, `Cache-Control: public, max-age=31536000, immutable`, Range → 206;
  - CORS: `Access-Control-Allow-Origin: *` (the Pages cache in front does not vary by Origin), allows
    `GET, HEAD, OPTIONS` and headers `Range, If-None-Match`, and exposes
    `ETag, Content-Range, Content-Length, Accept-Ranges`;
  - an eligible language with no entry → `202 {"state":"preparing"}`, `Cache-Control: no-store`;
  - every 4xx (404 not eligible, 400 bad path, 416) carries `Cache-Control: no-store`.
- **Two layers in front of the Worker on `tc-helps.mcp.servant.bible`** (main's Pages app proxies `/v2/*` through
  `ui/src/hooks.server.ts`; checked against adapter-cloudflare 4.9.0):
  - Pages' own cache answers repeated GETs of anything with a public `Cache-Control` before the proxy runs. Packs
    (immutable) are served from it after the first download, Range/HEAD/`If-None-Match` included, so the Worker's
    analytics and rate limit don't see those: count downloads as first fetches per edge, not per phone.
  - SvelteKit turns a 200 whose ETag equals `If-None-Match` into its own 304 and drops the `Access-Control-*`
    headers. The pack routes therefore answer 304 themselves, with CORS and R2's `httpEtag` (quoted), and never a
    200 for a matching `If-None-Match`.
- **Eligible language:** listed by `listLanguages` (tc-ready, prod), and its catalog search has an `Aligned Bible`
  whose resource id ends in `lt`.
- **Dispatch guard:**
  - no dispatch while `status` is `running` and less than 5.5 h old (the workflow job times out at 300 min);
  - none for 24 h after `failed`;
  - none when `failures >= 3` (until reset by hand);
  - at most 20 dispatches a day (soft, KV counter);
  - the freshness check runs at most once an hour per language (KV key).
- **Stamps:**
  - compared only on keys present in `entry.build.stamps`;
  - format = bt-synergy's `resourceContentStamp`: `tag#published_at`, with `:` and `@` and `|` turned into `_`.
- **Analytics:**
  - data points with `indexes: ['pack']`;
  - `blobs: ['pack', route, lang, outcome]`, `doubles: [latencyMs]`;
  - outcomes: `hit`, `not-modified`, `missing`, `preparing`, `stale-dispatched`, `not-eligible`.
- **Workflow inputs:**
  - `language` (validated against `/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/` and passed through `env:`, never inline);
  - `mode` (`publish` | `no-upload`).
- **Pinned inputs, per spec and plan 1:**
  - Taller cloned with `--filter=blob:none` (never shallow);
  - `--lexicons-ref master`;
  - `--generator` = `${{ github.sha }}`.
- **Secrets:**
  - R2 S3 token for these two buckets only, in GitHub Environments `packs-staging` / `packs-production` of
    tc-study (limited to `master`);
  - the Worker's GitHub credentials are a GitHub App with `actions: write` on unfoldingWord/tc-study only (secrets
    `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`).
- **Nothing is created in unfoldingWord's account or GitHub org without Abel's confirmation.** Every infrastructure
  step below is listed for him to approve, and he taps the GitHub App creation himself.
- **Commits:** English, a body explaining why, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Comments in English, few, explaining why.

## Review Focus

1. **A phone asks for a pack while a build overwrites `originals.json`:** the language entry names its own originals
   pack (`entry.originals.path`), so the download stays consistent. Task 4 tests that the pack route serves any path
   an entry names.
2. **Range requests past the end, or `If-None-Match` with a stale etag:** 416 or 200 respectively, never a 500.
   Task 4 tests both.
3. **The workflow crashes before writing `failed`:** `status` stays `running`. The 5.5-hour rule lets the next request
   dispatch again. Task 5 tests a 5-hour-old `running` (held) and a 6-hour-old one (dispatched).
4. **Door43 is down during the freshness check:** no dispatch, the existing entry is served. Task 6 tests a catalog
   search that throws.
5. **A language code in a different case or a variant** (`es` → `es-419`, `ES-419`): normalized with the existing
   `VARIANTS`/lowercase before any path. Task 4 tests `es`.

---

### Task 1 (tc-study): the workflow, and the English measurement

**Files:**

- Create: `.github/workflows/language-packs.yml`
- Create: `scripts/packs-status.ts` (writes `status/<compat>/<lang>.json` through the same `r2Bucket` as
  publish-language)
- Test: `packages/resource-pipeline/src/language/packsStatus.test.ts`

**Interfaces:**

- Consumes: plan 1's `publish-language` CLI (`--lang --work --generator --macula --lexicons-ref [--no-upload]`, last
  stdout line = PublishResult JSON, exit 0/1/2), `r2Bucket`, `compatKeyOf(PACK_FORMAT_VERSION, PACK_VERSIONS)`.
- Produces: `packsStatus(o: { bucket: PackBucket; compat: string; language: string; state: 'running'|'ok'|'failed'; run: string; now?: Date }): Promise<void>`. `failures` is incremented on `failed`, reset on `ok`, kept on `running`.

- [ ] **Step 1: Failing tests for `packsStatus`**
  - Writes `status/<compat>/es-419.json` with `no-cache`.
  - `failed` twice gives `failures: 2`.
  - `ok` resets it to 0.
  - `running` keeps the previous count.
- [ ] **Step 2: Implement `packsStatus`, plus a CLI `scripts/packs-status.ts --lang --state --run`**
- [ ] **Step 3: The workflow**
  - `on: workflow_dispatch` with inputs `language` and `mode`. `concurrency: packs-${{ inputs.language }}`, with
    `cancel-in-progress: false`.
  - A second job-level group, `packs-originals`, serializes runs that may write `originals.json`. Use one shared
    group for all publish runs if GitHub cannot combine groups; record the choice.
  - `environment: packs-production`, or `packs-staging` when `inputs.target == 'staging'`.
  - Steps:
    1. validate `language` via `env`;
    2. checkout tc-study, plus Taller with `git clone --filter=blob:none https://github.com/idiomaspuentes/taller`;
    3. `oven-sh/setup-bun@v2` at 1.3.3;
    4. `scripts/build-pack-tools.sh`;
    5. `packs-status --state running`;
    6. publish-language, wrapped in `echo "::stop-commands::$TOKEN"` … `echo "::$TOKEN::"`, with
       `/usr/bin/time -v` when `mode == no-upload`;
    7. on `always()`, `packs-status --state ok|failed` from the step outcome;
    8. upload the PublishResult and `time -v` output as an artifact.
  - `timeout-minutes: 300`.
- [ ] **Step 4: Run the tests, then commit** (`Packs workflow: build and publish one language, report its state in R2`)
- [ ] **Step 5 (needs PR #39 merged and Task 3 infra, Abel confirms): run `mode: no-upload` for `en` once**
  - Record peak RSS, wall time and pack size in `docs/LANGUAGE_PACKS_PLAN.md` §3.
  - If peak RSS is above 12 GB, or the run fails for memory, stop and add a plan 1 follow-up: stream
    `buildLanguagePack` layers to disk (`pack.ts:164`).

### Task 2 (tc-study): the sample-output check

**Files:**

- Create: `packages/resource-pipeline/src/language/sampleOutput.test.ts`
- Create: `packages/resource-pipeline/src/language/sample-output.json` (`{ compat, hash }`)

**Interfaces:**

- Consumes: the Ruth 4:5 fixtures and warm path of `src/helps/ketivQere.test.ts`, and `PACK_VERSIONS`.

- [ ] **Step 1: The test**
  - Run the quote build → align path on the existing fixtures (UHB with the Q footnote, GLT, a TN with multi-part and
    qere quotes, a TWL row).
  - Serialize the quote and align rows, sorted by key, and sha256 them.
  - If `compat` equals the stored one and the hash differs, fail with the message:
    `pack output changed without a version bump: bump HELPS_QUOTE_VERSION/HELPS_ALIGN_VERSION/SCRIPTURE_PREPARE_SCHEMA, then run with UPDATE_SAMPLE=1`.
  - If `compat` differs, pass; and with `UPDATE_SAMPLE=1`, rewrite the file.
- [ ] **Step 2: Prove it bites**
  - Change one character of the quote matcher's output locally: the test fails.
  - Revert the change.
- [ ] **Step 3: Commit** (`A builder change without a version bump fails the tests`)

### Task 3 (infra, Abel confirms each item): buckets, token, App, bindings

Not code. A checklist in `docs/LANGUAGE_PACKS_INFRA.md` (this repo), done in order, each with Abel's yes:

1. Create the R2 buckets `language-packs-staging` and `language-packs` (wrangler, account `5a3ffd86…`).
2. Create an R2 API token: Object Read & Write on those two buckets only.
3. Store it in the tc-study GitHub Environments `packs-staging` / `packs-production` as `R2_ENDPOINT`, `R2_BUCKET`,
   `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Restrict both environments to `master`.
4. Create the GitHub App "translation-helps packs dispatch": `actions: write`, installed on unfoldingWord/tc-study
   only. Abel taps the creation.
5. Store `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_INSTALLATION_ID` as secrets of
   `translation-helps-mcp-v2` (preview and production).
6. Check in the Pages dashboard that project `translation-helps-mcp` has the service binding `V2` →
   `translation-helps-mcp-v2`. Without it, `/v2/*` goes through the workers.dev fallback, which still works.

- [ ] Write the checklist. Then, with Abel, do items 1–3 for staging only, and confirm with
      `publish-language --dry-run` against staging.

### Task 4 (MCP): pack routes

**Files:**

- Create: `src/api/routes/packs.ts`
- Modify: `src/worker.ts` (route `/v2/packs/` before the SvelteKit fallthrough, `:122-124`; add
  `LANGUAGE_PACKS: R2Bucket` to `Env`, `:42-57`)
- Modify: `wrangler.toml`, `wrangler.api.toml`: bind `LANGUAGE_PACKS` in the base config and in every env (the API
  Worker already reads views through it)
- Test: `tests/unit/packs.test.ts`

**Interfaces:**

- Produces:
  - `handlePacks(request: Request, env: PacksEnv, ctx: ExecutionContext, path: string): Promise<Response>`, where
    `PacksEnv = { LANGUAGE_PACKS?: R2Bucket; TRANSLATION_HELPS_CACHE: KVNamespace; ANALYTICS?: AnalyticsEngineDataset } & DispatchEnv`
    (DispatchEnv from Task 5);
  - `normalizePackLanguage(code: string): string | null`, which lowercases, applies `VARIANTS` from
    `packViews.ts:43-48`, and validates with the regex.

- [ ] **Step 1: Failing tests, with a fake R2** (`get(key, { range, onlyIf })` returning
      `{ body, size, etag, range, httpEtag }` or null) **and a fake KV**:
  - `GET /v2/packs/<compat>/es-419` returns the entry, `no-cache`, ETag.
  - The same request with a matching `If-None-Match` gives 304 with the CORS headers and the quoted `httpEtag`
    (also when the client sends the etag unquoted).
  - `GET …/es-419/<sha>`:
    - returns 200 `application/zip` immutable;
    - with `Range: bytes=0-99`, 206 with `Content-Range`;
    - with a range past the end, 416.
  - `es` resolves to `es-419`.
  - `../x` gives 400.
  - OPTIONS gives 204 with the CORS of Global Constraints.
  - A missing entry for an eligible language gives 202 with `no-store` and calls the dispatcher (Task 5, injected).
  - A missing entry for a non-eligible language gives 404 with `no-store`; `../x` (400) and a range past the end
    (416) carry `no-store` too.
  - Every response carries `Access-Control-Allow-Origin: *`.
  - Every response writes one analytics point.
- [ ] **Step 2: Run them to verify they fail**
  - Run: `npx vitest run tests/unit/packs.test.ts`
  - Expected: FAIL (module not found).
- [ ] **Step 3: Implement `packs.ts` and wire it in `src/worker.ts`**
  - The route applies the existing `enforceRateLimit`.
  - Analytics writes go through `ctx.waitUntil`.
- [ ] **Step 4: Run the suite and the typecheck**
  - `npm run test:ci && npm run typecheck`: all pass.
- [ ] **Step 5: Commit** (`Pack routes under /v2/packs, streamed from R2`)

### Task 5 (MCP): dispatch

**Files:**

- Create: `src/packs/dispatch.ts`, `src/packs/githubApp.ts`
- Test: `tests/unit/packs-dispatch.test.ts`, `tests/unit/github-app.test.ts`

**Interfaces:**

- Produces:
  - `type DispatchEnv = { GITHUB_APP_ID?: string; GITHUB_APP_PRIVATE_KEY?: string; GITHUB_APP_INSTALLATION_ID?: string; PACKS_TARGET?: 'staging'|'production' }`
  - `installationToken(env: DispatchEnv, kv: KVNamespace, now?: Date): Promise<string>`: an RS256 JWT through
    WebCrypto, then `POST /app/installations/:id/access_tokens`, cached in KV for 50 minutes.
  - `requestBuild(o: { env: PacksEnv; compat: string; language: string; reason: 'missing'|'stale'|'daily'; now?: Date; fetch?: typeof fetch }): Promise<'dispatched'|'running'|'cooling'|'stopped'|'capped'|'unconfigured'>`: reads
    `status/<compat>/<lang>.json`, applies the guard, increments the day counter
    `packs:dispatch:<yyyy-mm-dd>`, and `POST /repos/unfoldingWord/tc-study/actions/workflows/language-packs.yml/dispatches`
    with `{ ref: 'master', inputs: { language, mode: 'publish', target } }`.

- [ ] **Step 1: Failing tests**
  - Guard:
    - `running` 1 h old gives `running`;
    - `running` 4 h old dispatches;
    - `failed` 2 h old gives `cooling`;
    - `failures: 3` gives `stopped`;
    - 20 dispatches already today gives `capped`;
    - no App secrets gives `unconfigured`, with no fetch made.
  - The dispatch body and URL.
  - The JWT has the right header and claims (`iat` −60 s, `exp` +9 min, `iss`), and verifies against a test key
    generated in the test.
- [ ] **Step 2: Implement `dispatch.ts` and `githubApp.ts`**
- [ ] **Step 3: Run the tests, then commit** (`Ask for a pack build through a GitHub App, at most once`)

### Task 6 (MCP): freshness check and the daily cron

**Files:**

- Modify: `packages/door43/src/resources/dcsClient.ts`:
  - `mapApiEntry` (`:411-434`) keeps `released`/`published_at` and the release tag as `stamp`, computed like
    `resourceContentStamp`;
  - the per-isolate cache `CATALOG_PROCESS_CACHE` (`:62`) gets a 1-hour TTL;
  - `kvPutBackground` takes an optional `ExecutionContext` and uses `waitUntil`.
- Create: `src/packs/freshness.ts`
- Modify: `src/worker.ts` (a `scheduled` handler); `wrangler.toml` (`[triggers] crons = ["17 6 * * *"]` in
  production only)
- Test: `tests/unit/packs-freshness.test.ts`; extend `tests/unit/dcs-catalog.test.ts`

**Interfaces:**

- Produces:
  - `isStale(entry: PackCatalogEntry, current: Record<string, string>): boolean`: compares only the keys of
    `entry.build.stamps` that `current` has.
  - `checkFreshness(o: { env; ctx; compat; language; entry; now? }): Promise<void>`: throttled by KV
    `packs:fresh:<compat>:<lang>` (1 h). It reads the tc-ready catalog for the language and dispatches `stale` when
    `isStale`; any error → no dispatch.
  - `PackCatalogEntry` is copied as a type from plan 1's catalog.ts (schema 1).

- [ ] **Step 1: Failing tests**
  - `isStale`:
    - same stamps → false;
    - a newer GLT → true;
    - a lexicon key absent from `current` → ignored.
  - `checkFreshness`:
    - throttled within the hour;
    - a catalog search that throws → no dispatch.
  - `mapApiEntry` keeps the stamp in bt-synergy's format: `v42#2026-08-11T12_22_03Z` from `v42` +
    `2026-08-11T12:22:03Z`.
  - The isolate cache expires after 1 h.
- [ ] **Step 2: Implement**
  - `handlePacks` calls `checkFreshness` through `ctx.waitUntil` on every entry hit.
  - `scheduled` calls `requestBuild(…, 'daily')` for es-419 and en.
- [ ] **Step 3: Run the suite and the typecheck, then commit** (`Packs follow Door43: an hourly check per language and a daily build for es-419 and en`)

### Task 7 (MCP + infra, Abel confirms): staging end to end, then production

Only v2 consumes packs. v1 (branch `main`, the Pages app BT Servant uses in production) is not changed: it is to be
retired in favour of v2. Every deploy below is of the v2 Workers, from a checkout of the **`v2` branch**
(`scripts/deploy-v2-production.sh`, or `wrangler deploy --config wrangler.api.toml --env <env>` then
`--config wrangler.toml --env <env>`), never from `main`. Here "production" is the v2 Workers' production env (the one
BT Servant's staging talks to); "preview" is the v2 Workers' preview env.

- [ ] **Staging:**
  1. Deploy `translation-helps-mcp-v2` and `translation-helps-api-v2` with `--env preview`, from `v2`.
  2. Dispatch the workflow with `target: staging` for es-419.
  3. Check that `GET https://translation-helps-mcp-v2-preview.<subdomain>.workers.dev/v2/packs/<compat>/es-419`
     returns the entry.
  4. HEAD one pack and one entry: Content-Type and Cache-Control are as in Global Constraints. This settles plan 1's
     open question on unsigned headers.
  5. Download the pack with a Range request.
  6. Run `npx tsx scripts/compare-pack-views.ts` against the staging views.
  7. Through the real host, since workers.dev skips the Pages proxy and its cache: against
     `https://tc-helps.mcp.servant.bible/v2/packs/…` (production Worker, a test language entry), send HEAD, a Range
     GET, a GET with `If-None-Match`, and an OPTIONS with an `Origin` header, each twice; every answer keeps its
     status, `ETag` and `Access-Control-*` headers, the second time too (served from Pages' cache).
- [ ] **Production, each step confirmed by Abel:**
  1. Items 1–5 of Task 3 for production.
  2. Deploy both Workers `--env production`, from `v2`.
  3. Dispatch es-419 and en.
  4. Start the backfill: a script `scripts/packs-backfill.ts` that lists eligible languages and dispatches at most 20
     a day through `requestBuild` (run by hand daily, or from the cron after es-419/en).
- [ ] **Record** the URLs, the first entries' build ids and the en figures in `docs/LANGUAGE_PACKS_INFRA.md`.

---

**Deviation from the spec, confirmed by Abel (2026-10-21):** the spec put the workflow in the MCP repository. A workflow can
only be dispatched from its repository's default branch. The MCP's default branch is `main`, while this work lives
on `v2`. The generator lives in tc-study (default `master`). Keeping the workflow next to the generator avoids a
cross-repo checkout, and `--generator` becomes `github.sha` exactly. The Worker dispatches it with a GitHub App
installed on tc-study only.
