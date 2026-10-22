# Language packs 2b-1: the book-by-book build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a language as content-addressed parts, one book at a time in a fresh database, so memory follows the
largest book instead of the language, and write the parts and their list (schema 2) to disk — the same rows as
today's whole build.

**Architecture:** The build keeps one small catalog database for the whole run. Everything else happens in cache
databases that live for one unit of work and are deleted after it: one for the shared resources (TW, TA, OBS,
lexicons, MACULA), then one per book (that book of every book-scoped resource, plus the originals' same book).
Deleting the database is the only thing that frees memory in fake-indexeddb 6.0.0, which keeps every finished
transaction and every overwritten or deleted record. Zipballs are downloaded once per resource to disk and read book
by book. Each unit's rows are split into parts by a pure slotting function and written as deterministic gzip JSONL,
named by their sha256. The pack list (schema 2) names every part. Publishing parts to R2 and reusing unchanged parts
are plan 2b-2; the MCP views are 2c.

**Tech Stack:** TypeScript, Bun (`bun test`), fake-indexeddb, JSZip (reading zipballs only), Node `zlib` gzip.

**Spec:** `docs/superpowers/specs/2026-10-21-language-packs-parts-design.md` (translation-helps-mcp), §1 Parts,
§3 Format and storage, §4 The build, one part at a time, §6 delivery 2b and the 2026-10-22 decisions.

All code is in tc-study, on a branch from `feat/packs-per-book-keys` (plan 2a, PR unfoldingWord/tc-study#45), named
`feat/packs-book-by-book`.

## Global Constraints

- A part is the unit that is built, stored, downloaded and replaced whole. Its file is
  `parts/<sha256>.part.gz`: gzip (no file name, mtime 0) of JSONL rows `{"layer","key","value"}`, sorted by layer
  (`sot, prepared, quote, align, text`) then key. Same rows → same bytes → same sha256.
- No volatile field in a part: `timestamp`, `expiresAt`, `processingDate`, `downloadCompletedAt`, `cachedAt`,
  `catalogedAt` are removed from row values (at any depth of the value object) before writing; the importing app sets
  `timestamp`/`expiresAt` (`restartLifetime`, pack.ts).
- Receipts (`resource:{key}`) are not in parts: the list carries each resource's catalog row and release stamp, and
  a resource is complete when every part the person chose is there.
- Slots (§1 of the spec): book-scoped resource × book → one `book` part (sot + prepared + quote of that book) and,
  for TN/TWL, one `alignments` part (align rows of that book); originals (UGNT/UHB) × book and MACULA × book are
  their own parts; TW: folder (`kt`, `names`, `other`) × bucket `fnv1a32(articleFile) % 8`; TA: manual (`translate`,
  `checking`, `process`, `intro`), with `translate` × bucket `fnv1a32(articleId) % 4`; TA titles and TW titles: one
  `titles` part each; lexicons: Strong range `floor(n / 1000)`; OBS: stories in tens (1–10, 11–20, …, 41–50).
- New format version `2.0.0`: the compat key becomes `f2.0-…` (the other components as today).
- The per-book build plans only the books and chapters a resource has, and counts errors as `failed` with their
  message instead of hiding them among `noop`.
- Nothing is published: no upload, no deploy. Code comments and commits in English; commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A book a resource does not have: no jobs planned, no empty part written. Pinned in Task 4 and Task 6.
- A resource whose zip has a book file the catalog lists as absent from the release: it stays out. Pinned in Task 5.
- Two builds of the same inputs give byte-identical parts and list (no dates anywhere). Pinned in Tasks 1, 2, 6.
- Peak memory over the limit: the build stops with a clear message naming the unit, never a silent kill. Pinned in
  Task 6.
- Every row today's whole build packs appears in exactly one part, and no part holds a row today's build does not
  pack. Pinned in Task 7.

---

### Task 1: the part file

**Files:**

- Create: `packages/language-pack/src/parts/partFile.ts`, `packages/language-pack/src/parts/partFile.test.ts`
- Modify: `packages/language-pack/src/index.ts` (export)

**Interfaces:**

- Produces:
  - `type PartRow = { layer: PackLayer; key: string; value: unknown }`
  - `VOLATILE_FIELDS: readonly string[]` (the six names in Global Constraints)
  - `stripVolatile(value: unknown): unknown` — a deep copy without those fields
  - `writePart(rows: Iterable<PartRow>): Promise<{ bytes: Uint8Array; sha256: string; rows: number }>` — strips,
    sorts (layer order then key), serializes one JSON line per row with keys of each value in stable order, gzips with
    mtime 0 and no name
  - `readPart(bytes: Uint8Array): Promise<PartRow[]>`
  - `partPath(sha256: string): string` → `parts/${sha256}.part.gz`

- [ ] **Step 1: Write the failing tests**: the same rows in two orders give the same sha256; a row whose value has
      `timestamp`/`expiresAt` (top level and nested) gives the same sha256 as without them; `readPart(writePart(x))`
      round-trips the stripped rows in sorted order; two `writePart` calls with identical input give identical bytes;
      `partPath('ab…')`.
- [ ] **Step 2: Run** `bun test src/parts` (packages/language-pack) — FAIL.
- [ ] **Step 3: Implement** (gzip via `node:zlib` `gzipSync` with `{ level: 9 }`; its header carries mtime 0 and no
      name by default — assert the header bytes in a test).
- [ ] **Step 4: Run** `bun test` in packages/language-pack — PASS; `bun run build` there.
- [ ] **Step 5: Commit** `Packs: a deterministic part file`.

### Task 2: the parts list and the new format version

**Files:**

- Create: `packages/language-pack/src/parts/partsList.ts`, `partsList.test.ts`
- Modify: `packages/language-pack/src/types.ts:15` (`PACK_FORMAT_VERSION` → `'2.0.0'`), `packages/resource-pipeline/src/language/sample-output.json` (refreshed as its test says)

**Interfaces:**

- Produces:
  - `type PartKind = 'book' | 'alignments' | 'original' | 'macula' | 'tw' | 'ta' | 'titles' | 'lexicon' | 'obs'`
  - `type PartEntry = { sha256: string; bytes: number; rows: number; kind: PartKind; resource: string; book?: string; group?: string; layers: PackLayer[] }`
  - `type PartsList = { schema: 2; language: string; compat: string; versions: PackVersions; resources: Array<{ key: string; stamp: string; role: PackResourceRole; subject: string; title: string; books?: string[]; metadata: unknown }>; parts: PartEntry[]; originals?: { path: string; sha256: string } }`
    (`metadata` is the resource's catalog row, which carries `bookBlobs`; `stamp` is its release stamp)
  - `partsListPath(compat: string, language: string): string` → `catalog/${compat}/${language}.json` (the language
    `originals` names the shared originals list)
  - `serializePartsList(list: PartsList): string` — parts sorted by (kind, resource, book, group), resources by key,
    stable JSON; no dates.

- [ ] **Step 1: Write the failing tests**: serialization is identical for lists built in different orders; no field
      named like a date appears; `partsListPath`; the compat key from `compatKeyOf(PACK_FORMAT_VERSION, PACK_VERSIONS)`
      starts with `f2.0-`.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement**; bump the format version; refresh `sample-output.json` by the test's own instruction.
- [ ] **Step 4: Run** `bun test` in language-pack and `bun test src/language` in resource-pipeline — PASS. Rebuild.
- [ ] **Step 5: Commit** `Packs: the parts list (schema 2) and format 2.0`.

### Task 3: which part a row belongs to

**Files:**

- Create: `packages/language-pack/src/parts/partSlots.ts`, `partSlots.test.ts`

**Interfaces:**

- Consumes: `bookOfRow`, `isBookScoped`, `scansFor`/`belongsTo` (keys.ts), `ORIGINAL_LANGUAGE_KEYS`.
- Produces:
  - `type PartSlot = { kind: PartKind; resource: string; book?: string; group?: string }`
  - `fnv1a32(text: string): number`
  - `slotOfRow(row: { layer: PackLayer; key: string }, resource: { key: string; type?: string; subject?: string }): PartSlot | null`
    — `null` for rows no part carries (receipts, coverage, anything today's pack drops); the rules in Global
    Constraints, with `alignments` for `align` rows of TN/TWL, `titles` for `text` rows of TA/TW.
  - `slotId(slot: PartSlot): string` — `kind:resource[:book][:group]`, used to group rows.

- [ ] **Step 1: Write the failing tests**, one per rule, with real key shapes from the codebase: a ULT Ruth chapter
      row → `book`/`rut`; a TN Ruth prepared row and quote row → the same `book` slot; a TN Ruth align row →
      `alignments`/`rut`; `scripture-usj:unfoldingWord/hbo/uhb:rut:1` → `original`/`rut`; a MACULA tree row →
      `macula`/`rut`; `unfoldingWord/en/tw/bible/kt/god.md` → `tw` group `kt:<n>` with `n = fnv1a32('kt/god.md') % 8`;
      a TA translate article → `ta` group `translate:<n>`; `helps-text:ta-title:…` → `titles`; a lexicon
      `…/uhl/content/1234.json` → `lexicon` group `1`; an OBS story 12 row → `obs` group `11-20`; `resource:{key}` →
      `null`; `warm-coverage:v1` → `null`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `bun test` in language-pack — PASS; rebuild.
- [ ] **Step 5: Commit** `Packs: which part each row belongs to`.

### Task 4: plan only what a resource has, and count failures

**Files:**

- Modify: `packages/resource-pipeline/src/warm/warmAdmitPlan.ts:580-647` (`collectLane3Groups`),
  `packages/resource-pipeline/src/language/buildLanguageArtifacts.ts` (options; the catch at ~198-202),
  `packages/resource-pipeline/src/warm/warmTypes.ts` (outcome type)
- Test: `warmAdmitPlan.test.ts`, `buildLanguageArtifacts.test.ts`

**Interfaces:**

- Produces:
  - `collectLane3Groups(args & { books?: readonly string[]; chaptersOf?: (resourceKey: string, book: string) => readonly number[] | null; articles?: boolean; obs?: boolean })`
    — with `books`, walks only those books; with `chaptersOf`, plans only the chapters it returns (`null` or `[]`:
    the resource lacks the book, nothing planned); `articles: false` / `obs: false` skip those loops.
  - `buildLanguageArtifacts(o & { books?: readonly string[]; chaptersOf?: …; articles?: boolean; obs?: boolean })`
    passing them through; its summary gains `failed: number` and `failures: Array<{ job: string; error: string }>`
    (first 20); a thrown job error is `failed`, never `noop`.
  - `chaptersFromStore(cache, resourceKey, book): Promise<number[] | null>` — from the `scripture-usj:{rk}:{book}`
    index row's `chapterNumbers`, or the TSV book row's chapters (TN `chaptersWithNotes`, TQ/TWL from their rows);
    `null` when the store has no row for the book.

- [ ] **Step 1: Write the failing tests**: `books: ['rut']` plans only Ruth; `chaptersOf` returning `[1, 2]` plans
      only chapters 1–2; `null` plans nothing for that resource; `articles: false` plans no article jobs; a job that
      throws is counted `failed` with its message.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `bun test src/warm src/language` — PASS.
- [ ] **Step 5: Commit** `Build: plan only the books and chapters a resource has; failures are failures`.

### Task 5: zipballs kept on disk, read one book at a time

**Files:**

- Create: `packages/resource-pipeline/src/download/zipCache.ts`, `zipCache.test.ts`
- Modify: the ingredient loops of `packages/scripture-loader/src/ScriptureLoader.ts` (~821-926),
  `packages/translation-notes-loader/src/TranslationNotesLoader.ts` (~573-656), the TQ and TWL loaders' zip loops
  (same pattern), and `packages/resource-pipeline/src/download/runDownload.ts` (pass the options through)

**Interfaces:**

- Produces:
  - `zipCachingClient(client: Door43Client, dir: string): Door43Client` — wraps `downloadZipball(...)`: first call
    per (owner, repo, ref) downloads and saves `${dir}/${owner}__${repo}__${ref}.zip`, later calls read the file.
  - Loader option `books?: readonly string[]` on `downloadResource(resourceKey, options)`: when given, the ingredient
    loop processes only those books (lowercase compare) and writes no receipt.
  - `runDownload(o & { books?: readonly string[]; door43Client })` passes `books` to each loader.

- [ ] **Step 1: Write the failing tests**: `zipCachingClient` downloads once for two calls; a ScriptureLoader zip run
      with `books: ['rut']` over a fixture zip with RUT and JON writes only Ruth's rows and no receipt; the same for TN
      (fixture TSVs); an ingredient listed absent from the release (`absentFromRelease`) is not processed even when in
      `books`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the loader packages' tests and
      `bun test src/download` — PASS; `bash scripts/build-pack-tools.sh`.
- [ ] **Step 5: Commit** `Downloads: zipballs kept on disk and read one book at a time`.

### Task 6: the book-by-book build

**Files:**

- Create: `packages/resource-pipeline/src/language/buildLanguageParts.ts`, `buildLanguageParts.test.ts`
- Modify: `packages/resource-pipeline/cli/publish-language.ts` (a `--parts` flag, allowed only with `--no-upload`
  in this plan: writes `<work>/parts/*.part.gz`, `<work>/catalog/<compat>/<lang>.json` and `…/originals.json`)
- Modify: `.github/workflows/language-packs.yml` (a boolean input `parts`, default false, rejected unless
  `mode: no-upload`, which adds `--parts`; actionlint clean)

**Interfaces:**

- Consumes: Tasks 1–5; `discoverLanguage`, `runDownload`, `buildLanguageArtifacts`, `addLexicons`, `addMacula`,
  `recordBlobsAfterComplete` (plan 2a), `closeAndDelete` (`fakeDatabases.ts`).
- Produces:
  `buildLanguageParts(o: { language: string; workDir: string; macula: {...}; lexiconsRef?: string; obs?: boolean; memoryLimitMb?: number; log?: (line: string) => void }): Promise<{ list: PartsList; originals: PartsList; summary: Record<string, { built: number; cached: number; blocked: number; noop: number; failed: number }>; peakRssMb: number }>`
  Steps, in order:
  1. Catalog database (kept for the run): discovery, resources' catalog rows, and their book blobs through a
     metadata-only pass (`recordBookBlobs` per book-scoped resource).
  2. Shared unit, in a fresh cache database: download TW, TA and OBS whole (through `zipCachingClient`), lexicons and
     MACULA (companions); run article/OBS jobs and titles (`books: []`, `articles: true`, `obs: true`); slot and write
     every non-book part; `closeAndDelete`.
  3. For each book of the canon that any book-scoped resource of the language has (from catalog ingredients minus
     `absentFromRelease`), in a fresh cache database: `runDownload` with `books: [book]` for every book-scoped
     resource and the original of that book's testament; write each downloaded resource's receipt from its catalog
     row (as `companions.ts` `addResource` does) so the jobs find it; `buildLanguageArtifacts` with `books: [book]`,
     `chaptersOf` from `chaptersFromStore`, `articles: false`, `obs: false` (and for the original's language, the same);
     slot and write the book's parts (book-scoped resources, `alignments`, `original`, `macula`); `closeAndDelete`.
  4. After each unit: `process.memoryUsage().rss`; keep the peak; over `memoryLimitMb` (default 10 240) throw
     `Error("<unit> used <n> MB, over the <limit> MB limit")`.
  5. Write the language list and the originals list (`serializePartsList`); every resource's `metadata` is its
     catalog row from step 1, `stamp` its release stamp.

- [ ] **Step 1: Write the failing tests** with a fake Door43 (fixture zips for a tiny language: ULT, UST, TN, TWL, TW
      with 3 articles, UGNT/UHB with RUT and JON): the parts written are exactly `book`/`alignments` for RUT and JON per
      resource, `original` RUT/JON, `tw` groups, `titles`; no part for a book no resource has; two runs give identical
      `list` JSON and identical part files; a `memoryLimitMb: 1` run throws naming the first unit.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**, then the `--parts` flag.
- [ ] **Step 4: Run** `bun test` in resource-pipeline — PASS; `bash scripts/build-pack-tools.sh`.
- [ ] **Step 5: Commit** `Build: a language as parts, one book at a time`.

### Task 7: the same rows as today, and the English measurement

**Files:**

- Create: `packages/resource-pipeline/cli/compare-parts.ts` (a check script, not shipped in packs)

**Interfaces:**

- `compare-parts --pack <whole.langpack.zip> --originals <originals.langpack.zip> --parts <work>` prints, per layer
  and resource, rows only in the whole pack, rows only in the parts, and rows whose stripped values differ; exits 1
  when any list is non-empty.

- [ ] **Step 1: Build es-419 both ways**, nothing uploaded: the whole build of this branch (`--no-upload`, today's
      path) and `--parts --no-upload`. Run `compare-parts`. Expected: no differences. Any difference is investigated and
      fixed in the task that owns it before going on (record each in the ledger).
- [ ] **Step 2: Record** the per-unit peak memory and duration for es-419.
- [ ] **Step 3: Measure English on a GitHub runner**, after this branch is merged (the `packs-staging` Environment
      accepts only `master`) and with Abel's yes: dispatch `language-packs.yml` with `language: en`, `mode: no-upload`,
      `parts: true`. Expected: peak far below 14.9 GB; record the largest unit and the total time.
- [ ] **Step 4: Commit** `Packs: compare a parts build with the whole build` and push nothing.
