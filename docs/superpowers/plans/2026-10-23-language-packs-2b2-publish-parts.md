# Language packs 2b-2: publish parts, and reuse the unchanged ones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A parts build computes a fingerprint for every part and every unit from the bytes it holds, carries every
unit whose fingerprint did not change from the previously published list (same sha256: not built, not uploaded), and
publishes to the staging bucket: new parts first, then the originals list, then the language list last.

**Architecture:** The catalog step of `buildLanguageParts` already downloads every book-scoped release zip; it now
also downloads the shared resources' zips and the lexicon archives (all kept on disk, as the units read them), and
turns each resource into a map `path → git blob sha` computed from the bytes. Pure functions in `language-pack` say
which files each part and each unit depends on (its own files, the original's book, the texts its alignments use, the
normalized manifests, the code's compat key) and hash them. The language list records each part's fingerprint and
each unit's fingerprint. Given the previous list (from R2, or a local work folder), a unit whose fingerprint is
unchanged and whose parts the bucket still has is carried; every other unit is built whole, as in 2b-1. A new
`publishLanguageParts` uploads what the bucket lacks and writes the lists last. Door43's tree is read only to
cross-check the blob shas the build computed: the Worker (delivery 3) will read the same shas from the tree, so a
difference would make it ask for builds forever. Nothing in the Worker changes.

**Tech Stack:** TypeScript, Bun (`bun test`), fake-indexeddb, JSZip (reading zips), pako (part gzip), Web Crypto
(SHA-1 for git blob shas, SHA-256 for fingerprints), R2 through presigned `fetch` (`r2Bucket`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-language-packs-parts-design.md` (translation-helps-mcp), §2 Fingerprints
and when to build (steps 2–6), §3 Format and storage, §4 The build (steps 1, 2, 5, 6 and the checks), §6 delivery 2b and
the 2026-10-22 decisions. The 2b-1 ledger (`tc-study/.superpowers/sdd/2b1-ledger.md`) supersedes the 2b-1 plan where
they differ: whole packs stay format `1.1.0`; parts use `PARTS_FORMAT_VERSION = '2.0.0'` (compat `f2.0-…`); pako for
gzip; units are `shared` plus one per book, non-canon books included; `parts-report.json`; `compare-parts`; the
workflow's `parts` and `compare` inputs.

All code is in tc-study, on a branch from `master` (5771dcf or later) named `feat/packs-publish-parts`.

**Measured so far (2b-1):** English as parts on a GitHub runner (run 39942659119): 975 s, peak 2121 MB, 595 language
parts and 132 original parts, 0 failures; the largest units grew by +1114 MB (gen) and +1049 MB (psa, 140 s, the
slowest). es-419 (run 39949734159): `compare-parts` found no difference from the whole build; 81 parts and 132
original parts, peak 1442 MB, 79 s. English's `parts-report.json` could not be downloaded (artifact storage blocked
from the cloud session), so there are no per-part sizes yet.

## Global Constraints

- **A file's hash is its git blob sha**: `sha1("blob <byte length>\0" + bytes)`, lowercase hex, computed by the build
  from the bytes it holds (zip entry, tar entry, MACULA file). Paths are repository-relative, `/`-separated, without
  `./` and without the zipball's top folder (`es-419_tn/tn_RUT.tsv` → `tn_RUT.tsv`). Lexicon files are keyed by their
  row path (`lexiconRowPath`: `content/H1961.json`), MACULA files by `trees/RUT.json` / `referents/RUT.json`.
- **The normalized manifest**: `manifest.yaml` with CRLF turned to LF, trailing spaces dropped, the lines `version:`,
  `modified:` and `issued:` directly under top-level `dublin_core:` dropped, and `?v=<anything>` removed from the items
  of `dublin_core.relation`. Any other shape is hashed as it is (a needless rebuild, never a missed change).
  `manifest.yaml` itself is never a file input: only its normalized sha256.
- **A fingerprint** is the sha256 (hex) of the stable JSON (keys sorted at every depth) of
  `{ v: FINGERPRINT_VERSION, code: <parts compat key>, id: <slot id or unit id>, files: [[resource, path, blob]…],
  manifests: [[resource, sha256]…], stamps: [[resource, stamp]…] }`, each array deduplicated and sorted. Web Crypto
  only, so tc-study's app and the Worker can run the same code.
- **Inputs of a part** (resource R, book b):
  - `book` of a text or an original: R's file for b; of a helps resource (TN, TQ, TWL): R's file for b and the
    original's file for b;
  - `alignments` (TN, TWL): R's file for b, the original's file for b, and b's file in every scripture resource of
    the language that has b;
  - `original`: R's file for b; `macula`: `trees/<B>.json` and `referents/<B>.json`;
  - `tw` group: every `bible/<folder>/<name>.md` whose group (`twGroupOf`, the rule rows use) is that group;
  - `ta` group: every file under `<manual>/<article>/` whose group (`taGroupOf`) is that group, and the manual's own
    files (`<manual>/toc.yaml`, `config.yaml`);
  - `titles`: every file of R and **R's release stamp**, because `helps-text:{kind}:{key}@{stamp}:…` keys carry it;
  - `lexicon` group: the row files whose group (`lexiconGroupOf`) is that group;
  - `obs` group: every file of R (OBS stays off by default; no per-story precision yet);
  - and for every part: the normalized manifest of each Door43 resource whose files it uses, and **every file of R that
    no rule above maps** (README, LICENSE, media.yaml, front matter not in the ingredients…).
- **Inputs of a unit**: `book <b>`: every input of every part the unit can write, i.e. each built resource's file for b,
  the original's file for b, every unmapped file and normalized manifest of those resources; `shared`: every file and
  manifest of the shared resources (TW, TA, OBS, lexicons, MACULA) and the TW/TA release stamps. Each part's inputs
  must be within its unit's inputs; the build throws otherwise (a part could change while its unit looks unchanged).
- **Carry or build** is decided per unit: a unit is carried only when the previous list (same compat) records the same
  unit fingerprint, every part of that unit in the previous lists is still in the bucket, and every carried part's
  fingerprint recomputed now equals the one recorded. Otherwise the unit is built whole, as in 2b-1. No partial units.
- **Bucket writes, in this order:** parts (`parts/<sha256>.part.gz`, `application/gzip`,
  `public, max-age=31536000, immutable`, no `Content-Encoding`; skipped when the bucket has the key), then the
  originals list at its content address `catalog/<compat>/originals/<sha256>.json` (immutable), then
  `catalog/<compat>/originals.json` (`no-cache`), then `catalog/<compat>/<language>.json` (`no-cache`) last. Nothing
  deletes a part or a list (cleanup is delivery 3).
- **Where parts go:** staging only. The workflow refuses `parts` with `target: production` until the Worker serves
  parts (delivery 3). A staging publish runs only with Abel's yes. Nothing is published to production.
- **Untouched:** whole packs (`PACK_FORMAT_VERSION` 1.1.0, `publishLanguage`, `catalog/f1.1-…`, `packs/…`, `v1/…`
  views) and the Worker (translation-helps-mcp `src/packs/*`, `CURRENT_PACK_COMPAT`; its freshness check and sweep act
  only on `CURRENT_PACK_COMPAT`, and its routes never read `parts/`).
- Code comments and commits in English; commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Edits keep each file's line endings (CRLF where the file
  has them). Packages import each other's `dist/`: after changing `language-pack`, `resource-catalog` or another
  package `scripts/build-pack-tools.sh` lists, run it before testing `resource-pipeline`.

## Review Focus

- **Same fingerprint everywhere.** The build (from bytes), the Worker (from Door43's tree, delivery 3) and tc-study's
  app must reach the same value: paths without the zip's top folder, the blob sha of the exact bytes, one manifest
  normalization, one stable JSON. Golden vectors pinned in Task 1; the zip-vs-tree cross-check (Tasks 5–6) makes any
  difference a build failure. Watch for a zip entry Door43 transforms (`.gitattributes` `export-subst`, eol rules).
- **Never missing a change.** A unit's inputs are a superset of its parts' inputs (asserted); unmapped files count for
  every part of their resource; `--force` ignores the previous list. Task 7's mutation table proves, for each kind of
  input, that the build with reuse gives byte-identical lists and parts to a full build, and that every part whose
  bytes changed also changed fingerprint.
- **Rows that carry the release.** A carried part keeps the rows of the release it was built from. Task 7 pins which
  parts change when only release tags move (expected: `titles` only); any other is a missed dependency.
- **The language list is written last and never names a missing part.** Carried parts are checked in the bucket
  before deciding (missing → the unit is built); built parts are put before any list; before the language list is
  written every sha256 the two lists name must be known present. A failed or cut-short upload leaves the previous
  list, whose parts nothing deletes. Pinned in Task 9.
- **The language list names the originals it was made against.** The content-addressed originals list
  (`catalog/<compat>/originals/<sha256>.json`) cannot be overwritten by another language's run; `originals.json`
  stays last-writer-wins. Pinned in Tasks 3 and 9.
- **Output changes under the same compat key.** Reuse makes this worse than before: a carried part would keep old
  output forever. The sample guard (Task 4) covers the part bytes, the slot rules and the bucket counts.
- **f1.1 whole packs untouched.** `publishLanguage` tests, the f1.1 sample hash and the whole path of the workflow stay
  as they are (Tasks 4, 9, 10).

## Decisions taken in this plan (Abel to confirm)

1. **Decide by unit fingerprint**, recorded in the list (`units`), beside each part's own `fingerprint` (which 2c's
   views and delivery 3 use). Deciding per part would need to predict empty slots (a book with no alignments) and
   would loop on them; per unit, a unit's inputs are just files.
2. **No partial units.** A built unit rebuilds all its parts; an unchanged part comes out with the same sha256, so it
   is neither uploaded nor downloaded again. The cost is one unit's time (at most psa, 140 s).
3. **Fetching only changed files (§4 step 2) waits.** Zips stay the input: the build must hash every input of every
   unit anyway (it does not trust the asker), en_tw is one request, and the cost that matters (memory and time per
   unit) is what reuse removes. The report records download count, bytes and seconds, to decide with numbers.
4. **Parallel books (§4 step 5) wait.** Jobs are CPU-bound JavaScript in one thread; parallelism needs worker
   processes, each with its own fake-indexeddb, catalog copy and report merge. English takes 16 minutes in a
   300-minute job, and with reuse a typical run builds a few units.
5. **Blob shas come from the bytes; the tree only checks them.** A mismatch is a failure (nothing is published); an
   unreadable or incomplete tree is `unverified`, counted in the report, not a failure.
6. **The parts build records `bookBlobs` from the bytes**, never through the release-stamp fallback, so a carried
   part's quote and alignment keys always match the list's catalog rows.
7. **`titles` depend on the TW/TA release stamp** (their keys carry it), so the shared unit rebuilds on every TW or
   TA release. Follow-up outside 2b-2: content stamps for `helps-text` keys, as 2a did for quotes.
8. **OBS parts take every OBS file as input** while OBS stays off by default.
9. **Unmapped files are inputs of every part of their resource.** Safe; a LICENSE change costs build time only.
10. **A content-addressed originals list** (`catalog/<compat>/originals/<sha256>.json`), named by the language list,
    with `originals.json` kept as the latest. A spec change (§3 named only `originals.json`).
11. **Bucket counts are guarded by `PARTS_FORMAT_VERSION`**: changing one needs a format bump (the sample guard
    fails otherwise), instead of a new segment in the compat key, which `COMPAT_RE` in the Worker, the workflow and
    `packs-status` would reject.
12. **The code part of a fingerprint is the whole parts compat key** (plus `FINGERPRINT_VERSION`), not per-layer
    versions: a version bump makes a new compat folder with no previous list anyway, and unchanged bytes keep their
    sha256. Reusing parts across compat keys is left for later.
13. **No stamps pre-check in a parts publish.** Every parts run downloads and recomputes; it is `unchanged` when the
    lists come out identical. The Worker does the cheap check in delivery 3, and the second staging run becomes a
    real-data test of fingerprint determinism.
14. **The shared unit stays one unit**, and each language's first parts run builds the originals' 66 books itself
    (no reuse of originals across languages yet).
15. **Bucket counts are set from an English sizes run before English is published to staging**; es-419 may go to
    staging first with today's counts (a later bump only makes a new staging folder).

---

### Task 1: git blob shas, the normalized manifest and the fingerprint

**Files:**

- Create: `packages/language-pack/src/parts/fingerprint.ts`, `packages/language-pack/src/parts/fingerprint.test.ts`
- Modify: `packages/language-pack/src/index.ts` (exports)

**Interfaces:**

- Produces:
  - `FINGERPRINT_VERSION = 1`
  - `gitBlobSha(bytes: Uint8Array): Promise<string>` — Web Crypto SHA-1 of `blob <n>\0` + bytes
  - `normalizeManifest(text: string): string` — the rule in Global Constraints
  - `manifestFingerprint(text: string): Promise<string>` — sha256 hex of the normalized text's UTF-8
  - `type FingerprintInputs = { files: Array<[string, string, string]>; manifests: Array<[string, string]>; stamps: Array<[string, string]> }`
  - `fingerprintOf(o: { code: string; id: string; inputs: FingerprintInputs }): Promise<string>`

- [ ] **Step 1: Write the failing tests**: `gitBlobSha` of `hello\n` is `ce013625030ba8dba906f756967f9e9ca394464a` and
      of empty bytes `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391` (what `git hash-object` gives); `normalizeManifest`
      gives the same text for two manifests that differ only in `dublin_core.version`, `modified`, `issued`, a
      relation's `?v=86`, and CRLF vs LF; a different `title`, a removed `projects` item, or a `version:` under `source:`
      gives a different text; `fingerprintOf` is the same for inputs given in any order or with duplicates, changes
      with `code`, `id` or any one blob; a golden value for a fixed input (written into the spec in Task 12).
- [ ] **Step 2: Run** `bun test src/parts` in packages/language-pack — FAIL.
- [ ] **Step 3: Implement** (line-based, tracking indentation under `dublin_core:`; reuse `stableJson` and
      `sha256Hex` from `partFile.ts`).
- [ ] **Step 4: Run** `bun test` in packages/language-pack — PASS; `bun run build` there.
- [ ] **Step 5: Commit** `Packs: git blob shas, normalized manifests and fingerprints`.

### Task 2: which files a part and a unit depend on

**Files:**

- Create: `packages/language-pack/src/parts/partInputs.ts`, `partInputs.test.ts`
- Modify: `packages/language-pack/src/parts/partSlots.ts` (export the private `twGroup`, `taGroup`, `lexiconGroup` as
  `twGroupOf`, `taGroupOf`, `lexiconGroupOf`, unchanged), `packages/language-pack/src/index.ts`

**Interfaces:**

- Consumes: `PartSlot`, `isBookScoped`, `ORIGINAL_LANGUAGE_KEYS`, Task 1.
- Produces:
  - `type ResourceFiles = { key: string; type?: string; subject?: string; stamp: string; manifest?: string; files: ReadonlyMap<string, string>; books?: Readonly<Record<string, string>> }`
    (`manifest`: the normalized manifest's sha256; `books`: lowercase book → path, books present in the release only)
  - `type InputsContext = { resources: ReadonlyMap<string, ResourceFiles>; originalOf(book: string): string | undefined }`
  - `unitOfSlot(slot: PartSlot): string` — `book <b>` for `book`, `alignments`, `original`; `shared` for the rest
    (MACULA is sliced per book but built in the shared unit)
  - `partInputs(slot: PartSlot, ctx: InputsContext): FingerprintInputs` — the table in Global Constraints
  - `unitInputs(unit: string, keys: readonly string[], ctx: InputsContext): FingerprintInputs` — `keys`: the resources
    the unit builds
  - `missingFromUnit(part: FingerprintInputs, unit: FingerprintInputs): string[]` — empty when the part is within

- [ ] **Step 1: Write the failing tests**, one per row of the table, with small maps: a ULT `book` part has only
      `08-RUT.usfm` (+ manifest); a TN `book` part has `tn_RUT.tsv` and UHB's `08-RUT.usfm`; a TN `alignments` part adds
      the GLT and GST Ruth files and not a text lacking Ruth; `tw` group `kt:<n>` has exactly the articles with that
      group, and `twGroupOf('bible/kt/god.md')` equals the group `slotOfRow` gives the sot row
      `test_gl/es-419/tw/bible/kt/god` and its prepared row (the same for a TA article and its `taGroupOf`, and for a
      lexicon row file); `translate/toc.yaml` is in every `translate:<n>` group, not in the one its name hashes to;
      `titles` carries the stamp; a `README.md` is in every part of its resource; `manifest.yaml` is
      never a file input; every part of a two-book fixture is within its unit (`missingFromUnit` empty); a part whose
      unit was given fewer resources is not.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `bun test` in packages/language-pack — PASS;
      rebuild.
- [ ] **Step 5: Commit** `Packs: the inputs of a part and of a unit`.

### Task 3: fingerprints and units in the list; the originals list by content

**Files:**

- Modify: `packages/language-pack/src/parts/partsList.ts`, `partsList.test.ts`, `packages/language-pack/src/index.ts`

**Interfaces:**

- Produces:
  - `PartEntry.fingerprint: string`
  - `PartsList.units?: Array<{ id: string; fingerprint: string }>` (the language list; `shared`, `book <b>`)
  - `originalsListPath(compat: string, sha256: string): string` → `catalog/${compat}/originals/${sha256}.json`
  - `unitOfPart(part: Pick<PartEntry, 'kind' | 'book'>): string` (same rule as `unitOfSlot`)
  - `serializePartsList` sorts `units` by id.

- [ ] **Step 1: Write the failing tests**: units in any order serialize alike; a part without a fingerprint is a type
      error (the build must give one); `originalsListPath` shape; `unitOfPart` for each kind.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; `buildLanguageParts.ts` writes `fingerprint: ''` until Task 6
      (whose test requires 64 hex characters), so the build keeps compiling between the two commits.
- [ ] **Step 4: Run** `bun test` in language-pack and resource-pipeline — PASS; rebuild.
- [ ] **Step 5: Commit** `Packs: the list records fingerprints and units, and the originals list by content`.

### Task 4: the sample-output check covers parts

**Files:**

- Modify: `packages/resource-pipeline/src/language/sampleOutput.test.ts`,
  `packages/resource-pipeline/src/language/sample-output.json`

**Interfaces:**

- `sample-output.json` becomes `{ compat, hash, partsCompat, partsHash }`. `compat` and `hash` are today's (f1.1 rows,
  unchanged). `partsHash` is the sha256 of: the `writePart` bytes of the sample's quote, align and prepared rows
  under keys shaped as the build writes them (one of each layer copied from the fixture build), the `slotId`s
  `slotOfRow` gives a fixed list of keys (TW, TA translate, lexicon, OBS, book rows), the bucket constants
  (`TW_BUCKETS`, `TA_TRANSLATE_BUCKETS`, `LEXICON_RANGE`, `OBS_STORIES_PER_PART`), and the Task 1 golden fingerprint.
  `partsCompat` is `compatKeyOf(PARTS_FORMAT_VERSION, PACK_VERSIONS)`.

- [ ] **Step 1: Write the failing test**: `partsHash` may change only with `partsCompat`; the message says that parts
      are reused by fingerprint, so an output change without a bump would never reach a carried part, and names the
      bump: a `PACK_VERSIONS` version for rows, `PARTS_FORMAT_VERSION` for part bytes, slots or bucket counts.
- [ ] **Step 2: Run** `bun test src/language/sampleOutput.test.ts` — FAIL (no `partsHash` stored).
- [ ] **Step 3: Implement**; refresh with `UPDATE_SAMPLE=1` (no version changed, so `compat` and `hash` must stay
      byte-identical: check the diff).
- [ ] **Step 4: Run** it again — PASS; then change `TW_BUCKETS` locally to 9, run — FAIL with the message; revert.
- [ ] **Step 5: Commit** `Packs: the sample-output check covers part bytes, slots and bucket counts`.

### Task 5: a resource's files, from what the build holds, checked against Door43's tree

**Files:**

- Create: `packages/resource-pipeline/src/language/inputFiles.ts`, `inputFiles.test.ts`
- Modify: `packages/door43-api/src/Door43ApiClient.ts:1258-1318` (`fetchRepoTreeBlobs`),
  `packages/door43-api/src/Door43ApiClient.tree.test.ts`

**Interfaces:**

- Produces:
  - `Door43ApiClient.fetchRepoTree(owner, repo, ref): Promise<{ blobs: Map<string, string>; complete: boolean }>` —
    the paging loop of `fetchRepoTreeBlobs`, with `complete: false` when the last page read still says `truncated`
    (the 50-page cap, or an empty truncated page); `fetchRepoTreeBlobs` returns its `blobs` (behaviour unchanged).
  - `zipInputs(zip: Uint8Array | ArrayBuffer): Promise<{ files: Map<string, string>; manifest?: string }>` — every
    file entry without the top folder, `gitBlobSha` of its bytes, one entry at a time; `manifest`: `manifest.yaml`'s
    text when present
  - `lexiconInputs(tarGz: Uint8Array): Promise<{ files: Map<string, string>; manifest?: string }>` — `untar`
    (cli/companions.ts), only files with a `lexiconRowPath`, keyed by that row path
  - `folderInputs(folder: string, parts: readonly string[]): Promise<Map<string, string>>` — MACULA's
    `trees/<B>.json` and `referents/<B>.json`
  - `treeCheck(files: ReadonlyMap<string, string>, tree: { blobs: ReadonlyMap<string, string>; complete: boolean } | null): { state: 'match' | 'mismatch' | 'unverified'; differing: string[] }`
    — `mismatch` when any path both have differs in sha (or a complete tree lacks a file the zip has); `unverified`
    when the tree is null or incomplete and nothing differs
  - `archiveCachingFetch(fetchFn, dir): typeof fetch` — a GET of a `/archive/` URL is saved in `dir` and read from
    there afterwards (what `zipCachingClient` does for zips), so the lexicon archive is downloaded once per run

- [ ] **Step 1: Write the failing tests**: `fetchRepoTree` over a fake fetch giving two truncated pages then a last one
      → complete, every blob; 50 truncated pages → `complete: false`; `zipInputs` of the fixture's `storedZip` for
      `es-419_tn` equals `fakeDoor43().fetchRepoTreeBlobs` for it (no top folder); `lexiconInputs` of the fixture's
      tar keeps `content/H1961.json` and drops `manifest.yaml` from `files`; `treeCheck` with one changed sha →
      `mismatch` naming the path; with `null` → `unverified`; `archiveCachingFetch` fetches once for two reads.
- [ ] **Step 2: Run** `bun test Door43ApiClient.tree.test.ts` (door43-api) and `bun test src/language/inputFiles.test.ts`
      — FAIL. **Step 3: Implement.** **Step 4: Run** both — PASS.
- [ ] **Step 5: Commit** `Packs: each resource's files and blob shas, checked against Door43's tree`.

### Task 6: the build fingerprints every part and unit

**Files:**

- Modify: `packages/resource-pipeline/src/language/buildLanguageParts.ts`, `buildLanguageParts.test.ts`,
  `packages/resource-pipeline/src/language/partsFixture.ts` (a `manifest.yaml` in every fixture repository;
  `fakeDoor43({ repos?, tree? })` and `discover`/`catalogRows` taking overrides, for Task 7's mutations)

**Interfaces:**

- Consumes: Tasks 1–5; `bookBlobsFromTree` (resource-catalog, it takes any `path → sha` map); `lexiconOwnerOf`,
  `resolveLexicon` (cli/companions.ts).
- Produces (inside `buildLanguageParts`, step 1, the catalog):
  - every resource's archive is fetched before any unit: book-scoped zips as today (`releaseFileNames`, whose bytes now
    also feed `zipInputs`), the shared ones (TW, TA, OBS when on) through the same `zipCachingClient` at the ref the
    loaders use (`refOf`), the lexicons through `archiveCachingFetch` (`<work>/zips`), MACULA from its folder;
  - a `ResourceFiles` per resource (`stamp`: `resourceContentStamp`; `books`: ingredients minus absent, with paths);
  - `bookBlobs` of each book-scoped resource from its own files (`bookBlobsFromTree(files, ingredients)`, with
    `bookBlobsRef` = the tag), replacing `recordBlobsAfterComplete` here;
  - `treeCheck` against `fetchRepoTree` when the client has it: a `mismatch` is a failure of unit `catalog` naming the
    resource and up to 5 paths; counts of `match`/`mismatch`/`unverified` go in the report (`treeChecks`);
  - each written part gets `fingerprint = fingerprintOf({ code: compat, id: slotId(slot), inputs: partInputs(slot) })`
    and the build throws if `missingFromUnit` is not empty; the language list gets `units` (`shared` and every
    `book <b>` unit, from `unitInputs`); the language list's `originals.path` is `originalsListPath(compat, sha)` and
    that file is written beside `originals.json` (same text);
  - list resources' `books` come from the parts (kind `book`/`original` with an `sot` layer) instead of
    `booksWithRows`, so carried parts count too.
- Modify `compareParts.ts` to read the originals list at `list.originals.path`.

- [ ] **Step 1: Write the failing tests**: every part has a 64-hex fingerprint and the list has one unit per built unit;
      two runs give identical lists (fingerprints included); with `fetchRepoTreeBlobs`/`fetchRepoTree` throwing, the
      lists' `bookBlobs` are still the fixture's blob shas and `treeChecks.unverified` counts every resource, with no
      failure; a fake tree with one changed sha → one failure naming the resource; the equivalence test against the
      whole build (`compareParts`) still finds no difference.
- [ ] **Step 2: Run** `bun test src/language` (resource-pipeline) — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` in resource-pipeline and language-pack — PASS; `bash scripts/build-pack-tools.sh`.
- [ ] **Step 5: Commit** `Build: fingerprint every part and unit from the bytes it built them from`.

### Task 7: carry the units that did not change

**Files:**

- Modify: `packages/resource-pipeline/src/language/buildLanguageParts.ts`
- Create: `packages/resource-pipeline/src/language/buildLanguageParts.reuse.test.ts` (its own file: it runs many builds)

**Interfaces:**

- Produces:
  - `buildLanguageParts(o & { previous?: { list: PartsList; originals: PartsList; has(sha256: string): Promise<boolean> } })`
    — after step 1, for each unit (`shared`, then the books): carried when Global Constraints says so, else built.
    A carried unit's parts are copied from the previous language and originals lists (entries unchanged) and no
    database is opened for it.
  - `UnitRecord.outcome: 'built' | 'carried'`; the result gains `carried: string[]` (unit ids).
  - A previous list with another compat, another language, no `units`, or `schema` ≠ 2 is ignored with a log line
    (everything is built).

- [ ] **Step 1: Write the failing tests** (baseline: one full build of the fixture; each case a full build and a build
      with `previous` = baseline lists and `has` = the baseline's part files):
  - same inputs → every unit carried, no part file written, lists byte-identical to the baseline;
  - for each mutation, the build with reuse gives the same lists and part files as the full build of the mutated
    fixture, the units built are exactly the expected ones, and every slot whose sha256 changed between the two full
    builds has a changed part fingerprint and unit fingerprint:

    | Mutation                                           | Units built      |
    | -------------------------------------------------- | ---------------- |
    | GLT `08-RUT.usfm` text                             | `book rut`       |
    | UHB `32-JON.usfm`                                  | `book jon`       |
    | TN `tn_RUT.tsv`                                    | `book rut`       |
    | TWL `twl_JON.tsv`                                  | `book jon`       |
    | TW `bible/kt/god.md`                               | `shared`         |
    | TA `translate/figs-idiom/title.md`                 | `shared`         |
    | lexicon `content/H1961.json`                       | `shared`         |
    | MACULA `trees/RUT.json`                            | `shared`         |
    | MACULA commit only (same files)                    | none             |
    | lexicon commit only (same files)                   | none             |
    | TN manifest: version, modified, issued only        | none             |
    | TN manifest: title                                 | `book rut`, `book jon` |
    | GLT release tag only (same files)                  | none             |
    | TW release tag only (same files)                   | `shared`         |
    | GST gains its `01-GEN.usfm`                        | `book gen`       |
    | TQ loses `tq_JON.tsv`                              | `book jon`       |
    | a `README.md` added to TN                          | `book rut`, `book jon` |

  - the GLT tag-only case: the list differs from the baseline only in GLT's `resources` entry (stamp, metadata);
  - the TW tag-only case: only the `titles` part of TW changes sha256 (if any other part changes, a row carries the
    release: find it, then strip it if it is bookkeeping or add the stamp to that part's inputs; record it in the
    ledger);
  - `has` false for one part of `book rut` → `book rut` is built, the rest carried;
  - a previous list with another compat, or without `units` → every unit built.
- [ ] **Step 2: Run** `bun test src/language/buildLanguageParts.reuse.test.ts` — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` in resource-pipeline — PASS (record the reuse file's time; if over a minute, keep it
      out of the default run and say so in the ledger).
- [ ] **Step 5: Commit** `Build: carry the units whose fingerprint did not change`.

### Task 8: part sizes and downloads in the report

**Files:**

- Modify: `packages/resource-pipeline/src/language/buildLanguageParts.ts`, `buildLanguageParts.test.ts`

**Interfaces:**

- `PartsReport` gains:
  - `sizes: Record<string, { parts: number; bytes: number; min: number; median: number; max: number }>` keyed by kind,
    and for `tw` and `ta` also by `kind:folder` (`tw:kt`, `tw:names`, `tw:other`, `ta:translate`, `ta:checking`…),
    over both lists (carried parts included);
  - `downloads: { archives: number; bytes: number; seconds: number }` (step 1);
  - `treeChecks: { match: number; mismatch: number; unverified: number }` (from Task 6).
- The build's last log line prints the `tw`, `ta`, `lexicon` and `book` rows of `sizes` as a table.

- [ ] **Step 1: Write the failing test**: the fixture's report has `sizes.tw:kt.parts` equal to the number of `tw`
      parts in `kt`, medians and totals from the list's `bytes`, and `downloads.archives` equal to the archives fetched.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Parts report: sizes per kind, downloads and tree checks`.

### Task 9: the bucket says what it has; publishing parts

**Files:**

- Modify: `packages/resource-pipeline/src/language/publishLanguage.ts` (`PackBucket`, `memoryBucket`, `r2Bucket`;
  export `IMMUTABLE`, `NO_CACHE`, `eachLimit`), `publishLanguage.test.ts`
- Create: `packages/resource-pipeline/src/language/publishLanguageParts.ts`, `publishLanguageParts.test.ts`

**Interfaces:**

- `PackBucket.has(key: string): Promise<boolean>` — `memoryBucket`: the map; `r2Bucket`: a presigned `HEAD` (200 →
  true, 404 → false, other statuses throw), with the same retries as GET. `r2Bucket.put` uses the long timeout for
  everything but `application/json`.
- `publishLanguageParts(o: { language: string; workDir: string; macula: { folder: string; commit: string; date: string }; lexiconsRef: string; obs?: boolean; bucket?: PackBucket; noUpload?: boolean; previousDir?: string; force?: boolean; build?: typeof buildLanguageParts; log?: (line: string) => void }): Promise<PartsPublishResult>`
  - `PartsPublishResult = { language; outcome: 'unchanged' | 'published' | 'built'; compat; units: { built: number; carried: number }; parts: { language: number; originals: number; put: number; present: number }; peakRssMb: number; failures: number }`
  - previous lists: with a bucket, `catalog/<compat>/<lang>.json` and the originals list it names; with
    `previousDir`, the same paths under it, and carried part files are copied from `<previousDir>/parts` into
    `<workDir>/parts` (so `compare-parts` works on the new folder); `force` reads none.
  - `has(sha)`: `bucket.has(partPath(sha))`, or the file in `previousDir`; remembered per sha for the run.
  - Not published, and an error: any build failure; a list without the aligned literal text (the rule `notWhole`
    applies to whole packs); an original or MACULA without parts.
  - `noUpload` → `built`. New language list text equal to the previous one (and the same originals sha) → `unchanged`,
    nothing put. Otherwise the writes of Global Constraints, parts 16 at a time (`eachLimit`, stops at the first
    failure), each part `has`-checked before its put; before the language list, every sha256 both lists name must be
    put or known present, else it throws.

- [ ] **Step 1: Write the failing tests** (`memoryBucket` gains a `has`; `build` is the real build over the fixture):
  - first publish: every part put before any `catalog/` key, then `catalog/<c>/originals/<sha>.json`, then
    `originals.json`, then `<lang>.json` last; parts `application/gzip` + immutable, lists `application/json`,
    the content-addressed list immutable and the other two `no-cache`; the two originals texts identical;
  - second publish, same inputs → `unchanged`, no put, every unit carried;
  - GLT tag bump only → only the two catalog lists of the language are put (`originals.json` and its content address
    unchanged, so not put), no part;
  - a part the bucket already has is not put;
  - a put that fails on the 3rd part → the error goes up, no `catalog/` key written, the previous list still names
    parts all present;
  - a build with a failure → nothing put; `noUpload` → nothing put, `built`;
  - `r2Bucket.has` against `Bun.serve`: 200, 404, 503 then 200; `put` of `application/gzip` sends the immutable
    cache control.
- [ ] **Step 2: Run** `bun test src/language/publishLanguage` — FAIL. **Step 3: Implement** (check that Bun's
      `S3Client.presign` accepts `method: 'HEAD'`; if not, a `GET` with `Range: bytes=0-0`, 206/200 → true).
- [ ] **Step 4: Run** `bun test` in resource-pipeline — PASS (the `publishLanguage` tests unchanged).
- [ ] **Step 5: Commit** `Publish: parts first, the lists last, and nothing the bucket already has`.

### Task 10: the CLI, the status and the workflow

**Files:**

- Modify: `packages/resource-pipeline/cli/publish-language.ts`, `packages/resource-pipeline/cli/packs-status.ts`,
  `.github/workflows/language-packs.yml`

**Interfaces:**

- `publish-language --parts`: with the four `R2_*` publishes (`publishLanguageParts` with the bucket); with
  `--no-upload` builds into `--work`, optionally `--previous <work folder of an earlier run>`; `--force` now allowed
  with `--parts` (reads no previous list); `--dry-run` with `--parts` still refused; `--previous` without `--parts
  --no-upload` refused. The stdout line is the `PartsPublishResult`. Exit 1 on any failure, after the report is
  written (as today).
- `packs-status --parts`: the status and `--print-compat` use `compatKeyOf(PARTS_FORMAT_VERSION, PACK_VERSIONS)`, so a
  parts run writes `status/f2.0-…/<lang>.json` and never touches the f1.1 status the Worker reads.
- Workflow:
  - `parts` with `mode: publish` allowed only with `target: staging` (`::error::parts publish to production waits for
    the Worker (delivery 3)`); `parts` with `force` allowed; `compare` still needs `parts` and `no-upload`;
  - the build step passes `--parts` in both modes; the two status steps pass `--parts` when `PARTS` is true;
  - the step summary adds, from the result line and `parts-report.json` (`jq`): units built and carried, parts put
    and already present, tree checks, and the `sizes` rows of `tw`, `ta`, `lexicon` and `book`;
  - the artifact also uploads `packs-work/catalog/` (the lists);
  - the `parts` input's description: "Build as parts, one book at a time (publish: staging only, until the Worker
    serves parts)".

- [ ] **Step 1:** Run each refused combination of the CLI (`--parts --dry-run`, `--previous` without `--parts`,
      `--parts` with R2 half set) — they exit 2 with the reason; `packs-status --print-compat --parts` prints `f2.0-…`
      and without `--parts` `f1.1-…`.
- [ ] **Step 2:** A local `--parts --no-upload` run of the fixture is not possible from the CLI (Door43 is real there):
      instead `bun test` in resource-pipeline — PASS; `actionlint .github/workflows/language-packs.yml` — clean.
- [ ] **Step 3:** Read the workflow once more for the whole path: a dispatch without `parts` behaves exactly as before
      (same steps, same arguments, the f1.1 status).
- [ ] **Step 4: Commit** `Packs CLI and workflow: publish parts to staging, with their own status`.

### Task 11: the parts runs on the runner

Needs Tasks 1–10 merged to `master` (the `packs-staging` Environment accepts only `master`) and Abel's yes for each
publish.

- [ ] **Step 1: es-419, compare** — `language-packs.yml` with `language: es-419`, `mode: no-upload`, `parts: true`,
      `compare: true`. Expected: no difference, as in run 39949734159; `treeChecks.mismatch` 0. Record the step
      summary's sizes, downloads and time in the ledger.
- [ ] **Step 2: English, sizes** — `language: en`, `mode: no-upload`, `parts: true`. Expected: about 975 s and
      2.1 GB as before (plus the downloads); `treeChecks.mismatch` 0 (any mismatch: stop and look at the paths before
      anything is published). Record the `sizes` table.
- [ ] **Step 3: Bucket counts (Abel decides)** — from English's `tw:kt`, `tw:names`, `tw:other`, `ta:translate`:
      choose counts that put a typical part near 250 KB (§1); per-folder counts for TW are allowed if the folders
      differ a lot. If any count changes: change it in `partSlots.ts`, bump `PARTS_FORMAT_VERSION` (2.0.0 → 2.1.0),
      refresh `sample-output.json`, and repeat Step 1 before Step 4.
- [ ] **Step 4: es-419 to staging, with Abel's yes** — `mode: publish`, `target: staging`, `parts: true`. Expected:
      `published`; the staging bucket has `parts/…`, `catalog/<f2.0…>/es-419.json`, `originals.json`,
      `originals/<sha>.json` and `status/<f2.0…>/es-419.json` = ok; the f1.1 entry and status of es-419 unchanged.
- [ ] **Step 5: es-419 again** — the same dispatch. Expected: `unchanged`, every unit carried, nothing put: the
      fingerprints recomputed from a fresh download equal the published ones.
- [ ] **Step 6: English to staging, with Abel's yes** — only after Step 3 is settled. Then once more, expected
      `unchanged`.
- [ ] **Step 7:** Record every run (id, outcome, units built/carried, parts put, peak, time) in the ledger.

### Task 12: the Worker's rules, written down

**Files:**

- Modify (translation-helps-mcp, a docs branch, not pushed without Abel):
  `docs/superpowers/specs/2026-10-21-language-packs-parts-design.md`

- [ ] **Step 1:** §2: the exact fingerprint rules (paths, blob sha, the manifest normalization, the input table, unit
      ids, the stable JSON, `FINGERPRINT_VERSION`) and Task 1's golden vectors, so delivery 3's Worker port can be
      tested against the same values; the bucket hash inputs (`fnv1a32` of `kt/god.md`, of the TA article directory).
- [ ] **Step 2:** §3: `fingerprint` on parts, `units` on the language list, the content-addressed originals list;
      the open point on bucket counts closed with Task 11's numbers.
- [ ] **Step 3: Commit** `Spec: the fingerprint rules and the lists as 2b-2 built them`.
