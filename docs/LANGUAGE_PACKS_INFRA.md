# Language packs: infrastructure checklist

Step 1 is done; nothing after it exists yet. Do the steps in order, one at a time. Each step needs Abel's yes before anyone runs it.
Staging first (steps 2–8 with the staging names), then production (step 9). Step 1 creates both buckets at once.

Account: unfoldingWord, `5a3ffd86280d3ed086be76d955829242`.
Deploys come only from the `v2` branch. v1 (`main`, Pages) is not touched.

**Merge order.** Every v2 deploy binds both buckets (`wrangler.toml` and `wrangler.api.toml` name
`language-packs-staging` and `language-packs`), and a deploy fails while a bound bucket does not exist. So: step 1
first, then merge `feat/language-packs` (already PR #69) into `v2`, then this branch (`feat/language-packs-serving`).
Neither merges before step 1 is done (it is, as of 2026-10-21).

## 1. R2 buckets

- [x] Creates: `language-packs-staging` **and** `language-packs`, both now. Done 2026-10-21 (Standard storage class).
- How: from the repo root (the `account_id` is in the wrangler files, so wrangler picks the right account):
  - `npx wrangler r2 bucket create language-packs-staging`
  - `npx wrangler r2 bucket create language-packs`
- Verify: `npx wrangler r2 bucket list` shows both buckets.
- Approved by Abel: ☑ 2026-10-21

## 2. R2 API token

- [ ] Creates: one token, Object Read & Write, limited to those two buckets.
- How: Cloudflare dashboard → R2 → Manage API tokens → Create API token. Permission "Object Read & Write", specific
  buckets `language-packs-staging` and `language-packs`. Copy the Access Key ID and Secret once.
  Endpoint: `https://5a3ffd86280d3ed086be76d955829242.r2.cloudflarestorage.com`.
- Option (least privilege): one token per bucket instead, each limited to its own bucket, so the staging Environment
  can never write to production. Then `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` differ between the two
  Environments in step 3.
- Verify: the token page lists exactly the bucket(s) it was made for. Keep the values out of chat and out of any
  repository.
- Approved by Abel: ☐

## 3. tc-study GitHub Environments

- [ ] Creates: Environments `packs-staging` and `packs-production` in `unfoldingWord/tc-study` (default branch
      `master`).
- How: repository Settings → Environments → New environment. Deployment branches: selected branches, only `master`.
  **No required reviewers and no wait timer** on either: the Worker dispatches runs unattended, and a run waiting for
  approval would sit as `running` until the Worker's 5.5-hour rule counts it as a failure.
  Secrets per environment:

  | Secret                 | `packs-staging`          | `packs-production`            |
  | ---------------------- | ------------------------ | ----------------------------- |
  | `R2_ENDPOINT`          | the endpoint above       | same                          |
  | `R2_BUCKET`            | `language-packs-staging` | `language-packs`              |
  | `R2_ACCESS_KEY_ID`     | from step 2              | same (or its own, see step 2) |
  | `R2_SECRET_ACCESS_KEY` | from step 2              | same (or its own, see step 2) |

  CLI alternative: `gh secret set <NAME> --env <env> --repo unfoldingWord/tc-study`.

- Verify: both Environments show branch rule `master`, no protection rules, and four secrets. The workflow
  `.github/workflows/language-packs.yml` (inputs `language`, `mode` publish|no-upload, `target` staging|production,
  optional `compat`) reaches `master` when the tc-study branch `feat/packs-workflow` is merged; until then it cannot be
  dispatched.
- Approved by Abel: ☐

## 4. GitHub App "translation-helps packs dispatch"

- [ ] Creates: a GitHub App. Abel creates it himself (organization owner action).
- How: unfoldingWord → Settings → Developer settings → GitHub Apps → New. Permissions: Actions: Read and write
  only (Metadata read is implicit). No webhook. Install on `unfoldingWord/tc-study` only. Generate a private key (PEM)
  and note the App ID and the Installation ID (the number in the installation URL).
- Verify: the installation page shows one repository, `tc-study`, and the permission list shows only Actions and
  Metadata.
- Approved by Abel: ☐

## 5. Worker secrets

- [ ] Creates: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (the PEM, PKCS#1 accepted), `GITHUB_APP_INSTALLATION_ID` on
      `translation-helps-mcp-v2`, for envs `preview` and `production`.
- How: from a checkout of the `v2` branch, for each env. The two IDs are typed at the prompt:
  `npx wrangler secret put GITHUB_APP_ID --config wrangler.toml --env <env>` (and the same for
  `GITHUB_APP_INSTALLATION_ID`). The PEM has several lines, so pipe the file instead of pasting it:
  - bash: `cat key.pem | npx wrangler secret put GITHUB_APP_PRIVATE_KEY --config wrangler.toml --env <env>`
  - PowerShell:
    `Get-Content key.pem -Raw | npx wrangler secret put GITHUB_APP_PRIVATE_KEY --config wrangler.toml --env <env>`
- Verify: `npx wrangler secret list --config wrangler.toml --env <env>` shows the three names.
- Already in wrangler (no action): `PACKS_TARGET` on `translation-helps-mcp-v2` (preview → staging, production →
  production), binding `LANGUAGE_PACKS` (base and preview → `language-packs-staging`, production → `language-packs`),
  and each environment's parts settings and crons ("Operations", "Parts: settings" and "Parts: crons"). In short,
  production has only the f1.1 cron `17 6 * * *` (it checks every published language for a newer Door43 release and
  builds nothing by itself) and no parts setting, so it asks for no parts builds until delivery 3's Task 14; preview
  asks for parts builds (`PACKS_PARTS_DISPATCH = "on"`) and has the three parts crons.
- Approved by Abel: ☐

## 6. Deploy and Pages check

- [ ] Deploys: only from `v2`. Either `scripts/deploy-v2-production.sh` (production only; it builds the web first),
      or per env, from the repo root:
  1. Build the web with the `/v2` base path (the Worker serves its assets from `web/.svelte-kit/cloudflare`):
     - bash: `npm install && BASE_PATH=/v2 npm run build --workspace=translation-helps-mcp-web`
     - PowerShell: `npm install; $env:BASE_PATH = '/v2'; npm run build --workspace=translation-helps-mcp-web`
  2. `npx wrangler deploy --config wrangler.api.toml --env <env>`
  3. `npx wrangler deploy --config wrangler.toml --env <env>`
  4. Watch the next run of each of the Worker's crons (the deploy check in "Parts: crons").
- [ ] Check, no change required: Cloudflare Pages project `translation-helps-mcp` (pages.dev:
      `translation-helps-mcp-945.pages.dev`; v1, custom domain `tc-helps.mcp.servant.bible`) → Settings → Bindings.
      If the service binding `V2` → `translation-helps-mcp-v2` is set, `/v2/*` uses it; if not, it goes through the
      workers.dev fallback, which still works.
- Approved by Abel: ☐

## 7. First real checks (staging)

Against the workers.dev URL of the preview Worker (`translation-helps-mcp-v2-preview`; the deploy prints the URL),
once a staging build of es-419 has published:

- [ ] HEAD one entry and one pack: Content-Type and Cache-Control as in the plan's Global Constraints, and the pack's
      `Content-Length` equals the object's size (the entry's `pack.bytes`, or `npx wrangler r2 object get` metadata).
- [ ] A Range GET inside the pack (206 with `Content-Range`), and a Range starting past the end (`bytes=<size>-`):
      416, never 500, on real R2.
- [ ] A GET of the entry with `If-None-Match: <its ETag>`: 304 with the `Access-Control-*` headers.
- [ ] Stamps agree: the published es-419 entry's `build.stamps` and the stamps the Worker computes from Door43 must
      match on every key both have, or the freshness check would ask for builds that publish nothing. With bash, curl
      and jq (`BASE` = the preview Worker's URL, `COMPAT` = `CURRENT_PACK_COMPAT` in `src/packs/dispatch.ts`):

      ```bash
      curl -s "$BASE/v2/packs/$COMPAT/es-419" > entry.json
      curl -s "https://git.door43.org/api/v1/catalog/search?lang=es-419&topic=tc-ready&stage=prod&limit=500" |
        jq '[.data[]
             | ((.release.tag_name // .branch_or_tag_name // "") | gsub("[:|@]"; "_")) as $t
             | ((.release.published_at // "") | gsub("[:|@]"; "_")) as $p
             | { key: "\(.owner)/\(.language)/\(.name | sub("^[^_]*_"; ""))",
                 value: (if $t != "" and $p != "" then "\($t)#\($p)" elif $t != "" then $t else $p end) }]
            | from_entries' > current.json
      jq -n --slurpfile e entry.json --slurpfile c current.json \
        '$c[0] as $now | [$e[0].build.stamps | to_entries[]
          | select($now[.key] != null and $now[.key] != .value)
          | {key, built: .value, door43: $now[.key]}]'
      ```

      The last command must print `[]` (lexicons, `uhl`/`ugl`, are not in the search and do not count).

- Approved by Abel: ☐

## 8. English measurement

- [ ] Dispatch the workflow with `mode: no-upload`, `language: en`, `target: staging`. Read peak RSS and wall time in
      the run summary.
- Stop rule: peak RSS over 12 GB, or an out-of-memory kill, means no publish. Add a plan-1 follow-up (stream the
  `buildLanguagePack` layers to disk) before trying again.
- Record the figures at the end of this file.
- Approved by Abel: ☐

## 9. Production

- [ ] Repeat steps 3 (the `packs-production` Environment) and 5 (`--env production`) if not done yet, deploy both
      Workers `--env production` from `v2` (step 6), dispatch `es-419` and `en`, then start the backfill (at most 20
      languages a day).
- [ ] Through the real host, once the production es-419 entry exists (these need the **production** Worker and a
      production entry): `https://tc-helps.mcp.servant.bible/v2/packs/<COMPAT>/es-419` and one of its packs — HEAD,
      Range GET, GET with `If-None-Match`, and OPTIONS with an `Origin` header, each twice. Status, `ETag` and
      `Access-Control-*` must be identical the second time (served from Pages' cache). Repeat the step-7 checks
      (Content-Length, 416, stamps) with `BASE=https://tc-helps.mcp.servant.bible`.
- [ ] Through `https://tc-helps.mcp.servant.bible`, a packs response that carries `Retry-After` (for example a 503 or
      202 for a language with no entry), sent with an `Origin` header, must list `Retry-After` in
      `Access-Control-Expose-Headers` (the Pages proxy in front could rewrite headers; unit tests do not see it).
- Parts in production are delivery 3's Task 14, each step with Abel's yes: tc-study lets parts publish to production
  (Task 13); Abel sets tc-study's repository variable `PACKS_PARTS_PRODUCTION` (Task 14 Step 1); `[env.production]`
  gets `PACKS_PARTS_DISPATCH = "on"` and the three parts crons ("Parts: crons" for the cron limit), then
  `PACKS_CLEANUP = "dry-run"` and, after a week of logs, `delete`. The spec (§6, "Meanwhile") has the backfill wait
  for parts; Task 14 rewrites this step for it.
- Approved by Abel: ☐

## Operations

- **Build status** (`status/<compat>/<lang>.json`):
  `{ state: 'running' | 'ok' | 'failed', at, failures, run, started?, code? }`. `at` is when the status was written
  (the end of the run for `ok`/`failed`); `started` is when the workflow's build began reading Door43, set by its
  `running` write and kept by `ok`/`failed`. The Worker's own `running` mark at dispatch has no `started`. A Door43
  release newer than the pack is taken as already seen (no `stale` build, `stale-seen` in Analytics) only when an `ok`
  build started after it; with no `started`, the Worker uses `at` minus 300 min (the job timeout) instead. `code` is
  written only by a parts run's `ok`: the builder code it built with ("Parts: the check").
- **Reset a stopped language** (three failures in a row; the route answers `503 {state:'unavailable', reason:
'stopped'}`): fix the cause, then either delete its status,
  `npx wrangler r2 object delete <bucket>/status/<compat>/<lang>.json --remote`, or dispatch the workflow by hand for
  that language and target; a successful publish writes `ok` and clears the count.
- **Kill switch**, from the gentlest:
  - `npx wrangler secret delete GITHUB_APP_ID --config wrangler.toml --env <env>`: the Worker stops dispatching and
    the route answers `503 {reason:'unconfigured'}` for missing languages; published packs are still served.
  - Suspend the GitHub App's installation (unfoldingWord → Settings → GitHub Apps → Configure → Suspend).
  - `gh workflow disable language-packs.yml -R unfoldingWord/tc-study` stops every run, by hand or dispatched.
- **After a compat bump in tc-study** (the sample-output check says so): update `CURRENT_PACK_COMPAT` in
  `src/packs/dispatch.ts` on `v2` and redeploy v2. Until then the Worker dispatches the old compat, the workflow sees
  the mismatch, marks that compat `failed` and builds nothing, and phones keep the packs they have.

### Parts: settings

Parts (`f2.0-…`, `CURRENT_PARTS_COMPAT` in `src/packs/dispatch.ts`) are served beside f1.1. These vars are in
`wrangler.toml`; a change needs a redeploy (step 6).

| Var                     | Meaning                                                                                                                                                                                                                                                         | Unset or invalid | Set today                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------ |
| `PACKS_PARTS_DISPATCH`  | Exactly `on` lets the Worker ask for parts builds. Anything else: no parts dispatch from a phone, the check or the cron; a missing parts list answers `404 parts-off`; the check and the cron's slice read nothing. Published lists and parts are still served. | off              | preview `on`; absent from production and `[vars]` on purpose |
| `PACKS_PARTS_DAILY_CAP` | Counted parts dispatches a day (KV `packs:dispatch-parts:<date>`), apart from f1.1's 20 (`packs:dispatch:<date>`). `0` closes counted dispatches. The cron's dispatches (reason `daily`) are not counted.                                                       | 20               | nowhere                                                      |
| `PACKS_SWEEP`           | `parts`: the f1.1 cron (`17 6 * * *`) sweeps nothing.                                                                                                                                                                                                           | f1.1 swept       | preview `parts`                                              |
| `PACKS_CLEANUP`         | Exactly `dry-run` (logs what it would delete, keeps the ledger) or `delete`. Anything else, `off` included, is off: no R2 call at all.                                                                                                                          | off              | preview `dry-run`; absent from production on purpose         |
| `PARTS_CHECKS_PER_RUN`  | Parts checks in one run of the hourly slice: digits only (as `PACKS_PARTS_DAILY_CAP`; `1e2` is invalid), `0` for none. Above 125, Analytics points can be lost (see the crons).                                                                                 | 5                | nowhere                                                      |
| `PARTS_RATE_LIMIT_RPM`  | Part requests a minute per IP, in a counter of their own (lists keep `RATE_LIMIT_RPM`, 90). `0` turns it off.                                                                                                                                                   | 600              | nowhere                                                      |

Production has none of them on purpose: it asks for no parts builds and deletes nothing until Task 14 adds
`PACKS_PARTS_DISPATCH` and `PACKS_CLEANUP` with Abel's yes (`tests/unit/packs-dispatch.test.ts` and
`packs-scheduled.test.ts` pin this).

### Parts: crons

The Worker picks the job by the cron string (`src/packs/scheduled.ts`); each job is its own invocation.

| Cron (UTC)    | Job                                                                                                                                                                                                              | production   | preview         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------- |
| `17 6 * * *`  | The f1.1 sweep (`runDailySweep`), as before delivery 3, unless `PACKS_SWEEP = "parts"`.                                                                                                                          | yes          | no              |
| `7 3 * * *`   | The parts cleanup, when `PACKS_CLEANUP` is `dry-run` or `delete`.                                                                                                                                                | no (Task 14) | yes (`dry-run`) |
| `7 4,5 * * *` | The cleanup again at 04:07 and 05:07, only when the ledger says that day's outcome was `postponed` or `aborted`.                                                                                                 | no (Task 14) | yes (`dry-run`) |
| `37 * * * *`  | The parts slice: the published parts languages whose `fnv1a32(language) % 24` is the hour (es-419 at 22, en at 18), at most `PARTS_CHECKS_PER_RUN`, reason `daily`. Nothing is read while parts dispatch is off. | no (Task 14) | yes             |

- Any other cron string (an old `17 * * * *` still deployed, a typo) does nothing and logs, with `console.error`,
  `[packs] cron-unknown: "<string>" is none of the packs jobs (…); nothing done`. **Alert on `[packs] cron-unknown:`**:
  the Worker does not guess the job from the clock, so that cron's job does not run at all.
- **After any deploy of a Worker with crons** (the first production deploy especially), watch the next run of each of
  its crons with `npx wrangler tail --config wrangler.toml --env <env>`:
  - production, at the next 06:17 UTC: `"17 6 * * *" @ … - Ok`, and no `[packs] cron-unknown:`,
    `[packs] f1.1 sweep stopped:` or `[packs] daily freshness sweep stopped:`. The f1.1 sweep logs no line of its own
    when nothing is stale, only `[packs] stale <compat>/<lang>: …` for each language it finds stale;
  - preview: `"37 * * * *" @ … - Ok` each hour, with `[packs] parts sweep <HH> UTC: …` in an hour whose slice has a
    language (es-419 at 22, en at 18; an empty slice logs nothing), `[packs] cleanup (dry-run): …` at 03:07, and no
    `[packs] cron-unknown:`.
- The Free plan allows **5 cron triggers per account**. Staging uses 3 and production 1. Task 14 must add the three
  parts crons to `[env.production.triggers]` together with the flags: 3 + 4 = 7, over 5 on Free, so on Free staging's
  crons would have to go (or the account be Paid). Other Workers' crons on the account count too (not checked).
- A run is kept under the Free plan's per-invocation limits (50 outside fetches, 1,000 KV and R2 calls): a parts check
  makes at most 14 fetches (9 after the run's first), so 5 checks a run. A crowded slice (k languages, more than
  `PARTS_CHECKS_PER_RUN`) checks at most that many a run, starting that many further along (sorted, as a ring) each
  day, and logs the rest as `left for another day`: each of its languages is checked by the cron at least every
  ⌈k / `PARTS_CHECKS_PER_RUN`⌉ days, and a phone that opens one still triggers its check in between. On a Paid plan
  `PARTS_CHECKS_PER_RUN` can be raised.
- Analytics Engine takes at most 250 data points per Worker invocation. A parts check writes at most 2 (its result,
  plus `parts-compat-drift` when master builds another compat), the slice itself none, so a run loses points only
  above **125** `PARTS_CHECKS_PER_RUN`. On Free that cannot happen (the 50-fetch limit keeps a run at 5 checks); it
  matters only on a Paid plan raised past 125. A lost point is caught and logged
  (`[packs] parts <lang>: analytics point not written`); the checks' results do not change.
- The slice's log line: `[packs] parts sweep <HH> UTC: <lang> <result>, …`.

### Parts: the check

A GET of a list under `CURRENT_PARTS_COMPAT` (200 or 304, not HEAD) and the cron's slice run the same check
(`src/packs/partsFreshness.ts`), at most once an hour per language. It computes no fingerprint and reads no git tree
or manifest: it compares the list's `stamps` (or, for a list without them, its resources' and its originals list's
stamps) with what Door43 and GitHub have now, and the list's `code` with the code in `status/builder.json`. When
something differs and no `ok` build has seen it yet, it asks for a parts build (`parts: true`), and the build decides
unit by unit what to rebuild.

- Log line: `[packs] parts <compat>/<lang>: <result> (<key> <built stamp|new> → <now>; code <list's> → <builder's>)`,
  with `; not compared, unreadable: …` when an input could not be read (it is left out, so it cannot ask for a build).
  Results: `fresh`, `seen` (an `ok` build already saw the change), `budget` (a code-only change the cron may not
  spend today), `unknown` (the language's search failed or found no row of it, or the first-seen records could not be
  read: see below), `no-list`, or the dispatch outcome
  (`dispatched`, `running`, `cooling`, `stopped`, `capped`, `unconfigured`, `invalid`, `error`). Analytics:
  `parts-<result>` (`parts-stale-seen` for `seen`).
- A check that crashes (a KV or R2 call that throws, a limit reached) asks for nothing and logs, with `console.error`,
  `[packs] parts <compat>/<lang>: freshness unknown: <error>` instead of the usual line; its result is `error`, and
  Analytics `parts-error`, as for a dispatch that failed.
- Breakers: a moved stamp is seen when an `ok` build started after both the stamp's own date and the moment this Worker
  first saw it (`packs:first-seen:*`); a code change is seen only by an `ok` status whose `code` is the builder's. The
  dispatch guard (`running` 5.5 h, `cooling` 24 h after a failure, `stopped` after 3) applies as for f1.1.
- When the first-seen records cannot be read (the one bulk KV read throws), no change can be dated, so the check asks
  for nothing: result `unknown`, logged `[packs] first-seen records unreadable: <error>` (`console.error`) and
  `[packs] parts <compat>/<lang>: unknown (first-seen records unreadable) (<changes>)`, Analytics `parts-unknown`,
  no record written. Dating every change "now" instead would ask for a build on every check while KV fails.
- Code-only rebuilds from the cron: at most 10 a day (`CODE_REBUILDS_PER_DAY`), so a code bump reaches 100 languages in
  about 10 days. A phone's visit asks sooner, counted against `PACKS_PARTS_DAILY_CAP`. A moved stamp spends no budget.

### Parts: keys

| KV key                                 | What                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packs:fresh:<compat>:<lang>`          | The check's hour (f1.1 and parts alike, each under its compat), 1 h.                                                                |
| `packs:dispatch-parts:<date>`          | Counted parts dispatches that day (`PACKS_PARTS_DAILY_CAP`), 2 days. f1.1 keeps `packs:dispatch:<date>`.                            |
| `packs:code-rebuilds:<date>`           | Code-only rebuilds the cron asked for that day (≤ 10), read once and written once a run, 2 days. An unreadable counter allows none. |
| `packs:first-seen:<32 hex>`            | When this Worker first saw a stamp (the first 32 hex of `sha256("<key>\|<stamp>")`), written once, 400 days.                        |
| `packs:originals`, `packs:macula`      | The UHB/UGNT and MACULA readings shared by every language: 1 h, 10 min when an input was left out.                                  |
| `packs:github-token:<installation id>` | The GitHub App's installation token (also used for MACULA's commits), 50 min.                                                       |

| R2 key                       | Writer                                                                             | What                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `status/builder.json`        | tc-study: `packs-builder.yml`, and every parts publish run of `language-packs.yml` | `{ compat, code, commit, at }`: the code master's parts build runs with. |
| `cleanup/parts-orphans.json` | the Worker's cleanup                                                               | The cleanup's ledger ("Parts: the cleanup").                             |

### Parts: the builder file and the compat

- `status/builder.json` is written by `packs-builder.yml` on every push to tc-study's `master` that touches
  `packages/**`, `bun.lock` or `scripts/build-pack-tools.sh`, and by hand (`workflow_dispatch`): to the staging bucket
  always, to production only when the repository variable `PACKS_PARTS_PRODUCTION` is `true`. Every parts publish
  run from `master` writes it too ("Builder code" step), unless master has moved since the run's commit. `at` is kept
  while the compat and code stay the same. The Worker reads `compat` and `code`; a file that does not parse is no file,
  and asks for no code rebuild.
- **`compat-drift`**: `builder.compat` is not this Worker's `CURRENT_PARTS_COMPAT`, so master builds a compat the
  Worker does not ask for. The check logs it, Analytics `parts-compat-drift`, and asks for no code rebuild:
  `[packs] parts <compat>/<lang>: compat-drift (master builds <compat>); no code rebuild`. It still compares stamps,
  and a dispatch for a moved stamp is then refused by the workflow's Check compat, which marks that compat `failed`.
  So it means: update `CURRENT_PARTS_COMPAT`.
- **After a parts compat bump** in tc-study (`packs-status.ts --print-compat --parts`, in
  `packages/resource-pipeline/cli/`, prints the new one): as for f1.1, update `CURRENT_PARTS_COMPAT` in
  `src/packs/dispatch.ts` on `v2` and redeploy. The workflow's Check compat covers parts (it compares with
  `--print-compat --parts`): until the redeploy, a parts dispatch of the old compat is marked `failed` and builds
  nothing. After it, the old compat's published lists are still served, a missing one answers `404 old-compat`, and
  the cleanup keeps every part any parts compat's list names.
- **A stale `status/builder.json`** (`packs-builder.yml` failed after a push that changed the code): a list built
  since carries master's real code, not the builder file's, so its check asks for a code rebuild. Every parts publish
  from `master` rewrites `status/builder.json` with the real code in its "Builder code" step, so the next one (that
  rebuild or any other) ends it. Code rebuilds keep coming only while that step fails too, or when master has moved
  since the run's commit (the step then writes nothing), and they stay bounded by the caps (10 a day from the cron,
  `PACKS_PARTS_DAILY_CAP` from phones). Run `packs-builder.yml` by hand.

### Parts: the cleanup

Deletes parts no list has named for 30 days (`src/packs/cleanup.ts`). Only `parts/<sha256>.part.gz` and
`catalog/<parts compat>/originals/<sha256>.json` can ever be deleted; `packs/`, `v1/`, `status/`, `cleanup/`,
`catalog/f1.*`, every language list and every `originals.json` are out of its reach.

- **Named** is what any current list names, in every parts compat: the parts of every language list and of
  `originals.json`, the originals list each language list names and its parts, and the content-addressed copy of
  `originals.json`.
- **The ledger** `cleanup/parts-orphans.json`: `{ schema: 1, checked, since, outcomes }`. `since` maps each unnamed
  key to the first run that found it unnamed; `outcomes` maps each of the last 7 UTC days to `done`, `postponed` or
  `aborted`. A key named again, or gone, leaves `since`. If `checked` (the last finished run) is more than 3 days
  old, every count starts again: "30 days in a row" needs runs to watch them. The run says so once, with the date of
  the last finished run and the first day anything can be due:
  `[packs] cleanup (<mode>): every count starts again, as the last finished run was <time>, …; nothing is due before <day>`
  (so a long `would delete 0` tail in `dry-run` after it is expected). A ledger that does not parse also restarts
  every count; deleting it does the same.
- **Due**: `since` 30 days ago or more **and** R2's `uploaded` 30 days ago or more. tc-study puts a part it names
  again when R2 wrote it more than 20 days ago (`PART_REFRESH_DAYS`), so an old `uploaded` means no build has named it
  for 30 days. Oldest first, at most 1000 deletes a run (one R2 call); the rest wait for the next run.
- **Stops**: `postponed` while any `status/<parts compat>/<lang>.json` is `running` and younger than 5.5 h; `aborted`
  when any list or listing cannot be read or does not parse, when a list was added, removed or rewritten (or a status
  turned `running`, or a parts compat appeared) between the reading and the recheck just before the deletes, or past
  800 R2 calls in the run. A run stopped before the deletes deletes nothing and records only the day's outcome.
- **Its log**:
  - `[packs] cleanup (<mode>): done; <N> named, <M> unnamed, <D> due; deleted <K> (<X> MB)` (`would delete` in
    `dry-run`), with `, <R> left for the next run` past 1000, and `; <C> R2 calls`;
  - `[packs] cleanup (<mode>): postponed, <status key> is running`, or `aborted, <why>`;
  - the retries: `[packs] cleanup (<mode>) retry: the day's cleanup was <outcome>` (`; nothing to retry` when it was
    `done`; a day with no outcome is an alert, below);
  - Analytics `["pack", "cleanup", <mode>, <state>]`, doubles `[deleted, bytes, due]`.

  In `dry-run`, read the counts and MB against what lists dropped before switching to `delete`.

- **What to alert on** (all `console.error`):
  - `[packs] cleanup-alert: aborted <N> days in a row (since <day>); last: <why>`: logged from the 3rd day in a row
    that ends `aborted`. Read `<why>` and fix it. Only days that end `aborted` count: a day that ends `postponed` or
    `done`, or a day with no run, breaks the streak.
  - `[packs] cleanup-alert: no outcome recorded for <day>: the 03:07 UTC cleanup (<mode>) was killed, …; not retried`:
    logged by each retry (04:07 and 05:07) while `PACKS_CLEANUP` is on and the ledger has no outcome for the day.
    Every run that ends records one, so the 03:07 run was killed before it could (over its CPU or memory limit, such
    as the Free plan's 10 ms of CPU), or never ran, or could not read or write the ledger (a failed write is logged
    `… could not record the day's outcome`). Nothing is retried: look at the 03:07 invocation in
    the dashboard or with `wrangler tail`.
  - `… started during the deletes; if its list names a deleted part, rebuild it with force` and
    `<list> names <N> deleted key(s) (…); it was written during the deletes; rebuild with force`: a build raced the
    deletes. Dispatch that language with the workflow's `force` input.

### Parts: kill switches

- The existing ones stop parts dispatches too: without any of the three App secrets `requestBuild` answers
  `unconfigured` for every compat (a missing parts list answers `503 {reason:'unconfigured'}`); a suspended App makes
  every dispatch fail (`error`, the status put back); a disabled workflow runs nothing.
- `PACKS_PARTS_DISPATCH` removed (anything but `on`), and redeployed: no parts dispatch at all, from phones, the check
  or the cron. Lists and parts are still served, and f1.1 is not affected.
- `PACKS_CLEANUP` removed (or `off`, or anything but `dry-run`/`delete`), and redeployed: no cleanup run, so no delete.

### Parts: publishing by hand

Publish parts only through the workflow (the Worker's dispatch, or `workflow_dispatch` from `master`). The workflow
writes `running` before it builds, and the cleanup waits for it. A local `cli/publish-language.ts --parts` with the
`R2_*` variables writes no `running` status, so the cleanup cannot see it: only tc-study's refresh and its HEAD of
every part before the lists protect such a run. Keep local runs to `--no-upload`.

### Parts: comparing the stamps

`scripts/packs-parts-stamps.ts` prints where the Worker's stamps for a language differ from a published list's. It
exits 0 with `[]` when they agree; 1 on a difference or on `unknown` (the language's search failed or found no row of
it); 2 on bad arguments, on a list or builder file that cannot be read or is not one, or on a `--base` that does not
answer 200 with a schema 2 list. It is the real-data gate before parts checks may dispatch: run it **before** the
preview Worker is deployed, with `--list` on files saved from R2:

```bash
npx wrangler r2 object get language-packs-staging/catalog/<compat>/<lang>.json --remote --file <lang>.json
npx wrangler r2 object get language-packs-staging/status/builder.json --remote --file builder.json
npx tsx scripts/packs-parts-stamps.ts --list <lang>.json --builder builder.json --lang <lang>
```

For a list without `stamps`, save its originals list the same way and pass it with `--originals`.
`--base <Worker URL>` GETs the list from a Worker, and that GET runs the Worker's check, which can dispatch: use
`--base` only against a Worker with `PACKS_PARTS_DISPATCH` off (not preview).

### Parts: open points

- The originals search sends no language on either side (`owner=unfoldingWord&subject=…&stage=prod&limit=1`, because
  tc-study's `originalLanguageCatalog.ts` passes `lang:`, which its client ignores). Move both to `language=` later, in
  one change, so the stamps stay identical.
- The Free plan's 10 ms of CPU per invocation is not measured for the cleanup (JSON parsing, the sha256 of each
  `originals.json`) on a large bucket, nor for the f1.1 sweep.
- A stale `status/builder.json` causes code-rebuild attempts, bounded by the caps ("Parts: the builder file").
- KV writes on the Free plan (1,000 a day): each check a phone triggers writes the hour's claim
  (`packs:fresh:<compat>:<lang>`, so at most 24 a day per language opened every hour), plus a first-seen record per
  new stamp and, now and then, the shared readings and the token. About 40 parts languages opened all day would use
  them up. It fails safe (the claim's put throws, the check ends `error` and asks for nothing), but the catalog
  cache's background writes then fail too, for the rest of the day.

## Client contract: whole packs (f1.1)

Paths are under `/v2/packs/`: `<compat>/<lang>` is a language's entry, `<compat>/<lang>/<sha256>` (and
`<compat>/originals/<sha256>`) a pack, as the entry names it.

| Answer                                                        | Meaning, and what the app does                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `200` entry, `Cache-Control: no-cache`, `ETag`                | The current entry. Keep the ETag and send it as `If-None-Match` next time.                               |
| `304`                                                         | The entry has not changed.                                                                               |
| `202 {"state":"preparing"}`, `Retry-After: 600`               | A build is on its way (dispatched, running, cooling down, or the day's cap is reached). Ask again later. |
| `503 {"state":"unavailable"}`, `Retry-After: 300`             | Door43 could not be asked whether the language has packs. Ask again later.                               |
| `503 {"state":"unavailable","reason":…}`, `Retry-After: 3600` | No build will come without a person: `stopped`, `unconfigured`, `error`, `invalid`. Do not poll fast.    |
| `404 {"state":"unavailable","reason":"old-compat"}`           | The app is older than the packs: update the app.                                                         |
| `404 {"error":"no packs for this language"}`                  | The language is not eligible (not tc-ready, or no literal Aligned Bible).                                |

- Packs are content-addressed and immutable (`Cache-Control: public, max-age=31536000, immutable`); `Range` is
  supported (206, 416 past the end), and `HEAD` gives the size.
- Download a pack in chunks of **at least 4 MB**: the rate limit is 90 requests a minute per IP, and Range responses
  are not cached by Pages, so each chunk can reach the Worker and count against the limit.
- Every 4xx and the 202 carry `Cache-Control: no-store`; CORS allows any origin.

## Client contract: parts (f2.0, Servos)

Paths are under `/v2/packs/`; `<compat>` is the parts compat (`CURRENT_PARTS_COMPAT` in `src/packs/dispatch.ts`,
`f2.0-u2.3.0-p6000230-q9-a12-t1` today).

| Path                          | What                                                                   | Cache-Control                                       | Content-Type       |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ------------------ |
| `<compat>/<lang>`             | The language's parts list (schema 2).                                  | `no-cache`, with an `ETag`                          | `application/json` |
| `<compat>/originals/<sha256>` | The originals list the language list names: `<list.originals.sha256>`. | `public, max-age=31536000, immutable`               | `application/json` |
| `parts/<sha256>`              | One part, by the `sha256` of a list's `parts[]` entry.                 | `public, max-age=31536000, immutable, no-transform` | `application/gzip` |

`<compat>/<lang>/<sha256>` under a parts compat is `400 {"error":"bad pack path"}`: a language's parts are under
`parts/`. `catalog/<compat>/originals.json` (the latest originals list) is not served; follow the language list's
`originals`.

The list answers as the f1.1 entry does, as in the table above: `200` with its `ETag`, `304` (with the
`Access-Control-*` headers), `202 {"state":"preparing"}`, the `503` answers, `404 old-compat` and
`404 {"error":"no packs for this language"}`. One more:

| Answer                                             | Meaning, and what the app does                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `404 {"state":"unavailable","reason":"parts-off"}` | The app is current, but this Worker asks for no parts builds yet (production until delivery 3's Task 14). Not `old-compat`: ask again later. |

- **Parts and originals lists are immutable**, named by content. A part is `application/gzip` with no
  `Content-Encoding`, so the browser does not decode it: the app checks that the sha256 of the bytes it received is
  the name, and only then gunzips them (JSONL rows `{"layer", "key", "value"}`). A mismatch is discarded and fetched
  again. `HEAD` gives a part's size (`Content-Length`, which equals the list's `bytes`); `Range` is allowed (206,
  416 past the end) for resuming.
- **Rate limit:** parts have their own, **600 requests a minute per IP** (`PARTS_RATE_LIMIT_RPM`); lists and originals
  lists keep 90. Past it: `429` with `Retry-After`; wait that long and go on. All of English is about 730 parts.
- A missing part or originals list is `404` (`{"error":"part not found"}`, `{"error":"originals list not found"}`) and
  asks for no build: a list names only what its build wrote. A list the app holds can be old, though: once a later
  build drops a part (or an originals list), the cleanup deletes it 30 days after the last list named it, so a phone
  resuming from an old list can meet this `404`. **On a `404` for a part or an originals list, fetch the language list
  again and continue from it; do not retry the part.**
- A GET of the list (not a HEAD) lets the Worker check, at most once an hour per language, whether the list is behind
  Door43 or the builder; a newer list comes on a later visit.
- **After importing the parts**, the app sets the resource's `availability.offline`: the catalog row restored from the
  list (`restoreCatalogBookkeeping`) has `catalogedAt` (the import time) and `availability.offline: false`, since the
  list leaves `availability` out.
- Every 4xx, 429 and the 202 carry `Cache-Control: no-store`; CORS allows any origin and exposes `ETag`,
  `Content-Range`, `Content-Length`, `Accept-Ranges` and `Retry-After`.

## Rotation

- GitHub App private key: App settings → Private keys → generate a new one, update `GITHUB_APP_PRIVATE_KEY` on both
  envs (`wrangler secret put`, step 5), check a dispatch works, then delete the old key.
- R2 token: dashboard → R2 → Manage API tokens → roll or create a new one, update the four `R2_*` secrets in both
  Environments (step 3), run a `no-upload` then a staging publish, then revoke the old token.

## Record (fill in as steps finish)

- URLs, first entries' build ids, English figures (peak RSS, wall time): _pending_
