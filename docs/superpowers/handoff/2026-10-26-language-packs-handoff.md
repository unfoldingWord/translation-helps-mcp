# Language packs in parts: handoff (2026-10-26)

From the cloud session (Claude Code on the web) to a local agent on Abel's machine. Everything below is pushed;
nothing lives only in the cloud container. Talk to Abel in Spanish, informal (tú). Commits and code comments in
English, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is deployed, published or
merged without Abel's explicit yes (Abel merges PRs himself).

## Where things are

| Repo | Branch | State |
|---|---|---|
| unfoldingWord/tc-study | `master` | Plans 2b-1 and 2b-2 merged (PRs #46–#49): parts build, fingerprints, reuse, publish to staging. |
| unfoldingWord/tc-study | `feat/packs-builder-stamps` | Delivery 3, tc-study side (Tasks 10–11 + review fixes): `PartsList.stamps`, `status/builder.json`, `packs-builder.yml`, ok status records `code`, parts publish only from master, separate concurrency groups. Pushed, **no PR yet**. |
| unfoldingWord/translation-helps-mcp | `feat/packs-worker-parts` (from `v2`) | Delivery 3, Worker side: Tasks 1–6 committed and pushed; Tasks 7–8 (sweep, cleanup) in progress at handoff time — check `git log`. **No PR yet.** |
| translation-helps-mcp | `docs/packs-delivery-3` | Plan for delivery 3: `docs/superpowers/plans/2026-10-26-language-packs-3-worker-parts.md`. |
| translation-helps-mcp | `docs/packs-spec-2b2` | The spec with the exact fingerprint rules (§2) and list format (§3) as 2b-2 built them. |
| translation-helps-mcp | `docs/packs-delivery-2b2`, `docs/packs-delivery-2b1` | Plans 2b-2 and 2b-1 (done). |
| translation-helps-mcp | `docs/packs-handoff` | This file and the ledgers (`docs/superpowers/ledgers/`). |
| translation-helps-mcp | PR #76 `feat/packs-compat-q9-a12` | **Open, must merge + deploy to v2.** `CURRENT_PACK_COMPAT` on v2 is still `…q8-a11…`, but tc-study master builds `…q9-a12…` since 2a (#45). Until #76 is deployed, f1.1 builds the Worker dispatches fail the workflow's compat check. `feat/packs-worker-parts` was branched before #76: merge/rebase it after #76 lands. |
| translation-helps-mcp | PR #77 `docs/packs-delivery-2a` | Open, docs only (spec split + plan 2a). |

The ledgers record every decision, review finding and fix, per task: `docs/superpowers/ledgers/2b1-ledger.md`,
`2b2-ledger.md`, `3-ledger.md` on the `docs/packs-handoff` branch. Read `3-ledger.md` before touching delivery 3.

## What is proven on real data (GitHub runners, staging bucket `language-packs-staging`)

- es-419: the parts build has exactly the rows of the whole build (`compare-parts`, 0 differences); Door43 trees
  match the hashed bytes (13/13).
- es-419 published to staging as parts (run 40102385263), then the same run again → `unchanged`: 0 built, 67
  carried, 0 parts put, 39 s (run 40105337520).
- English published to staging (run 40256783240): 595 parts put, 132 originals parts already there (shared with
  es-419 by content), 2.2 GB peak, 13 min; second run `unchanged`, 68 carried, 85 s (run 40258456345).
- Bucket counts settled with Abel: TW 8 per folder, TA translate 4 (no format bump).
- Compat for parts: `f2.0-u2.3.0-p6000230-q9-a12-t1`; parts code today
  `f2.0-u2.3.0-p6000230-q9-a12-t1+7bc31e739fbeed69`.

Expected next: after `feat/packs-builder-stamps` merges, the next staging publish of es-419/en rewrites only the
lists (they gain `stamps`), `published` with 0 parts put; then `unchanged` again.

## Delivery 3: what is left

Plan tasks (see the plan and `3-ledger.md` for every amendment):

1. **Finish Tasks 7–8** if not committed (hourly cron with per-language slices; cleanup with a first-seen ledger,
   modes off/dry-run/delete, default off, staging dry-run). Production must get no parts dispatch and no deletes.
2. **Fix the Tasks 4–6 review findings** (recorded in `3-ledger.md`, "Review 4-6"):
   - H1: a lexicon/MACULA change can be marked seen with no build (commit date earlier than the merge). Keep a KV
     first-seen time per key+stamp; a change's date is `max(stampDate, firstSeen)`.
   - M1: `scripts/packs-parts-stamps.ts` with `--base` GETs the list, which can dispatch on preview (flag on) and
     accepts a 202. Require 200 + schema 2; run the gate with `--list` (list fetched with `wrangler r2 object get`)
     before deploying preview, or deploy preview with `PACKS_PARTS_DISPATCH` off until the gate prints nothing; add
     `--builder` to compare `list.code` with `builder.code`.
   - M2: one unreadable input (GitHub 60/h anonymous, a lexicon read) makes the whole check `unknown`. Leave
     unreadable inputs out of the map (a key only in the list is ignored); no literal text = no lexicons.
   - LOW items listed there (originals query `lang` vs `language` in tc-study, catalog cache staleness for checks,
     MACULA keys, undated stamps, stale builder.json, waitUntil cut-off).
3. **Review Tasks 7–8**, then Task 9 (docs: client contract, operations, spec rewrite of §2 "For the Worker" —
   the Worker decides by stamps + code, not fingerprints: Abel's decision 1).
4. **Final review** of both branches; open PRs: tc-study `feat/packs-builder-stamps` → `master`; MCP
   `feat/packs-worker-parts` → `v2` (after #76).
5. **Task 12, staging, each step with Abel's yes:** run the gate (Task 6 script) against the staging lists of
   es-419 and en; it must print no differences before any dispatch. Then deploy the preview Workers
   (`translation-helps-mcp-v2-preview` / `translation-helps-api-v2-preview`) and watch the cron in dry-run.
6. **Task 13 (tc-study):** lift the workflow's refusal of parts publishes to production.
7. **Task 14, production, each step with Abel's yes:** set `PACKS_PARTS_DISPATCH = "on"` in production, the
   `packs-production` Environment var `PACKS_PARTS_PRODUCTION`, then cleanup modes.

Then: delivery 2c (MCP views from parts) and Servos plan 3 (download parts, apply all at once).

## Decisions taken with Abel in this session

- Whole packs stay format `1.1.0`; parts use `PARTS_FORMAT_VERSION 2.0.0` (deployed apps refuse major 2).
- 2b-2 decisions 1–15 confirmed; decision 12 amended: the fingerprint `code` = parts compat + hash of every
  row-producing code version, including installed npm versions on the row path and stamp formats.
- OBS parts are refused (`--parts --obs`) until the OBS loader reads the hashed zip.
- Delivery 3 decisions confirmed, incl. #1: the Worker decides by stamps and builder code, not fingerprints.
- Amendments after review (tell Abel if asked): parts dispatch behind `PACKS_PARTS_DISPATCH` (on only in
  `[env.preview]`); a separate daily cap for parts (`PACKS_PARTS_DAILY_CAP`, default 20); parts served with
  `no-transform`; `builder.at` = when that code first appeared.

## How to work (what worked here)

- Subagent-driven: one implementer per task or small batch, a reviewer per batch, a final review on the most
  capable model; ledgers updated after each step. Run reviewers read-only in parallel with the next implementer
  when they touch different files.
- tc-study: Bun (workflow uses 1.3.3), `bun install`, `bash scripts/build-pack-tools.sh` after changing a package
  others import (they read `dist/`), then `git checkout -- packages/toc-generator-cli/bin
  packages/door43-api/tsconfig.tsbuildinfo` (generated noise). Many files are CRLF: edit with tools that keep it.
  Pre-existing failures: door43-api 25 (network), scripture-loader 1, TN loader 3. actionlint 1.7.7 for workflows.
- translation-helps-mcp: npm; `npx vitest run tests/unit/`, `npm run typecheck`, `npm run lint`, prettier.
- Runs on GitHub: `language-packs.yml` on `master` with `language`, `mode` (publish / no-upload), `target`,
  `parts`, `compare`. The run's summary and the `packs-result` artifact hold the report; the job log has the
  per-unit lines (`book psa: …`, `Listo: …`, `partes subidas`, `la lista no cambió`).
- The cloud session could not reach git.door43.org nor download artifacts; a local agent can.

## Left on Abel's machine from an earlier session

- Taller: uncommitted work from another session in `git stash` (`stash@{0}`, "WIP de otra sesión…"; restore with
  `git stash pop`).
- Taller: `respaldos/qa-2026-10-03/` ignored locally via `.git/info/exclude` (remove that line to undo).
