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
  cron `17 6 * * *` in production only.
- Approved by Abel: ☐

## 6. Deploy and Pages check

- [ ] Deploys: only from `v2`. Either `scripts/deploy-v2-production.sh` (production only; it builds the web first),
      or per env, from the repo root:
  1. Build the web with the `/v2` base path (the Worker serves its assets from `web/.svelte-kit/cloudflare`):
     - bash: `npm install && BASE_PATH=/v2 npm run build --workspace=translation-helps-mcp-web`
     - PowerShell: `npm install; $env:BASE_PATH = '/v2'; npm run build --workspace=translation-helps-mcp-web`
  2. `npx wrangler deploy --config wrangler.api.toml --env <env>`
  3. `npx wrangler deploy --config wrangler.toml --env <env>`
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
- Approved by Abel: ☐

## Operations

- **Build status** (`status/<compat>/<lang>.json`):
  `{ state: 'running' | 'ok' | 'failed', at, failures, run, started? }`. `at` is when the status was written (the
  end of the run for `ok`/`failed`); `started` is when the workflow's build began reading Door43, set by its `running`
  write and kept by `ok`/`failed`. The Worker's own `running` mark at dispatch has no `started`. A Door43 release
  newer than the pack is taken as already seen (no `stale` build, `stale-seen` in Analytics) only when an `ok` build
  started after it; with no `started`, the Worker uses `at` minus 300 min (the job timeout) instead.
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

## Client contract (for plan 3, Servos)

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

## Rotation

- GitHub App private key: App settings → Private keys → generate a new one, update `GITHUB_APP_PRIVATE_KEY` on both
  envs (`wrangler secret put`, step 5), check a dispatch works, then delete the old key.
- R2 token: dashboard → R2 → Manage API tokens → roll or create a new one, update the four `R2_*` secrets in both
  Environments (step 3), run a `no-upload` then a staging publish, then revoke the old token.

## Record (fill in as steps finish)

- URLs, first entries' build ids, English figures (peak RSS, wall time): _pending_
