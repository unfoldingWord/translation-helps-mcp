# Language packs: immediate fixes (delivery 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make what plan 2 already builds and serves follow the rules decided on 2026-10-21, before anything is
deployed: only `tc-ready` resources (plus MACULA, lexicons and OBS's own helps), English lexicons from `test_org`, no
daily builds, and no rebuild for an unrelated tc-study commit.

**Architecture:** Three small changes in tc-study's `packages/resource-pipeline` and `packages/language-pack`
(discovery, lexicons, build id), added to PR unfoldingWord/tc-study#42 (`feat/packs-workflow`), and one in the MCP v2
Worker (`src/packs/freshness.ts`), on a new branch from `v2`. The pack format does not change (still `f1.1`); parts
come in delivery 2.

**Tech Stack:** TypeScript; Bun tests in tc-study (`bun test`), Vitest in the MCP (`npx vitest run`).

**Spec:** `docs/superpowers/specs/2026-10-21-language-packs-parts-design.md` (translation-helps-mcp, branch
`docs/language-packs-parts`), section "Decisions taken" and §6 item 1.

## Global Constraints

- Packs take only resources with the Door43 topic `tc-ready` (stage `prod`), except MACULA, the Greek and Hebrew
  lexicons, and OBS's own helps. TW and TA always need `tc-ready`, also when OBS asks for them.
- `readCatalogSearch.ts` mirrors tc-study's Read page and is not changed: the pack rule is applied in
  `discoverLanguage.ts`.
- English lexicons come from `test_org` (`test_org/en_ugl`, `test_org/en_uhl`); every other language keeps its
  literal text's owner.
- Lexicon entries are stored unchanged at `{owner}/{language}/{uhl|ugl}/content/{number}.json` (Servos reads that
  path and already shows a plain `brief`/`long` file).
- No unconditional daily builds; es-419 and en are checked like every other language.
- The build id stops depending on the tc-study commit; the catalog entry still records it in `build.generator`.
- Code comments and commits in English; log lines the CLI prints stay in Spanish, as they are.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- An OBS helps search that returns a TW or TA repository (any owner, no topic): it must not reach the catalog. Pinned
  in Task 1.
- A tC-layout lexicon tarball that also carries other JSON (`OldLexicon/`, `package.json`, `.babelrc`): only
  `…/v0/content/*.json` and `…/v0/domains/*.json` become rows. Pinned in Task 2.
- English stamps and the English build must name the same lexicon owner, or every run would differ from the stored
  build. Pinned in Task 2 (door43Stamps test).
- A stored entry built with the old id (generator inside) meets the new id: it rebuilds once, then stays unchanged.
  Pinned in Task 3.
- es-419 or en with no published entry: the sweep never builds them; the first request does (`missing`). Pinned in
  Task 4.

---

### Task 1: OBS helps searches bring only OBS's own helps

**Files:**

- Modify: `packages/resource-pipeline/src/discover/discoverLanguage.ts:58-70`
- Test: `packages/resource-pipeline/src/discover/discoverLanguage.test.ts`

**Interfaces:**

- Produces: `obsOwnHelpsSubjects(subjects: readonly string[]): string[]`, exported from `discoverLanguage.ts`: the
  subjects whose name contains the word `OBS`.

- [ ] **Step 1: Write the failing tests** in `discoverLanguage.test.ts`:
  - `test('obsOwnHelpsSubjects keeps only OBS subjects')`:
    `expect(obsOwnHelpsSubjects(['TSV OBS Translation Notes', 'OBS Translation Notes', 'Translation Words', 'Translation Academy', 'TSV OBS Study Questions'])).toEqual(['TSV OBS Translation Notes', 'OBS Translation Notes', 'TSV OBS Study Questions'])`
  - `test('a TW or TA without tc-ready never comes in through the OBS helps searches')`: the fake Door43 answers a
    search with `subject: 'Translation Words'` and no topic with a hit for `es-419_obt/es-419_tw` (no topics). Assert:
    no recorded call has `subject` `'Translation Words'` or `'Translation Academy'` without `topic`, and
    `found.resources.map((r) => r.resourceKey)` does not contain `'es-419_obt/es-419/tw'`.
  - Keep the existing assertion that every untopiced subject call has no topic; add
    `expect(obsSubjects.every((s) => /\bOBS\b/.test(s))).toBe(true)`.

- [ ] **Step 2: Run them and see them fail**
      Run (in `packages/resource-pipeline`): `bun test src/discover/discoverLanguage.test.ts`
      Expected: FAIL (`obsOwnHelpsSubjects` is not exported; a `Translation Words` call without topic is recorded).

- [ ] **Step 3: Implement** `obsOwnHelpsSubjects` and pass
      `obsOwnHelpsSubjects(resourceTypeRegistry.subjectsForHelpsCatalogLoad('obs'))` as `helpsSubjects` at line 68.
      Update the file's top comment: the OBS helps searches bring only OBS's own helps; TW and TA come only from the
      `tc-ready` search.

- [ ] **Step 4: Run** `bun test src/discover` — Expected: PASS.

- [ ] **Step 5: Commit** (tc-study, branch `feat/packs-workflow`)
      `git commit -m "Discovery: OBS helps searches bring only OBS's own helps"` with a body saying why: the untopiced
      OBS search also asked for Translation Words, which put `es-419_obt/es-419_tw` and `WycliffeAssociates/en_tw` (no
      `tc-ready`) into packs.

### Task 2: English lexicons from test_org, in translationCore's layout

**Files:**

- Modify: `packages/resource-pipeline/cli/companions.ts` (`addLexicons` file loop, near line 145)
- Modify: `packages/resource-pipeline/src/language/door43Stamps.ts:48-50`
- Modify: `packages/resource-pipeline/src/language/prepareAndPack.ts:107-111`
- Test: `packages/resource-pipeline/cli/companions.test.ts`, `packages/resource-pipeline/src/language/door43Stamps.test.ts`

**Interfaces:**

- Produces, from `cli/companions.ts`:
  - `LEXICON_OWNERS: Readonly<Record<string, string>>` = `{ en: 'test_org' }`
  - `lexiconOwnerOf(language: string, literalOwner: string): string` — `LEXICON_OWNERS[language] ?? literalOwner`
  - `lexiconRowPath(inside: string): string | null` — a path inside the repository (without the archive's top
    folder) to the row path under the lexicon key, or `null` when the file is not an entry.

- [ ] **Step 1: Write the failing tests**
  - `companions.test.ts`, `test('lexiconRowPath reads the root layout and translationCore\'s')`:
    - `lexiconRowPath('content/1.json')` → `'content/1.json'`
    - `lexiconRowPath('domains/12.json')` → `'domains/12.json'`
    - `lexiconRowPath('ugl/v0/content/1.json')` → `'content/1.json'`
    - `lexiconRowPath('resources/en/lexicons/uhl/v0/content/8674.json')` → `'content/8674.json'`
    - `lexiconRowPath('OldLexicon/lexicon.xml')`, `lexiconRowPath('package.json')`, `lexiconRowPath('README.md')`,
      `lexiconRowPath('ugl/v0/content/notes/x.json')` → `null`
  - `companions.test.ts`, `test('English lexicons come from test_org, other languages from their literal text')`:
    `lexiconOwnerOf('en', 'unfoldingWord')` → `'test_org'`; `lexiconOwnerOf('es-419', 'es-419_gl')` → `'es-419_gl'`.
  - `companions.test.ts`, `test('addLexicons stores translationCore entries where Servos reads them')`: a fake fetch
    serves `test_org/en_ugl` (repo info, one commit, a tarball with `en_ugl/ugl/v0/content/1.json` =
    `{"brief":"the first letter of the Greek alphabet","long":"alpha; …"}` and `en_ugl/package.json`). Assert the
    cache holds `test_org/en/ugl/content/1.json` with that object unchanged, no row for `package.json`, and the result
    is `{ key: 'test_org/en/ugl', entries: 1 }`.
  - `door43Stamps.test.ts`, in `describe('the lexicons in the stamps')`:
    `test("English stamps name test_org's lexicons, as the build reads them")`: rows with an `en` literal text owned
    by `unfoldingWord`; assert the fetched URLs are for `test_org/en_uhl` and `test_org/en_ugl` and the stamp keys are
    `test_org/en/uhl` and `test_org/en/ugl`.

- [ ] **Step 2: Run them and see them fail**
      Run: `bun test cli/companions.test.ts src/language/door43Stamps.test.ts` — Expected: FAIL (missing exports; stamps
      ask `unfoldingWord/en_*`).

- [ ] **Step 3: Implement**
  - `lexiconRowPath`: accept `^(content|domains)/[^/]+\.json$` as is; otherwise match
    `(?:^|/)v0/(content|domains)/([^/]+\.json)$` and return its two groups joined by `/`; else `null`.
  - `addLexicons`: use `lexiconRowPath(inside)` instead of the inline regex; count `content/` rows as entries.
  - `door43Stamps.ts:50` and `prepareAndPack.ts:110-111`: pass `lexiconOwnerOf(language, literal.owner)` as the owner
    (the log line names that owner).
  - Update the doc comments of `addLexicons` and `lexiconStamps`: the owner is `lexiconOwnerOf`'s, and both layouts
    are read.

- [ ] **Step 4: Run** `bun test cli src/language` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Lexicons: English from test_org, in translationCore's layout"` with a body:
      translationCore reads English lexicons from `test_org`; their entries sit under `…/v0/content/`, which the root-only
      pattern skipped; Servos already shows a plain `brief`/`long` file.

### Task 3: the tc-study commit leaves the build id

**Files:**

- Modify: `packages/language-pack/src/catalog.ts:73` (`buildIdOf`)
- Modify: `packages/resource-pipeline/src/language/publishLanguage.ts:1-10` (top comment), `:182-185`
- Test: `packages/language-pack/src/catalog.test.ts`, `packages/resource-pipeline/src/language/publishLanguage.test.ts`

**Interfaces:**

- Produces: `buildIdOf(build: Omit<PackBuild, 'id' | 'generator'>): Promise<string>`. `PackBuild` keeps `generator`
  (recorded, not identifying).

- [ ] **Step 1: Write the failing tests**
  - `catalog.test.ts`, `test('the generator is recorded but does not make the build id')`:
    `buildIdOf({ macula: 'm', lexicons: 'master', stamps: { a: 'v1#d' } })` equals itself and is 16 hex characters;
    a call with a `generator` property added (cast) gives the same id — i.e. the function ignores it.
  - `publishLanguage.test.ts`: rename `'a new generator publishes: …'` to
    `'a new Door43 stamp publishes: pack, then views, then originals.json, then the language entry last'` and make its
    change a stamp, not the generator.
  - `publishLanguage.test.ts`, new:
    `test('a new tc-study commit alone is unchanged: nothing is built and nothing is put')`: stored entry built with
    `generator: 'aaa'`, run with `generator: 'bbb'` and the same stamps, macula and lexicons; expect outcome
    `'unchanged'`, no build call, no put.
  - `publishLanguage.test.ts`, new:
    `test('an entry stored with the old id (generator inside) is rebuilt once')`: a stored entry whose `build.id`
    differs from the new id → outcome `'published'` and the new entry's `build.generator` is the run's.

- [ ] **Step 2: Run them and see them fail**
      Run (in `packages/language-pack`): `bun test src/catalog.test.ts`; (in `packages/resource-pipeline`):
      `bun test src/language/publishLanguage.test.ts` — Expected: FAIL on the generator test.

- [ ] **Step 3: Implement**
  - `buildIdOf`: hash only `macula`, `lexicons` and `stamps` (drop any `generator` before `stableJson`).
  - `publishLanguage.ts:182-185`: `languageBuild = { id: await buildIdOf({ macula, lexicons, stamps }), generator, … }`;
    the same for `originalsBuild`.
  - Top comment (lines 1-10): the build id comes from Door43's stamps, MACULA's commit and the lexicons' ref; the
    generator's commit is recorded, and a builder change that alters output bumps the compat key instead (the
    sample-output check enforces it).
  - `changesSince` keeps listing a generator change for the log.

- [ ] **Step 4: Run** `bun test` in `packages/language-pack`, and `bun test src/language src/helps` in
      `packages/resource-pipeline` — Expected: PASS (the sample-output check is unaffected).

- [ ] **Step 5: Commit** `git commit -m "Build id: the tc-study commit is recorded, not compared"` with a body:
      tc-study gets commits on master most days, unrelated to packs; with the commit in the id every language would
      rebuild after each one. Output changes bump the compat key, which the sample-output check enforces.

- [ ] **Step 6: Push** `feat/packs-workflow` and add to PR unfoldingWord/tc-study#42's body a line per task.

### Task 4: the Worker's daily run only checks releases

**Files:**

- Modify: `src/packs/freshness.ts:50` (`DAILY_LANGUAGES`), `:209-250` (`runDailyBuilds`)
- Modify: `src/worker.ts:26,149`
- Modify: `wrangler.toml:65` (comment), `docs/LANGUAGE_PACKS_INFRA.md` (cron line, and "Operations" if it mentions
  daily builds)
- Test: `tests/unit/packs-freshness.test.ts:491-600`

**Interfaces:**

- Produces: `runDailySweep(env: FreshnessEnv, ctx: ExecutionContext, deps?: { requestBuild?: typeof requestBuild;
checkFreshness?: typeof checkFreshness; now?: Date }): Promise<void>` replacing `runDailyBuilds`;
  `DAILY_LANGUAGES` is removed.

- [ ] **Step 1: Rewrite the tests** in `describe("runDailySweep (the cron)")`:
  - delete `"asks for a daily build of es-419 and en under the current compat"`;
  - `"checks every published language in the bucket, es-419 and en like any other, page after page"`: a bucket listing
    `es-419`, `en` and `pt-br` over two pages → `checks` equals `['es-419', 'en', 'pt-br']`, each with
    `compat === CURRENT_PACK_COMPAT`, and `requestBuild` is never called directly;
  - `"asks for no build when Door43's stamps match the entry"`: real `checkFreshness`, stamps equal → no build;
  - `"a language with no published entry is not built by the sweep"`: an empty bucket → no check, no build;
  - keep `"goes through the real check, so the hourly throttle and the build guard apply"`, adjusted to the sweep.

- [ ] **Step 2: Run** `npx vitest run tests/unit/packs-freshness.test.ts` — Expected: FAIL (`runDailySweep` not
      exported).

- [ ] **Step 3: Implement** `runDailySweep`: the body of `runDailyBuilds` without the `DAILY_LANGUAGES` loop and
      without the `includes` skip; the `reason: "daily"` passed to `checkFreshness` stays (so its builds bypass the cap).
      Rename the import and call in `worker.ts`; the `wrangler.toml` comment becomes "A daily freshness check of every
      language in the bucket"; `LANGUAGE_PACKS_INFRA.md` says the cron checks releases and builds nothing by itself.

- [ ] **Step 4: Run** `npm run test:ci`, `npm run typecheck` and `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** on a new branch `fix/packs-no-daily-builds` from `unfoldingword/v2`:
      `git commit -m "Packs: the daily cron checks releases, it builds nothing by itself"` with a body: es-419 and en were
      built every day although their releases are monthly at most; each now builds when Door43 has a newer release, like
      every other language.

- [ ] **Step 6: Push and open a PR into `v2`.** Body: what changed, that nothing is deployed, and a link to the spec.
