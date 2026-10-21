# Language packs: infrastructure checklist

Nothing here is created yet. Do the steps in order, one at a time. Each step needs Abel's yes before anyone runs it.
Staging first (steps 1–6 with the staging names), then production (repeat the production lines of steps 1–3 and 5).

Account: unfoldingWord, `5a3ffd86280d3ed086be76d955829242`.
Deploys come only from the `v2` branch. v1 (`main`, Pages) is not touched.

## 1. R2 buckets

- [ ] Creates: `language-packs-staging` and `language-packs`.
- How: from any wrangler login on that account:
  - `npx wrangler r2 bucket create language-packs-staging`
  - `npx wrangler r2 bucket create language-packs` (production, later)
- Verify: `npx wrangler r2 bucket list` shows the bucket.
- Approved by Abel: ☐

## 2. R2 API token

- [ ] Creates: one token, Object Read & Write, limited to those two buckets.
- How: Cloudflare dashboard → R2 → Manage API tokens → Create API token. Permission "Object Read & Write", specific
  buckets `language-packs-staging` and `language-packs`. Copy the Access Key ID and Secret once.
  Endpoint: `https://5a3ffd86280d3ed086be76d955829242.r2.cloudflarestorage.com`.
- Verify: the token page lists exactly those two buckets. Keep the values out of chat and out of any repository.
- Approved by Abel: ☐

## 3. tc-study GitHub Environments

- [ ] Creates: Environments `packs-staging` and `packs-production` in `unfoldingWord/tc-study` (default branch
      `master`).
- How: repository Settings → Environments → New environment. Deployment branches: selected branches, only `master`.
  Secrets per environment:

  | Secret                 | `packs-staging`          | `packs-production` |
  | ---------------------- | ------------------------ | ------------------ |
  | `R2_ENDPOINT`          | the endpoint above       | same               |
  | `R2_BUCKET`            | `language-packs-staging` | `language-packs`   |
  | `R2_ACCESS_KEY_ID`     | from step 2              | same               |
  | `R2_SECRET_ACCESS_KEY` | from step 2              | same               |

  CLI alternative: `gh secret set <NAME> --env <env> --repo unfoldingWord/tc-study`.

- Verify: both Environments show branch rule `master` and four secrets. The workflow
  `.github/workflows/language-packs.yml` (inputs `language`, `mode` publish|no-upload, `target` staging|production)
  reaches `master` when the tc-study branch `feat/packs-workflow` is merged; until then it cannot be dispatched.
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
- How: from a checkout of the `v2` branch, for each name and each env:
  `npx wrangler secret put <NAME> --config wrangler.toml --env <env>`.
- Verify: `npx wrangler secret list --config wrangler.toml --env <env>` shows the three names.
- Already in wrangler (no action): `PACKS_TARGET` (staging/production), binding `LANGUAGE_PACKS` (base and preview →
  `language-packs-staging`, production → `language-packs`), cron `17 6 * * *` in production only.
- Approved by Abel: ☐

## 6. Deploy and Pages check

- [ ] Deploys: only from `v2`, using `scripts/deploy-v2-production.sh`, or per env
      `npx wrangler deploy --config wrangler.api.toml --env <env>` then
      `npx wrangler deploy --config wrangler.toml --env <env>`.
- [ ] Check, no change required: Cloudflare Pages project `translation-helps-mcp` (v1) → Settings → Bindings. If the
      service binding `V2` → `translation-helps-mcp-v2` is set, `/v2/*` uses it; if not, it goes through the
      workers.dev fallback, which still works.
- Approved by Abel: ☐

## 7. First real checks

- [ ] Staging, against the workers.dev URL of the preview Worker: HEAD one pack and one entry (Content-Type and
      Cache-Control as in the plan's Global Constraints); a Range GET (206); a GET with `If-None-Match` (304).
- [ ] Through the real host `https://tc-helps.mcp.servant.bible/v2/packs/…`: HEAD, Range GET, GET with
      `If-None-Match`, and OPTIONS with an `Origin` header, each twice. Status, `ETag` and `Access-Control-*` must be
      identical the second time (served from Pages' cache).
- Approved by Abel: ☐

## 8. English measurement

- [ ] Dispatch the workflow with `mode: no-upload`, `language: en`, `target: staging`. Read peak RSS and wall time in
      the run summary.
- Stop rule: peak RSS over 12 GB, or an out-of-memory kill, means no publish. Add a plan-1 follow-up (stream the
  `buildLanguagePack` layers to disk) before trying again.
- Record the figures at the end of this file.
- Approved by Abel: ☐

## 9. Production

- [ ] Repeat steps 1–3 and 5 with the production names, deploy both Workers `--env production` from `v2`, dispatch
      `es-419` and `en`, then start the backfill (at most 20 languages a day).
- Approved by Abel: ☐

## Rotation

- GitHub App private key: App settings → Private keys → generate a new one, update `GITHUB_APP_PRIVATE_KEY` on both
  envs (`wrangler secret put`, step 5), check a dispatch works, then delete the old key.
- R2 token: dashboard → R2 → Manage API tokens → roll or create a new one, update the four `R2_*` secrets in both
  Environments (step 3), run a `no-upload` then a staging publish, then revoke the old token.

## Record (fill in as steps finish)

- URLs, first entries' build ids, English figures (peak RSS, wall time): _pending_
