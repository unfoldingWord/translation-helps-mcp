# Language packs delivery 3: the Worker serves parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The MCP v2 Worker serves the parts format (`f2.0-…`) beside the whole packs (`f1.1-…`): the language lists
(no-cache, 304), the originals lists and the parts (immutable, with their own rate limit), a `202 preparing` that asks
for a parts build, and `404 old-compat`. It asks for a parts build only when something the list was built from moved
(a release, a lexicon or MACULA commit, the builder's code), sweeps every published parts language once a day, and
deletes parts no list has named for 30 days. Then tc-study lets parts be published to production.

**Architecture:** The Worker gains a second current compat, `CURRENT_PARTS_COMPAT`, next to `CURRENT_PACK_COMPAT`.
Every f1.1 path stays as it is. For a parts compat the routes in `src/api/routes/packs.ts` serve
`catalog/<compat>/<lang>.json` (the existing entry route), `catalog/<compat>/originals/<sha256>.json` and
`parts/<sha256>.part.gz`. A new freshness check (`src/packs/partsFreshness.ts`) compares the stamps of everything the
published list was built from with what Door43 and GitHub have now. tc-study adds those stamps to the list
(`PartsList.stamps`). The check also compares the list's `code` with the code master builds today: tc-study writes
that code to `status/builder.json`. When something differs, the Worker dispatches the workflow with `parts: true`,
and the build decides unit by unit what to rebuild and what to carry. The Worker reads no git tree, reads no manifest
and computes no fingerprint (Decision 1): the build stays the only place where fingerprints are computed. A cleanup
in the scheduled handler deletes parts that no list has named for 30 days. It counts those 30 days from the first
sweep that found the part unnamed, and the dates are kept in a ledger in the bucket.

**Tech Stack:** TypeScript, Cloudflare Workers (R2, KV, Analytics Engine, Cron Triggers), Vitest (`npx vitest run`),
wrangler; in tc-study Bun (`bun test`), GitHub Actions (`actionlint`).

**Spec:** `docs/superpowers/specs/2026-10-21-language-packs-parts-design.md` (this repository, branch
`docs/packs-spec-2b2`, 2d26eb3): §2 steps 1, 5 and 7, "For the Worker" and the open point on `bookBlobsRef`; §3
"Writes", "Cleanup" and "Requests"; §5 (the answers Servos expects); §6 item 3. The 2b-2 ledger
(`tc-study/.superpowers/sdd/2b2-ledger.md`, "Task 12 spec" findings 1–10, reviews 5-6 and 7-8, Task 11 runs) is the
record of what was built; where it and the spec differ, the ledger wins.

**Code it must agree with** (tc-study `master`, 98ada3d): `packages/language-pack/src/parts/partsList.ts`
(`PartsList`, `partsListPath`, `originalsListPath`, `partPath` in `partFile.ts`),
`packages/resource-pipeline/src/language/publishLanguageParts.ts` (write order, `IMMUTABLE`/`NO_CACHE`),
`packages/resource-pipeline/src/language/partsCode.ts` (`partsCode()`), `buildLanguageParts.ts` (`ResourceFiles.stamp`
per input, `listResource`), `door43Stamps.ts` (`isObs`, `literalTextOf`), `cli/companions.ts` (`lexiconRepos`,
`LEXICON_OWNERS`, `resolveLexicon`, `lexiconStampOf`, `MACULA_KEYS`), `cli/maculaIdentity.ts`,
`cli/packs-status.ts`, `.github/workflows/language-packs.yml` (inputs `language`, `mode`, `target`, `compat`,
`force`, `parts`, `compare`).

**Measured (2b-2, Task 11):** English as parts with no upload (run 40099799266): 727 parts (595 of the language and
132 of the originals), a peak of 2169 MB (2.2 GB), 783 s (13 min), 13 archives (41.7 MB) and 0 failures. es-419 was
published to staging (run 40102385263): 67 units built and 213 parts put. A second run (run 40105337520) was
`unchanged`: 0 units built, 67 carried, 0 parts put, 213 already there, a 39 s build step and a peak of 756 MB. So a
build that carries everything is cheap, and this plan depends on that.

**Not in this delivery:** MCP views from parts (2c). Today the API Worker reads `v1/{lang}/notes|word-links/{BOOK}/
{chapter}.json` (schema 1, `src/api/routes/packViews.ts`, `PACK_VIEWS_SCHEMA`). Only whole (f1.1) builds write these
views (tc-study `writeMcpViews.ts`). A language published only as parts has no views, so its notes come from Door43
as they do today. 2c can regenerate the views from parts under the same keys and schema, with no change to this
Worker. The cleanup in this plan never touches `v1/`. Servos online (plan 3) uses the client contract that Task 9
writes.

## Global Constraints

- **Branches.** translation-helps-mcp: `feat/packs-worker-parts` from `v2` (Tasks 1–9). tc-study:
  `feat/packs-worker-signals` from `master` (Tasks 10–11), and later `feat/packs-parts-production` (Task 13). One
  commit per task. Comments and commits are in English, and every commit message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Edits keep each file's line endings.
- **Nothing is deployed, dispatched or published without Abel's yes**, and each step of Tasks 12 and 14 asks for it
  again. Staging comes first: the MCP Worker `translation-helps-mcp-v2-preview` (`--env preview`), bucket
  `language-packs-staging`. The API Worker (`translation-helps-api-v2-preview`) has no change in this delivery, so it
  is redeployed only if Abel wants both Workers deployed from the same commit. Production Door43 is only read.
- **f1.1 untouched.** `CURRENT_PACK_COMPAT`, `checkFreshness`, `isStale`, the f1.1 entry and pack routes, the
  `packs/` keys, `v1/` views and `status/f1.1-…` keep their behaviour. The existing tests in
  `tests/unit/packs.test.ts`, `packs-dispatch.test.ts` and `packs-freshness.test.ts` pass unchanged; the only edit
  allowed is to construct a test env that needs a new dependency. The f1.1 dispatch body stays byte-identical (it gets
  no `parts` input).
- **Compat keys.** `CURRENT_PARTS_COMPAT = "f2.0-u2.3.0-p6000230-q9-a12-t1"`: tc-study's
  `compatKeyOf(PARTS_FORMAT_VERSION, PACK_VERSIONS)`, which `packs-status --print-compat --parts` prints. A
  **parts compat** is one whose format major is 2 or more (`/^f([2-9]|\d{2,})\./`). `COMPAT_RE` in
  `src/packs/dispatch.ts` already accepts f2.0 and does not change.
- **Bucket keys the Worker reads** (the writer is in brackets):

  | Key                                        | Writer               | Served as                               | Cache-Control                         |
  | ------------------------------------------ | -------------------- | --------------------------------------- | ------------------------------------- |
  | `catalog/<compat>/<lang>.json`             | build (last)         | `/v2/packs/<compat>/<lang>`             | `no-cache` (ETag, own 304)            |
  | `catalog/<compat>/originals/<sha256>.json` | build                | `/v2/packs/<compat>/originals/<sha256>` | `public, max-age=31536000, immutable` |
  | `parts/<sha256>.part.gz`                   | build                | `/v2/packs/parts/<sha256>`              | `public, max-age=31536000, immutable` |
  | `status/<compat>/<lang>.json`              | workflow, Worker     | not served                              | —                                     |
  | `status/builder.json`                      | tc-study (Task 11)   | not served                              | —                                     |
  | `cleanup/parts-orphans.json`               | Worker (Task 8)      | not served                              | —                                     |

  A part is `application/gzip` with **no `Content-Encoding`**. The app checks the sha256 of the gzip bytes, so
  nothing between R2 and the phone may decompress or re-encode them. `catalog/<compat>/originals.json` (the latest
  originals list) is not served: a client follows the language list's `originals`.
- **The stamps the Worker compares** have the same strings as the build's `ResourceFiles.stamp`:
  - a Door43 release, from the catalog row: `resourceContentStamp`, `<tag>#<published_at>` with `:`, `|`, `@` turned
    into `_`. The Worker already writes it (`catalogStamp` in `packages/door43/src/resources/dcsClient.ts`, the
    `stamp` of each `CatalogEntry`);
  - a lexicon (`{owner}/{lang}/uhl|ugl`): `lexiconStampOf(commit)` = `<sha[0..10]>#<date>`. The commit is the one
    `master` names (`GET /api/v1/repos/{repo}/commits?sha=master&limit=1`). The date is `created`, or else
    `commit.committer.date`. A repository that answers 404 means no lexicon;
  - MACULA (`Biblica/hbo/macula`, `Biblica/el-x-koine/macula`): `<sha[0..10]>#<new Date(date).toISOString()>` with
    the same sanitizing (`…T12_00_00.000Z`). The commit is the one `git log -1 -- public/trees public/referents`
    gives in `idiomaspuentes/taller`, and the date is its committer date (`%cI`). Both keys get the same stamp.
- **Which resources** (tc-study discovery, spec §2 "Which resources"): rows of the catalog search
  `topic=tc-ready&stage=prod&lang=<lang>` (`catalogSearch`, `SEARCH_LIMIT` 500) whose `language` is the language and
  whose subject is in the spec's subject table. OBS is off: a row whose subject matches `/OBS|Open Bible Stories/i`
  (tc-study `door43Stamps.ts` `isObs`) is left out. Lexicon repositories in the search are left out, as
  `currentStamps` already does (`NOT_CATALOG_STAMPED`), because lexicons are stamped by commit. The other inputs are
  UHB and UGNT (the latest `stage=prod` row of `unfoldingWord`/`hbo`/`Hebrew Old Testament` and
  `unfoldingWord`/`el-x-koine`/`Greek New Testament`), the two lexicons of `LEXICON_OWNERS[lang] ?? <owner of the
  literal text>`, and MACULA. The literal text is the `Aligned Bible` whose repository id ends in `lt`. Keys are
  `owner/language/<repo name after the first _>`.
- **Never a build loop.** Every reason the Worker may dispatch for has a breaker. A change whose newest date is older
  than the start of an `ok` parts build counts as seen (`okBuildSawDoor43At`). The dispatch guard (`running`,
  `cooling`, `stopped`, the daily cap of 20) applies to parts as it does to f1.1. Code-only rebuilds have their own
  daily budget.
- **Never delete what a list names, or what a phone may still be fetching.** Task 8's rules apply to `parts/` and
  `catalog/<parts compat>/originals/` only.
- **Tests.** translation-helps-mcp: `npm ci` (npm 11, as `.github/workflows/ci.yml`), then
  `npx vitest run tests/unit/<file>`, `npm run typecheck` and `npm run lint`. CI runs `npm run test:ci`. tc-study:
  `bun test` in the package, `bash scripts/build-pack-tools.sh` after a change to a built package, and `actionlint` for
  workflows. These commands were not run while this plan was written (this checkout has no `node_modules`).

## Review Focus

- **f1.1 is byte-for-byte as before.** It has the same routes, the same dispatch body, the same freshness check, the
  same sweep (still once a day, at 06 UTC) and the same tests.
- **No loop, no storm.** Check every path that calls `requestBuild` for its breaker. A release of the originals, a
  MACULA commit or a code bump touches every published language. Check that the guard, the cap, the code budget and
  the hourly sweep slices (Decision 8) keep those dispatches bounded.
- **The Worker's stamps are the build's stamps.** If one key is derived differently (the tag against `version`, a date
  format, a key with another id), every check sees a change, and only the breaker stops it. Task 12 compares the two
  sides on real data before anything else is enabled.
- **Part bytes reach the phone unchanged.** A part has no `Content-Encoding`, the route sets its own Content-Type and
  Cache-Control whatever the upload had, and the sha256 of the bytes equals the name (Task 12 checks real R2).
- **The cleanup is safe in every order.** A part is deleted only when it has been unnamed for 30 days in a row, when
  no list was unreadable, and when no parts build is running at the start or before the deletes. Content-addressed
  originals lists follow the same rule. The cleanup never touches `packs/`, `v1/`, `status/`, `catalog/f1.*` or any
  list a language names.

## Findings addressed to delivery 3 (2b-2 ledger)

| Finding (ledger)                                               | Here                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1 tags-only list rewrite would break `bookBlobsRef` === tag     | Decision 2: a moved tag dispatches a build; the Worker rewrites no list               |
| 2 the Worker cannot see a new builder `code`                    | Decision 4: `status/builder.json`, written by tc-study (Task 11), read in Task 5      |
| 3 the list lacks manifest hashes                                | Decision 3: the list gains `stamps` of every input; manifest hashes are not needed   |
| 4 two OBS rules                                                 | The Worker uses `door43Stamps.isObs` (subject), the rule the build's candidates use   |
| 5–10 (MACULA `.json`, BOM/CR, path sets, ingredient stamps, lexicon title, unmapped folders, tree `per_page`) | Do not reach the Worker under Decision 1 (it reads no tree or manifest); they stay build-side follow-ups |
| Review 5-6 M-4 (the rules the Worker ports)                     | Only "which resources" and the stamp formats are ported (Global Constraints)          |
| Review 7-8: the app sets `availability.offline` after the parts | Written into the client contract (Task 9) for Servos                                 |
| Task 11 Step 6 (English to staging) pending                     | Task 12 Step 6: English's first staging publish is the Worker's own `202` dispatch    |

## Decisions taken in this plan (Abel to confirm)

1. **The Worker decides by stamps and code, not by fingerprints.** It cannot import
   `@bt-synergy/language-pack`. That package is not published, its `package.json` depends on
   `@bt-synergy/resource-catalog` (`workspace:*`), jszip and pako, and this repository is npm-only. A port would be
   a vendored copy of `fingerprint.ts`, `partInputs.ts` and `partSlots.ts` (with `keys.ts`), about 650 lines checked
   against the spec's golden vectors. On top of that, each check would need a git tree and a `manifest.yaml` for
   every input resource: en_uhl alone is about 9,000 files. Under Decision 2 such a comparison would ask for a build
   in exactly the cases where a stamp moved anyway. The only exception is a lexicon or MACULA commit that changes no
   input file, which costs one build that carries every unit. So the build stays the only place that computes
   fingerprints. With one implementation, the Worker and the build cannot disagree about one. Spec §2 "For the
   Worker" is rewritten in Task 9. *Alternative:* the vendored port with golden-vector tests and trees cached in KV
   by stamp. It is worth it only if the Worker should one day rewrite lists without a build.
2. **Tags-only changes go through a build** (finding 1, the spec's first option). A carried build rewrites the
   catalog rows exactly, since the rows are its own, and es-419 took 39 s. The cost is a build per release even when
   nothing changed, which includes one per published language for a UHB/UGNT release. Those builds download each
   language's zips again (15 MB for es-419, 42 MB for English).
3. **The list records the stamps of every input** (`PartsList.stamps`, language list only; Task 10). The
   alternative is to rebuild the stamps from `resources` and the originals list. That misses inputs that got no part,
   so the Worker would see such a resource as new on every check. Under Decision 1 the Worker needs no manifest
   hashes, so finding 3 becomes this field. Lists published before Task 10 fall back to `resources` plus the named
   originals list.
4. **The builder's code comes from `status/builder.json`** (finding 2). The file is
   `{ compat, code, commit, at }`, written to the bucket by a tc-study workflow on every push to `master` that
   touches the build (Task 11) and by every parts publish run. When `list.code` differs from `builder.code`, the
   Worker asks for a rebuild. `CURRENT_PARTS_COMPAT` stays a constant, as `CURRENT_PACK_COMPAT` does: when
   `builder.compat` differs from it, the Worker logs `compat-drift` and asks for no code rebuild. Following the
   builder's compat automatically is left for later.
5. **URLs.** A part is `/v2/packs/parts/<sha256>`, with no compat or language in the path, so identical parts share
   one cache entry across languages and compats. An originals list is `/v2/packs/<compat>/originals/<sha256>` for a
   parts compat; under f1.1 the same shape stays the originals pack. A language list is `/v2/packs/<compat>/<lang>`,
   the existing entry route. `/v2/packs/<parts compat>/<lang>/<sha256>` is a 400.
6. **Rate limit for parts:** 600 requests a minute per IP (`PARTS_RATE_LIMIT_RPM`, default 600), in a counter of its
   own, so a full English download (about 730 requests) cannot block that phone's list checks, which keep the limit
   of 90. Range is allowed on parts because the route already supports it.
7. **Code rebuilds are budgeted.** At most `CODE_REBUILDS_PER_DAY = 10` code-only dispatches come from the sweep. A
   code bump then reaches 100 languages in about 10 days, a language a phone opens sooner (that dispatch counts
   against the daily cap of 20). A code bump rebuilds every unit: for English, 13 min and 2.2 GB. A dispatch for a
   moved stamp is not budgeted, as in f1.1.
8. **The production cron runs hourly** (`17 * * * *`). Each run checks the parts languages whose
   `fnv1a32(language) % 24` is the UTC hour, so each language is still checked once a day, and Door43 and GitHub
   requests are spread across the day. The f1.1 sweep runs only in the 06 UTC run (it ran at 06:17 before). The
   cleanup runs in the 03 UTC run. This is safer than one daily run doing everything: the subrequest limit of the
   account's Workers plan is unknown, and each parts check makes about 6 to 8 requests.
9. **Cleanup** follows Task 8's rules. Its modes are `PACKS_CLEANUP = off | dry-run | delete`, `off` by default.
   Staging and production start in `dry-run`, and `delete` needs Abel's yes after the logs have been read. A run
   deletes at most 1000 objects.
10. **Staging gets the cron too** (`[env.preview.triggers]`, `47 * * * *`), with `PACKS_SWEEP = "parts"` (no f1.1
    sweep on staging, as today) and `PACKS_CLEANUP = "dry-run"`. It can then dispatch staging parts builds of es-419
    and en without anyone asking. *Alternative:* no staging cron, with the sweep and the cleanup run from
    `wrangler dev --test-scheduled`, which tests less of the real path.
11. **Parts and whole runs of one language get separate workflow concurrency groups**
    (`packs-<target>-parts-<lang>` and `packs-<target>-<lang>`). GitHub keeps only one pending run per group. With one
    group, a whole run queued behind a running build would cancel a pending parts run that the Worker had marked
    `running`, and that mark would later count as a failure. The two kinds write different keys.
12. **f1.1 and f2.0 keep working side by side** until the apps move. Each compat asks for its own builds, and the
    dispatch cap of 20 a day is shared.
13. **A removed resource does not trigger a build**, as in f1.1's `isStale`: the list keeps it until the next build
    for another reason. A new resource does trigger one.

---

### Task 1: the parts compat and the parts dispatch

**Files:**

- Modify: `src/packs/dispatch.ts`, `tests/unit/packs-dispatch.test.ts`

**Interfaces:**

- Produces:
  - `export const CURRENT_PARTS_COMPAT = "f2.0-u2.3.0-p6000230-q9-a12-t1"`, documented like `CURRENT_PACK_COMPAT`
    (must equal `packs-status --print-compat --parts`, and after a bump it is changed here and v2 is redeployed)
  - `export function isPartsCompat(compat: string): boolean` (format major ≥ 2)
  - `export function isBuildableCompat(compat: string): boolean`: `CURRENT_PACK_COMPAT` or `CURRENT_PARTS_COMPAT`
  - `BuildRequest.reason` gains `"code"` (counted against the cap like `stale`)
  - `dispatchWorkflow` adds `parts: "true"` to `inputs` when `compat === CURRENT_PARTS_COMPAT` (workflow_dispatch
    inputs are strings over REST). The f1.1 body is unchanged.

- [ ] **Step 1: Write the failing tests.** The dispatch for `CURRENT_PARTS_COMPAT` posts
      `{ref: "master", inputs: {language, mode: "publish", target, compat: "f2.0-…", parts: "true"}}` and marks
      `status/f2.0-…/<lang>.json` running. The f1.1 dispatch body equals today's exactly (`toEqual` against the
      literal object, with no `parts` key). `isPartsCompat` holds for f2.0 and f10.1 and not for f1.1.
      `isBuildableCompat` holds for exactly the two constants. Reason `code` counts against the daily cap.
- [ ] **Step 2: Run** `npx vitest run tests/unit/packs-dispatch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expected: PASS, and the existing cases unchanged. Then `npm run typecheck`.
- [ ] **Step 5: Commit** `Packs dispatch: a parts compat, built with the workflow's parts input`.

### Task 2: rate limits with their own counters

**Files:**

- Modify: `src/core/rateLimit.ts`, `tests/unit/rate-limit-auth.test.ts`

**Interfaces:**

- `parseRateLimitRpm(raw: string | undefined, fallback = DEFAULT_RPM): number`
- `checkRateLimit(ip, config, scope?: string)`: the window key is `${scope}:${ip}` when there is a scope, else `ip`
  as today
- `enforceRateLimit(request, rpmRaw, cors?, opts?: { scope?: string; fallbackRpm?: number })`. Callers without `opts`
  behave exactly as before.

- [ ] **Step 1: Write the failing tests.** 90 requests in scope `undefined` do not use up scope `parts`. Scope
      `parts` with `fallbackRpm: 600` allows 600 and answers the 601st with 429 and `Retry-After`. `"0"` still turns
      a scope off. An unparsable value falls back to the given default.
- [ ] **Step 2: Run** `npx vitest run tests/unit/rate-limit-auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expected: PASS.
- [ ] **Step 5: Commit** `Rate limit: scopes with their own counters and defaults`.

### Task 3: the parts routes

**Files:**

- Modify: `src/api/routes/packs.ts` (`PacksEnv`: `PARTS_RATE_LIMIT_RPM?`; `parsePath`, `Target`, `CACHE_CONTROL`,
  `CONTENT_TYPE`, `serve`, `respond`, `Outcome`), `src/worker.ts` (`Env`: `PARTS_RATE_LIMIT_RPM?`),
  `tests/unit/packs.test.ts`

**Interfaces:**

- `Target.route`: `"entry" | "pack" | "originals" | "part"`
  - `parts/<sha256>` → `parts/<sha256>.part.gz` (`part`)
  - `<parts compat>/originals/<sha256>` → `catalog/<compat>/originals/<sha256>.json` (`originals`)
  - `<parts compat>/<lang>` → `catalog/<compat>/<lang>.json` (`entry`, as today)
  - `<parts compat>/<lang>/<sha256>` → `null` (400)
  - f1.1 paths parse exactly as today.
- `CACHE_CONTROL.part` and `CACHE_CONTROL.originals` are both `public, max-age=31536000, immutable`.
  `CONTENT_TYPE.part = "application/gzip"` and `CONTENT_TYPE.originals = "application/json"`.
- `serve`: Range is read for `pack` and `part`, with `Accept-Ranges` on both. `Content-Encoding` is deleted after
  `writeHttpMetadata`, so that whatever an upload carried, a part goes out as stored.
- `respond`:
  - The rate limit is scope `parts` with `env.PARTS_RATE_LIMIT_RPM` and fallback 600 for `part`. Every other route
    keeps `RATE_LIMIT_RPM`.
  - A missing `part` or `originals` is `404 missing`, with no build.
  - A missing entry under a compat where `isBuildableCompat` holds goes through eligibility and `requestBuild` as
    today, with that compat (Task 1 adds the parts input).
  - Any other compat is `404 old-compat`.
  - Analytics blobs carry the route name (`part`, `originals`).
- No freshness check for a parts entry yet (Task 5 wires it); the f1.1 check still runs only for f1.1 entries
  (`isPartsCompat` false).

- [ ] **Step 1: Write the failing tests** (the existing `fakeBucket` with a part, a parts list and an originals list):
  - a part: 200 with `application/gzip`, immutable and no `Content-Encoding`, even when the stored object was
    uploaded with `content-encoding: gzip`. It has `Accept-Ranges`, the R2 ETag and the CORS headers. The body
    equals the stored bytes;
  - a part answers its own 304 and a Range of 206 and 416;
  - an unknown part is 404 `no-store` and asks for no build, and `parts/<not hex>` is 400;
  - an originals list under f2.0 is 200, immutable JSON. Under f1.1 the same path is still served from
    `packs/<compat>/originals/<sha>.langpack.zip`;
  - a parts list is 200 `no-cache` with its ETag, a 304 for `If-None-Match`, and a HEAD with headers only;
  - a missing es-419 list under `CURRENT_PARTS_COMPAT` (eligible) is 202 `preparing`, and `requestBuild` is called
    with the f2.0 compat. Under `f2.0-u2.3.0-p6000229-…` the answer is 404 `old-compat` with no build;
  - 600 part requests from one IP pass while list requests from that IP have already been limited at 91, and the
    601st part is 429 with CORS and `no-store`;
  - `f2.0-…/es-419/<sha>` is 400.
- [ ] **Step 2: Run** `npx vitest run tests/unit/packs.test.ts`. Expected: FAIL in the new cases only.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expected: PASS, with every existing case unchanged. Then `npm run typecheck` and
      `npm run lint`.
- [ ] **Step 5: Commit** `Pack routes: parts lists, originals lists and parts, with their own limit`.

### Task 4: what a parts list was built from, now

**Files:**

- Create: `src/packs/partsSources.ts`, `tests/unit/packs-parts-sources.test.ts`
- Modify: `src/packs/freshness.ts` (export `currentStamps`' key rule as `catalogKey(row, language)`, with no change
  in behaviour)

**Interfaces:**

- Produces:
  - `PARTS_SUBJECTS: ReadonlySet<string>`, the spec's subject table, copied with its source named:
    `Bible`, `Aligned Bible`, `Greek New Testament`, `Hebrew Old Testament`, `TSV Translation Notes`,
    `TSV Translation Questions`, `TSV Translation Words Links`, `Translation Words`, `Translation Academy`, plus the
    OBS subjects (which the OBS rule then leaves out)
  - `isObsRow(row: { subject?: string }): boolean`: `/OBS|Open Bible Stories/i`
  - `languageStamps(rows: CatalogEntry[], language: string): Record<string, string>`: the rows of the language whose
    subject is in `PARTS_SUBJECTS`, without OBS, through `currentStamps`
  - `literalOwnerOf(rows, language): string | undefined`: the owner of the `Aligned Bible` whose repository id ends in
    `lt`
  - `lexiconStampOf(commit: { sha: string; date: string }): string`
  - `maculaStampOf(commit: { sha: string; date: string }): string`
  - `type Observed = { stamps: Record<string, string> } | { unknown: string }`
  - `observeParts(o: { language: string; env: FreshnessEnv; ctx: ExecutionContext; now?: Date; search?: Search;
    fetch?: typeof fetch }): Promise<Observed>`. It unions:
    - `languageStamps`;
    - UHB and UGNT (`catalogSearch` with `owner`, `lang`, `subject`, `stage: "prod"`, `limit: 1`);
    - the two lexicons: `{owner}/{lang}_uhl|_ugl`, owner `"test_org"` for `en` (tc-study `LEXICON_OWNERS`), else
      `literalOwnerOf`. A 404 means no lexicon;
    - MACULA, from GitHub: `GET /repos/idiomaspuentes/taller/commits?path=public/trees&per_page=1` and the same for
      `public/referents`, keeping the commit with the newer committer date. It is cached in KV at `packs:macula` for
      an hour, because every language reads the same one. GitHub is called with the App's installation token when
      the App is configured (`installationToken`, `githubHeaders`), else without a token.

    It is `unknown` when the language search has no row of the language or no literal text, or when the originals,
    a lexicon or MACULA cannot be read (any status but 200 and a lexicon's 404). An unknown result asks for no build.

- [ ] **Step 1: Write the failing tests** (fake `search` and `fetch`):
  - es-419 rows (GLT, GST, TN, TQ, TWL, TW, TA, an OBS row, an `es-419_uhl` row and a row of another language) give
    exactly the seven keys `test_gl/es-419/glt`… with their catalog stamps;
  - en's lexicons are asked of `test_org`, es-419's of the GLT's owner;
  - `lexiconStampOf({sha: "0123456789abcdef", date: "2026-10-01T12:00:00Z"})` is `0123456789#2026-10-01T12_00_00Z`;
  - `maculaStampOf` of a GitHub date `2026-10-01T12:00:00Z` is `…#2026-10-01T12_00_00.000Z`, as tc-study's
    `toISOString` writes it;
  - MACULA keeps the newer of the two commits, and a second language within the hour does not call GitHub;
  - a lexicon 404 leaves that key out, and a 500 is `unknown`;
  - an empty search is `unknown`, which is how Door43 failures surface, since `catalogSearch` returns `[]` on a
    network error.
- [ ] **Step 2: Run** `npx vitest run tests/unit/packs-parts-sources.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy tc-study's rules with their source named in comments (`door43Stamps.ts`,
      `companions.ts`, `maculaIdentity.ts`).
- [ ] **Step 4: Run** it, then `tests/unit/packs-freshness.test.ts`. Expected: PASS (f1.1 unchanged).
- [ ] **Step 5: Commit** `Packs: the stamps a parts list is built from, read from Door43 and GitHub`.

### Task 5: the parts freshness check

**Files:**

- Create: `src/packs/partsFreshness.ts`, `tests/unit/packs-parts-freshness.test.ts`
- Modify: `src/api/routes/packs.ts` (`PacksDeps.checkPartsFreshness`, which runs after a parts entry GET or 304)

**Interfaces:**

- Consumes: Task 4's `observeParts`; `requestBuild`, `readBuildStatus`, `okBuildSawDoor43At`,
  `newestDifferingRelease`'s date rule.
- Produces:
  - `type PartsListLite`: copied from tc-study's `PartsList`, only the fields read here (`schema`, `language`,
    `compat`, `code`, `resources[].key|stamp|role`, `originals?: {path, sha256}`, `stamps?`)
  - `type PartsBuilder = { compat: string; code: string; commit: string; at: string }`;
    `readPartsBuilder(bucket): Promise<PartsBuilder | null>` (`status/builder.json`; anything malformed is null)
  - `builtStamps(list, originals: PartsListLite | null): Record<string, string>`: `list.stamps` when present, else
    `list.resources` and `originals.resources`
  - `changedSources(built, current): Array<{ key: string; built?: string; current: string }>`: keys whose stamp
    differs, plus keys only in `current`. Keys only in `built` are ignored (Decision 13)
  - `type PartsCheck = "throttled" | "no-list" | "fresh" | "unknown" | "seen" | "budget" | BuildOutcome`
  - `checkPartsFreshness(o: { env; ctx; compat; language; list: () => Promise<PartsListLite | null>; now?;
    observe?: typeof observeParts; requestBuild?; reason?: "stale" | "daily"; codeBudget?: () => Promise<boolean> }):
    Promise<PartsCheck>`, which never throws:
    1. It does nothing unless `compat === CURRENT_PARTS_COMPAT`, then claims the hour at `packs:fresh:<compat>:<lang>`
       as `checkFreshness` does.
    2. It reads the list. Without `stamps`, it also reads the originals list at `list.originals.path`, but only when
       that path equals `catalog/<compat>/originals/<sha256>.json` for the list's `originals.sha256`.
    3. It observes the sources and reads the builder file.
    4. Changes are `changedSources`, plus `code` when the builder file is there, `builder.compat` equals the compat
       and `builder.code !== list.code`. When `builder.compat` differs, it logs `compat-drift` and writes analytics.
    5. With no change the result is `fresh`. The newest date of a change is the date after `#` of its current stamp,
       and `builder.at` for the code. When an `ok` build started after that newest date, the result is `seen` (log
       and analytics `stale-seen`).
    6. A code-only change on the daily path needs `codeBudget()`, else the result is `budget`. Then it calls
       `requestBuild` with reason `code` (code only, phone path), `daily` (sweep) or `stale`.

    Analytics: `["pack", "freshness", language, "parts-<result>"]`.

- [ ] **Step 1: Write the failing tests:**
  - every stamp equal and the same code → `fresh`, with no build;
  - the GLT tag moved → a build with reason `stale` and compat f2.0;
  - a new TN row → a build. A key only in the list → `fresh`;
  - the lexicon commit moved → a build. MACULA moved → a build;
  - the builder code differs → a build with reason `code`. On the daily path with the budget spent → `budget`;
  - `builder.compat` differs → no code build, with `compat-drift` logged. No builder file → no code check;
  - an `ok` build started after the newest change → `seen`, with no build. One started before → a build. A `failed`
    status → a build (the guard then cools it);
  - an unknown observation → `unknown`, with no build. An old parts compat → nothing, not even the hour claimed;
  - the check runs at most once an hour per language;
  - a list without `stamps` reads its originals list only at the content-addressed path. Any other path → the
    originals list is not read, and only the list's own resources are compared;
  - the route calls `checkPartsFreshness` after a parts entry GET and its 304, and `checkFreshness` only for f1.1.
- [ ] **Step 2: Run** `npx vitest run tests/unit/packs-parts-freshness.test.ts tests/unit/packs.test.ts`.
      Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both, then all of `tests/unit/packs*.test.ts`. Expected: PASS. Then `npm run typecheck`.
- [ ] **Step 5: Commit** `Packs: ask for a parts build when what a list was built from moved`.

### Task 6: a script that compares the Worker's stamps with a published list

**Files:**

- Create: `scripts/packs-parts-stamps.ts`, `tests/unit/packs-parts-stamps-script.test.ts`

**Interfaces:**

- `npx tsx scripts/packs-parts-stamps.ts --base <Worker URL> --lang <code>`. It fetches the parts list under
  `CURRENT_PARTS_COMPAT` (and its originals list when the list has no `stamps`), then runs `observeParts` against real
  Door43 and GitHub, with no KV and a stub context. It prints the result of
  `diffForReport(builtStamps(list, originals), observed)` as JSON: `[]` when every key agrees, else
  `[{key, list: <stamp|null>, now: <stamp|null>}]` (keys only in the list are listed too, though they do not
  dispatch), and it exits 1 when that is not empty or the observation is `unknown`.
- `diffForReport` is exported from the script module for its test; the work is done by Task 4's and Task 5's
  functions.

- [ ] **Step 1: Write the failing test.** `diffForReport` returns `[]` for equal maps, and one entry each for a moved
      stamp, a key only observed and a key only listed.
- [ ] **Step 2: Run** `npx vitest run tests/unit/packs-parts-stamps-script.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expected: PASS. Then `npm run typecheck`, since `scripts/` is in `tsconfig.json`.
- [ ] **Step 5: Commit** `Packs: a script that compares the Worker's stamps with a published parts list`.

### Task 7: the sweep over published parts languages, in hourly slices

**Files:**

- Modify: `src/packs/freshness.ts` (`runDailySweep` becomes `runScheduled`; `publishedLanguages` lists with
  `delimiter: "/"`, so `catalog/<compat>/originals/` is not walked), `src/worker.ts` (`scheduled` passes
  `event.scheduledTime`; `Env`: `PACKS_SWEEP?`, `PACKS_CLEANUP?`), `wrangler.toml` (production cron
  `17 * * * *`; preview cron `47 * * * *` with vars `PACKS_SWEEP = "parts"` and `PACKS_CLEANUP = "dry-run"`;
  production var `PACKS_CLEANUP = "dry-run"`), `tests/unit/packs-freshness.test.ts`

**Interfaces:**

- `runScheduled(env, ctx, deps: { now?; checkFreshness?; checkPartsFreshness?; cleanup?; … })`:
  - The f1.1 sweep runs exactly as `runDailySweep` does today, when the UTC hour is 6 and `PACKS_SWEEP` is not
    `"parts"`.
  - The parts sweep checks every language under `catalog/<CURRENT_PARTS_COMPAT>/` with
    `fnv1a32(language) % 24 === hour` (a local copy of tc-study's `fnv1a32`), reason `daily`, and a `codeBudget` that
    counts `packs:code-rebuilds:<date>` in KV against `CODE_REBUILDS_PER_DAY = 10`.
  - The cleanup (Task 8) runs when the hour is 3 and `PACKS_CLEANUP` is not `"off"`.
  - Each part is wrapped so a failure stops only itself.
- `runDailySweep` stays exported as the f1.1 sweep, so its tests keep working.

- [ ] **Step 1: Write the failing tests:**
  - at hour 6, the f1.1 sweep runs as before (same calls as today's test) and the parts sweep checks only its slice;
  - at hour 7, there is no f1.1 sweep;
  - over 24 hours every parts language is checked exactly once;
  - `catalog/f2.0-…/originals/<sha>.json` and `originals.json` are not languages;
  - the eleventh code rebuild of a day is `budget`;
  - `PACKS_SWEEP = "parts"` never runs the f1.1 sweep;
  - one failing check does not stop the next.
- [ ] **Step 2: Run** `npx vitest run tests/unit/packs-freshness.test.ts`. Expected: FAIL in the new cases.
- [ ] **Step 3: Implement.** In `wrangler.toml`, keep the production comment's meaning: a check, not a build.
- [ ] **Step 4: Run** all `tests/unit/packs*.test.ts`. Expected: PASS. Then `npm run typecheck`.
- [ ] **Step 5: Commit** `Packs: an hourly cron, each parts language checked once a day`.

### Task 8: cleanup of parts no list names

**Files:**

- Create: `src/packs/cleanup.ts`, `tests/unit/packs-cleanup.test.ts`

**Interfaces:**

- `ORPHAN_DAYS = 30`, `MAX_DELETES = 1000`, `LEDGER = "cleanup/parts-orphans.json"` (`{ schema: 1, since: { [key]:
  iso } }`)
- `runPartsCleanup(env, o: { now?: Date; mode: "dry-run" | "delete" }): Promise<CleanupSummary>` where
  `CleanupSummary = { state: "done" | "postponed" | "aborted"; why?: string; named: number; orphans: number;
  due: number; deleted: number; bytes: number }`. In order:
  1. The parts compats are the `catalog/` prefixes (`delimiter: "/"`) where `isPartsCompat` holds.
  2. If any `status/<parts compat>/<lang>.json` says `running` and is younger than `RUNNING_STALE_MS`, the cleanup is
     postponed.
  3. Named: for each parts compat, every `<lang>.json` and `originals.json`, the parts each of them lists, and the
     originals list each language list names. A content-addressed originals list is kept when a language list names
     it or when its sha equals that of `originals.json`'s text. Any list that cannot be read or parsed aborts the run,
     because deleting from a partial view is not allowed.
  4. Candidates are `parts/*.part.gz` and `catalog/<parts compat>/originals/*.json` that are not named. The ledger
     adds new candidates with `since = now` and drops keys that are named again. A candidate is due when `since` is at
     least 30 days ago and R2's `uploaded` is too.
  5. In `delete` mode, before deleting, it checks again that no build is running and that every language list's etag
     is unchanged, and it aborts otherwise. It deletes at most `MAX_DELETES` due keys in one `bucket.delete(keys)` and
     then writes the ledger. In `dry-run` mode it logs what it would delete (count and MB) and writes the ledger, so
     the 30 days start counting in dry-run too.
  6. It logs `[packs] cleanup: …` and writes analytics `["pack", "cleanup", mode, state]`.

- [ ] **Step 1: Write the failing tests** (a fake bucket with `list` that supports cursor, delimiter and `uploaded`,
      plus `get`, `head` and `delete(keys[])`):
  - a part named by es-419's list is never a candidate. A part named only by a list in another parts compat is
    named;
  - a part uploaded 90 days ago and unnamed since yesterday is not due, and is due 30 days after it was first seen;
  - a part named again leaves the ledger;
  - the first run marks everything and deletes nothing;
  - an unreadable list → `aborted`, nothing deleted, ledger unchanged;
  - a fresh `running` status → `postponed`. A `running` status 6 h old → the cleanup runs;
  - a list rewritten between the read and the delete → `aborted`;
  - `dry-run` deletes nothing and writes the ledger;
  - 1500 due keys → 1000 deleted, 500 left for the next run;
  - an originals list named by no language list and not the latest → a candidate. The one es-419 names → kept;
  - `packs/`, `v1/`, `status/` and `catalog/f1.1-…/` objects are never listed as candidates.
- [ ] **Step 2: Run** `npx vitest run tests/unit/packs-cleanup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and call it from `runScheduled` (Task 7).
- [ ] **Step 4: Run** all `tests/unit/packs*.test.ts`. Expected: PASS. Then `npm run typecheck` and `npm run lint`.
- [ ] **Step 5: Commit** `Packs: delete parts no list has named for 30 days`.

### Task 9: the client contract, the operations and the spec

**Files:**

- Modify: `docs/LANGUAGE_PACKS_INFRA.md` ("Client contract", "Operations", step 9), and
  `docs/superpowers/specs/2026-10-21-language-packs-parts-design.md` (§2 step 5 and "For the Worker", §3 "Cleanup",
  §6 item 3, the open point on `bookBlobsRef`)

- [ ] **Step 1: The client contract for parts.**
  - The list is `/v2/packs/<f2.0…>/<lang>`, with 200 `no-cache` and an ETag, 304, `202 preparing`, `404 old-compat`,
    and the other 503 and 404 answers as for f1.1.
  - The originals list is `/v2/packs/<compat>/originals/<list.originals.sha256>`.
  - A part is `/v2/packs/parts/<sha256>`: immutable, `application/gzip` and not decoded by the browser, so the app
    gunzips it after checking the sha256 of the bytes. Range is allowed, and the limit is 600 a minute per IP.
  - After importing the parts, the app sets `availability.offline` (the restored row has it `false`:
    `restoreCatalogBookkeeping`).
- [ ] **Step 2: Operations.**
  - The `CURRENT_PARTS_COMPAT` bump: as for f1.1, with the workflow's Check compat now covering parts (Task 11).
  - `status/builder.json`, and what `compat-drift` means.
  - The cron's hours (f1.1 at 06, the parts slices every hour, the cleanup at 03).
  - `PACKS_CLEANUP` (off, dry-run, delete) and how to read its log.
  - Kill switches: the existing ones also stop parts dispatches, and `PACKS_CLEANUP = off` stops deletes.
- [ ] **Step 3: The spec.**
  - §2 step 5: the build decides. The Worker compares stamps and code, and a tags-only change goes through a build,
    which carries every unit. Remove "the list is rewritten with the new release tags only".
  - "For the Worker": replace the trees, manifests and unit fingerprints with this plan's stamps. Keep the golden
    vectors, which remain the build's contract and the app's, if it ever computes fingerprints.
  - §3 Cleanup: 30 days from the first sweep that finds a part unnamed, with the ledger.
  - §3 Lists: `stamps` (Task 10).
  - Close the open point.
- [ ] **Step 4: Commit** `Docs: the parts client contract, the Worker's operations and its rules in the spec`.

### Task 10 (tc-study): the list records the stamps of every input

**Files:**

- Modify: `packages/language-pack/src/parts/partsList.ts` (`PartsList.stamps?: Record<string, string>`, documented
  as "language list only: the stamp of every resource the build read, the originals, lexicons and MACULA included"),
  `packages/resource-pipeline/src/language/buildLanguageParts.ts` (the language list gets
  `stamps = Object.fromEntries([...resourceFiles].map(([k, r]) => [k, r.stamp]))`, taken after the resources left out
  are removed), `buildLanguageParts.test.ts`, `buildLanguageParts.reuse.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the fixture's language list has `stamps` with every candidate, both originals, `uhl` and the MACULA keys that
    have files, and with MACULA in the `sha10#….000Z` form;
  - the originals list has no `stamps`;
  - a carried build's list equals the full build's (the reuse suite's identical-lists cases cover it);
  - a resource that writes no part is still in `stamps`.
- [ ] **Step 2: Run** `bun test src/language` in packages/resource-pipeline. Expected: FAIL.
- [ ] **Step 3: Implement**, then `bash scripts/build-pack-tools.sh`.
- [ ] **Step 4: Run** `bun test` in language-pack and resource-pipeline. Expected: PASS. `sampleOutput.test.ts` should
      need no refresh, because no part bytes, slots or code move. If it asks for one, find out why before
      refreshing. Every published list changes once: the next publish of a language is `published` with 0 parts put.
- [ ] **Step 5: Commit** `Parts list: the stamps of everything the build read`.

### Task 11 (tc-study): the builder's code, the parts compat check and separate concurrency

**Files:**

- Modify: `packages/resource-pipeline/src/language/packsStatus.ts` (`builderPath = "status/builder.json"`;
  `writeBuilder({ bucket, compat, code, commit, now })`), `packsStatus.test.ts`,
  `packages/resource-pipeline/cli/packs-status.ts` (`--print-code`, which prints `await partsCode()` and needs no
  bucket; `--builder --commit <sha>`, which writes the builder file with the parts compat),
  `.github/workflows/language-packs.yml`
- Create: `.github/workflows/packs-builder.yml`

**Interfaces:**

- `status/builder.json` = `{ compat, code, commit, at }`, `application/json`, `no-cache`.
- `language-packs.yml`:
  - "Check compat" also runs for parts (`if: inputs.compat != ''`), comparing with `--print-compat --parts` when
    `PARTS`. On a mismatch in publish mode it marks `status/<requested>/<lang>` failed (with `--parts`), as for whole
    runs.
  - "Status running" also writes the builder file on a parts publish (`--builder --commit "$GITHUB_SHA"`).
  - `concurrency.group` becomes `packs-${{ inputs.target || 'staging' }}${{ inputs.parts && '-parts' || '' }}-${{
    inputs.language }}`, so whole runs keep today's group name (Decision 11).
- `packs-builder.yml`:
  - Triggers: `push` to `master` with `paths: [packages/**, bun.lock, scripts/build-pack-tools.sh]`, and
    `workflow_dispatch`.
  - A job per Environment: `packs-staging` always, and `packs-production` only when
    `vars.PACKS_PARTS_PRODUCTION == 'true'` (set in Task 14).
  - Steps: checkout, Bun 1.3.3, `bash scripts/build-pack-tools.sh`, then
    `bun packages/resource-pipeline/cli/packs-status.ts --builder --commit "$GITHUB_SHA"`.
  - `concurrency: packs-builder-<env>`, so the latest run wins.

- [ ] **Step 1: Write the failing tests.** `writeBuilder` writes the shape with `no-cache`. `--print-code` prints the
      code that `partsCode()` gives (today `f2.0-u2.3.0-p6000230-q9-a12-t1+7bc31e739fbeed69`). `--builder` without
      `--commit`, or with R2 half set, exits 2.
- [ ] **Step 2: Run** `bun test src/language/packsStatus.test.ts cli/publish-language.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `actionlint` on both workflows. Expected: clean.
- [ ] **Step 4: Read the whole path again.**
  - A dispatch without `parts` has the same steps, arguments and concurrency group as today.
  - A Worker dispatch with `parts: "true"` and `compat: <f2.0>` passes Check compat, builds `--parts`, writes the
    f2.0 status and the builder file, and uploads the artifact.
  - A parts dispatch with an old f2 compat marks that compat failed and builds nothing.
- [ ] **Step 5: Commit** `Packs: the builder's code in the bucket, the compat check for parts, parts in their own queue`.

### Task 12: staging, with Abel's yes at each step

Needs Tasks 1–9 merged into `v2` and Tasks 10–11 merged into tc-study `master`. A parts staging publish is allowed
from `master` only. The App's secrets must be on the preview Worker (INFRA step 5). Record every run in a ledger
(`.superpowers/sdd/3-ledger.md` in tc-study, as for 2b-2).

- [ ] **Step 1: The builder file.** The merge into `master` runs `packs-builder.yml` for staging. Check:
      `npx wrangler r2 object get language-packs-staging/status/builder.json --remote` shows the code that
      `--print-code` prints.
- [ ] **Step 2: es-419 again** (`language-packs.yml`: `language: es-419`, `mode: publish`, `target: staging`,
      `parts: true`). Expected: `published`, 67 carried, 0 built, 0 parts put (only the list changes: `stamps`).
      Then dispatch the same again. Expected: `unchanged`.
- [ ] **Step 3: Deploy the preview Worker** (INFRA step 6: build the web with `BASE_PATH=/v2`, then
      `npx wrangler deploy --config wrangler.toml --env preview`).
- [ ] **Step 4: The stamps agree:** `npx tsx scripts/packs-parts-stamps.ts --base <preview URL> --lang es-419`
      prints `[]`. If it prints anything, stop: fix the derivation before any check can dispatch.
- [ ] **Step 5: HTTP checks** against the preview URL:
  - the list: 200 `no-cache` with an ETag, a 304 with `Access-Control-*`, and a HEAD;
  - the originals list: immutable JSON;
  - one book part and the largest originals part: `curl -s <url> | sha256sum` equals the name, with
    `Content-Type: application/gzip`, no `Content-Encoding`, immutable, and `Content-Length` equal to the list's
    `bytes`;
  - a Range of 206, and a Range starting past the end that answers 416;
  - an unknown sha that answers 404;
  - `wrangler tail --env preview` while GETting the list shows `parts-fresh` for es-419.
- [ ] **Step 6: English through the Worker's own 202.** This is 2b-2 Task 11 Step 6, with the bucket counts kept at
      TW 8 and TA 4 as recommended. `GET /v2/packs/<f2.0>/en` answers 202, the tail shows `dispatched`, and the run
      has inputs `parts: true` and `compat: <f2.0>`. Expected: `published`, about 727 parts, about 13 min, a peak of
      about 2.2 GB, and status `ok`. Then GET the list: 200. Dispatch the same by hand. Expected: `unchanged`
      (record its time: the cost of a tags-only build for English).
- [ ] **Step 7: The cron on staging.** Find the hour slice of es-419 and en (`fnv1a32 % 24`). After those hours the
      tail shows `parts-fresh` for each. After 03 UTC the cleanup logs `dry-run`, with 0 due and the ledger written.
- [ ] **Step 8: GitHub access.** The logs show the MACULA lookup answering 200 with the installation token. If GitHub
      refuses it, stop and ask Abel: either a read-only token secret or anonymous access with the hour's KV cache.

### Task 13 (tc-study): parts may be published to production

**Files:**

- Modify: `.github/workflows/language-packs.yml`: remove the Validate refusal
  (`parts publish to production waits for the Worker (delivery 3)`), change the `parts` description to
  `Build as parts, one book at a time`, and update the header comment ("staging only, until the Worker serves them").

- [ ] **Step 1:** Make the change and run `actionlint`. Expected: clean.
- [ ] **Step 2:** Read the path for `parts: true` with `target: production`: Environment `packs-production`, Check
      compat for parts, `status/f2.0-…` in the production bucket, and the builder file.
- [ ] **Step 3: Commit** `Packs workflow: parts may be published to production, now that the Worker serves them`,
      and open a PR. It merges only after Task 12 and with Abel's yes.

### Task 14: production, with Abel's yes at each step

- [ ] **Step 1:** Merge Task 13. Set the repository variable `PACKS_PARTS_PRODUCTION = true`, then run
      `packs-builder.yml` by hand. Expected: `language-packs/status/builder.json` is there.
- [ ] **Step 2:** Deploy the production MCP Worker from `v2` (INFRA step 6, `--env production`). Expected: the f1.1
      checks of INFRA step 9 are unchanged.
- [ ] **Step 3:** Dispatch es-419 with `parts: true`, `mode: publish` and `target: production`. Expected:
      `published`. Then en, through its 202 or by hand.
- [ ] **Step 4:** Through the real host (`https://tc-helps.mcp.servant.bible/v2/packs/…`), repeat Task 12 Step 5. For
      each list, originals list and part, ask twice: status, ETag and `Access-Control-*` are identical the second time,
      and the part is a Pages cache hit. Then run `scripts/packs-parts-stamps.ts` against the real host.
- [ ] **Step 5:** After at least a week of `dry-run` logs on production (counts and MB that match what lists dropped),
      switch `PACKS_CLEANUP` to `delete` with Abel's yes and redeploy.
- [ ] **Step 6:** Update INFRA step 9: the production backfill is of parts. Languages arrive through their first
      requests (the cap of 20 a day) or by hand.

## Open risks

- **Stamp derivations can still disagree on real data**: the tag against `version`, the MACULA date, the lexicon
  `created` date, or the originals search, since the Worker's `catalogSearch` always adds `topic=tc-ready` while
  tc-study's original-language search may not. Task 12 Step 4 is the gate. After it, the breaker limits a
  disagreement to one build per change.
- **GitHub from the Worker.** It is not verified that the installation token can read a public repository it is not
  installed on. Anonymous access shares Cloudflare's egress IPs and the limit of 60 requests an hour.
- **Subrequest limits** of the account's Workers plan are unknown. The hourly slices keep a run to about 1/24 of the
  languages, but the f1.1 sweep stays one daily loop, as today.
- **Release storms.** A UHB or UGNT release, or a MACULA commit, means one build per published parts language.
  Each build carries most units but downloads every zip again (es-419 15 MB, en 42 MB). A code bump rebuilds
  everything, throttled to 10 a day, and a dependency bump in `bun.lock` is a code bump.
- **The cleanup race.** A build may find an old orphan present (`has`) and skip its upload while the cleanup deletes
  it. The window is closed by postponing while any build is running and by checking again before deleting, but only
  that far: tc-study does not check again with HEAD right before writing the list.
- **A permanently broken resource** (no release zip, an ingredients mismatch) fails every build of its language.
  After three failures the language is `stopped`, and all its updates wait for a person (the existing guard).
- **A resource the build leaves out without failing** (the known discovery skip) appears new on every check, and
  after one build the breaker holds it at `seen`.
- **Pages and workers.dev.** Parts are cached only behind the Pages proxy. Direct workers.dev requests always reach
  the Worker and count against the limit of 600.
- **KV is eventually consistent**, so throttles, counters and the MACULA cache are soft by a few requests.
