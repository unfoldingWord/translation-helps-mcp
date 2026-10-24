# Language packs in parts: build only what changed, download only what changed

Date: 2026-10-21. Status: approved by Abel (2026-10-22). Builds on `2026-10-20-language-packs-online-design.md` (plan 2, merged
into `v2` as #69–#72) and changes its pack format, its build and its update rule.

Updated 2026-10-24: §1 (groups), §2 (the exact fingerprint rules), §3 (the lists), §4 step 6 and the open points, as
plan 2b-2 built them (tc-study `feat/packs-publish-parts`, 9a6ed26), for delivery 3's Worker to port.

## Why

A language pack today is one zip per language, rebuilt whole whenever any resource has a newer Door43 release.
Four things follow, all measured on 2026-10-21:

- **Releases rarely change most of what they release.** unfoldingWord releases every English resource together, and
  the manifest version is bumped in each. Between v90 and v91 (git trees on Door43, blob by blob):

  | Resource | Files | Changed in v90 → v91  |
  | -------- | ----- | --------------------- |
  | en_ta    | 739   | `manifest.yaml` only  |
  | en_tw    | 961   | 2 articles + manifest |
  | en_twl   | 62    | 3 books + manifest    |
  | en_tq    | 65    | 8 books + manifest    |
  | en_ult   | 68    | 23 books              |
  | en_ust   | 67    | 28 books              |
  | en_tn    | 67    | 51 books + manifest   |

  The current rule (a stamp `tag#published_at` per resource) rebuilds everything anyway.

- **The release is also inside the derived keys.** Quote and alignment rows are keyed
  `helps-quote:{helps}@{stamp}:{ol}@{stamp}:{book}:{ch}`, so a release with identical content invalidates them all.
- **English does not fit in memory.** The build keeps the whole language in `fake-indexeddb` in memory until it packs.
  A local `--no-upload` run of `en` was killed by Windows at 25 minutes, a third of the way through its 22,569 jobs,
  with 7.7 GB committed. Extrapolated, it passes Cloudflare Containers' 12 GiB and likely a 16 GB GitHub runner.
- **Phones would download everything again.** The pack holds one JSONL blob per resource and layer, every book
  together; the zip is not deterministic (`createdAt`, entry dates, row timestamps), so even an identical rebuild has a
  new sha256. For teams on expensive or poor connections this is the cost that matters most.

Sizes, from the es-419 pack (6 books, gzip): lexicons UHL 2.1 MB and UGL 1.6 MB, TW 1.8 MB, TA 1.2 MB, literal text
0.7 MB, simple text 0.4 MB, TN 0.38 MB, TWL 0.09 MB, TQ 0.02 MB; whole pack 10 MB, plus the originals pack (UHB, UGNT,
MACULA) 23 MB. Shared resources dominate the first download; a book's own helps and texts are 100–300 KB.

## Decisions taken (Abel, 2026-10-21)

- **Build only what changed, download only what changed**, and decide by content, not by release number.
- **The first build of a language downloads each resource's zip;** later builds fetch only the files that changed.
- **What may go into a pack:** resources with the Door43 topic `tc-ready` (stage `prod`), with three exceptions:
  MACULA (from Taller), the Greek and Hebrew lexicons, and OBS's own helps (obs-tn, obs-tq, obs-twl, obs-sn, obs-sq),
  which the Read page also finds without the topic. TW and TA always need `tc-ready`, also when OBS asks for them.
  Today the OBS helps search lets any TW in, which put the unmaintained fork `es-419_obt/es-419_tw` and
  `WycliffeAssociates/en_tw` (both without the topic) into packs.
- **English lexicons come from `test_org`**, as translationCore takes them. The build takes them from the literal
  text's owner today, so it needs an owner option, and it needs a reader for translationCore's layout:
  - `test_org/en_uhl` (identical to `unfoldingWord/en_uhl`): 8,674 entries at `resources/en/lexicons/uhl/v0/content/*.json`;
  - `test_org/en_ugl`: 5,408 entries at `ugl/v0/content/*.json`, each with only `brief` and `long` (last changed 2021);
  - the build reads `content/*.json` at the repository root (the es-419 layout, with lemma, Strong, part of speech and
    senses), so it finds none of them today.

  The reader stores each entry unchanged at `{key}/content/{number}.json`, where Servos reads it; Servos already shows
  a plain lexicon file (`brief` and `long`, no `entries`; `servos/src/lexicon/lexicon.ts`). English Words will show less than Spanish until a
  richer English lexicon exists; `unfoldingWord/en_ugl` is Markdown source (`content/G48620/01.md`), and converting it
  is a separate project.

- **In Servos the project's book is downloaded when the project is created;** "the whole language" is an option in
  settings, with its size shown. Related books are not computed: texts are cheap enough to take whole when asked.
- **Updates download by themselves on fast Wi-Fi;** on mobile data, a slow connection or with data saver on, Servos
  shows the size and the expected time and asks. Speed is measured from recent downloads; where the browser cannot
  tell Wi-Fi from mobile data (iOS Safari) it asks.
- **No daily builds.** es-419 and en are treated like every other language.

## 1. Parts

A pack becomes a list of parts. A part is the unit that is built, stored, downloaded and replaced as a whole.

| Part                      | Contains (layers)                                                       | Inputs (its fingerprint)                                        |
| ------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| text · book               | a literal or simple text's book: sot, prepared                          | the book's USFM + the resource's normalized manifest            |
| original · book           | UHB or UGNT book: sot, prepared                                         | the book's USFM + manifest                                      |
| MACULA · book             | the book's trees and referents                                          | the book's files in Taller's `public/trees`, `public/referents` |
| helps · book              | TN, TQ or TWL for a book: sot, prepared (light, full), quote            | the book's TSV + the original's book USFM + manifest            |
| helps · book · alignments | TN or TWL for a book aligned to the literal and simple texts            | the book's TSV + the original's, literal and simple book USFM   |
| TW · group                | TW articles of one folder (`kt`, `names`, `other`): sot, prepared       | those articles + manifest                                       |
| TA · group                | TA articles of one manual (`translate`, `checking`, `process`, `intro`) | those articles + manifest                                       |
| TW titles, TA titles      | each article's title, as the `text` layer has it today                  | TW: each article's first line; TA: each `title.md`              |
| lexicon · group           | a lexicon in a few slices by entry range                                | those entry files                                               |
| OBS parts                 | `obs` and its helps, by story range                                     | the stories' files + manifest                                   |

Every fingerprint also includes the versions of the code that computes its layers, so a builder change rebuilds the
parts it affects. As built (2026-10-24) that is one `code` string for every part (§2), so a change to any row-producing
code rebuilds everything; unchanged bytes keep their sha256 and are not downloaded again. The exact inputs of each kind
are in §2; the table above is the outline.

**Why alignments are their own part:** when only the literal text of Ruth changes, the notes of Ruth and their quotes
stay; only where they fall in the literal text changes. The phone downloads a few KB of alignments, not the notes.

**Why titles are their own part:** today TA and TW titles come from the whole TA and TW. As parts they are about
5 KB (TA) and 20 KB (TW), and a corrected title changes only them. A note is joined with its title when shown.

**Groups never move an item.** If groups were cut by size or alphabetically, one new article would shift every later
boundary, every later part would get a new sha256 and phones would download them all again. So each item's group is a
fixed function of its name or number:

- TW: folder (`kt`, `names`, `other`) × a bucket from a hash of the article's file name, among a fixed number of
  buckets (8 to start);
- TA: by manual; `translate`, the largest, also in hash buckets (4 to start), by the article's directory name;
- lexicons: by Strong number range, a thousand at a time (G1–G999, G1000–G1999…); Strong numbers never move;
- OBS: ten stories at a time.

The exact hash inputs are in §2 ("Groups").

The aim is about 250 KB a part. The bucket counts are set from the English sizes run, and changing one moves items.
As built (2026-10-24) they are not a segment of the compat key (the Worker's `COMPAT_RE`, the workflow and
`packs-status` would reject a new segment): they are guarded by `PARTS_FORMAT_VERSION`, which the compat key starts
with. tc-study's sample-output check fails when a count changes without a format bump.

## 2. Fingerprints and when to build

1. **Releases.** One Door43 catalog search (`topic=tc-ready&stage=prod`, plus the OBS helps searches) gives each
   resource's latest release. MACULA and lexicons have no releases: their latest commit is read. If no tag and no
   commit moved, nothing else happens.
2. **Trees.** For each moved resource, `GET /api/v1/repos/{owner}/{repo}/git/trees/{tag}?recursive=true&per_page=10000`
   gives every file with its blob sha (en_tw: 966 entries in one request). Files are mapped to parts by path
   (`08-RUT.usfm`, `tn_RUT.tsv`, `bible/kt/*.md`, `translate/<article>/title.md`). Large repositories come back
   `truncated` (`unfoldingWord/en_ugl`, over 9,000 files, does): those are read page by page, with that repository as
   a test fixture. If a tree cannot be read whole, the resource counts as changed: rebuilding too much is safe,
   missing a change is not.
   **A file's hash is its git blob sha**, which is computed from the file's bytes (`sha1("blob <size>\0" + bytes)`).
   The Worker reads it from the tree without downloading anything; the build and tc-study's app compute the same value
   from the bytes they already hold. All three reach the same fingerprint independently.
   The build hashes the bytes it builds from and checks them against Door43's tree at the same ref (2026-10-24): a
   path or a sha that differs (an `export-ignore`d file, an `export-subst` or `eol` rewrite in `.gitattributes`) is a
   failure and nothing is published; a tree that cannot be read whole is `unverified`, counted in the report.
3. **The manifest, normalized.** It says which books a resource has, its title and direction, so it is not ignored:
   its fingerprint is taken without `dublin_core.version`, `modified`, `issued` and the version numbers in `relation`.
   A version bump alone does not change it. The exact rule is below.
4. **Fingerprints** (2026-10-24): every part and every unit of work (`shared`, `book <b>`) has one: the sha256 of
   its input files with their blob shas, the normalized manifests, the release stamps its rows carry, its id and the
   list's `code`. The build decides per unit; a part's own fingerprint is for 2c's views and the Worker.
5. **Decide.** The new fingerprints are compared with those in the published list (its `units`):
   - none changed: no build. The list is rewritten with the new release tags only (so apps show the right version and
     credit); phones download that list and nothing else (but see the open points: the list's catalog rows carry
     `bookBlobsRef`, which is the tag);
   - some changed: a build is asked for;
   - a new book or a removed one adds or drops its parts.
6. **The build does not trust the asker.** It recomputes every fingerprint itself and builds what does not match.
7. **When it runs:** the Worker checks when a language is requested (at most hourly per language, as now), and a
   daily sweep runs step 1 for every published language. `DAILY_LANGUAGES` and its unconditional daily builds go.

### The exact rules (2026-10-24)

What tc-study's code does, for delivery 3's Worker to port. The reference is tc-study
`packages/language-pack/src/parts/{fingerprint,partInputs,partSlots}.ts` (pure, Web Crypto only: the Worker can copy
them as they are, JavaScript regular expressions included) and `packages/resource-pipeline/src/language/`
`{inputFiles,buildLanguageParts,partsCode}.ts`. The golden vectors at the end are what a port must reproduce.

**Which resources.** The same as tc-study's discovery:

- the language's resources: the catalog search `topic=tc-ready&stage=prod` (texts and helps), plus OBS's own helps
  (subjects matching `\bOBS\b`) without the topic; a hit without a release, or whose subject has no type below, is left
  out. OBS is off by default: then every row whose subject matches `/OBS|Open Bible Stories/i` is left out;
- the originals `unfoldingWord/hbo/uhb` and `unfoldingWord/el-x-koine/ugnt`, the latest `stage=prod` release of each;
- the lexicons `{owner}/{language}_uhl` and `_ugl` at the commit `master` names, owner `test_org` for `en`, else the
  owner of the literal text (the Aligned Bible whose id ends in `lt`); a repository Door43 lacks (404) is no lexicon;
- MACULA from Taller (`github.com/idiomaspuentes/taller`), at the MACULA commit: the latest commit that touches
  `public/trees` or `public/referents` (`git log -1 -- public/trees public/referents`).

The lexicons' and MACULA's commits are in no fingerprint: a commit that changes none of their files changes nothing
(their catalog rows in the list still move with the next build).

A key is `{owner}/{language}/{id}`, the id being the repository name without `{language}_`; lexicons
`{owner}/{language}/uhl`, MACULA `Biblica/hbo/macula` and `Biblica/el-x-koine/macula`. A release's ref is
`release.tag_name`. A resource with no release zip, a zip that does not come or cannot be read, or a TW/TA whose catalog
ingredients differ from its zip's is a build failure, and a build with any failure is not published: every resource a
published list names is in its fingerprints.

The type comes from the Door43 subject, by exact match (tc-study's resource types):

| Subject                                                                               | Type                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `Bible`, `Aligned Bible`, `Greek New Testament`, `Hebrew Old Testament`               | `scripture`                                       |
| `TSV Translation Notes` · `TSV Translation Questions` · `TSV Translation Words Links` | `notes` · `questions` · `words-links`             |
| `Translation Words` · `Translation Academy` · `Open Bible Stories`                    | `words` · `academy` · `obs`                       |
| `(TSV) OBS Translation Notes` · `… Questions` · `… Words Links`                       | `obs-notes` · `obs-questions` · `obs-words-links` |
| (lexicons, MACULA: set by the build)                                                  | `lexicon`, `original-syntax`                      |

The family decides which rules apply (`familyOf`, the first that matches; id = the key's last segment):

| Family   | When                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| original | the key is UHB's or UGNT's                                                                                              |
| macula   | type `original-syntax`, or id `macula`                                                                                  |
| obs      | type starting with `obs`, id starting with `obs` or ending in `-obs`, or subject matching `\bOBS\b\|Open Bible Stories` |
| book     | type `scripture`, `notes`, `questions`, `words-links`, or one of their seven subjects above                             |
| tw · ta  | type `words` · `academy`, id `tw` · `ta`, or subject `Translation Words` · `Translation Academy`                        |
| lexicon  | type `lexicon`, or id `uhl` · `ugl`                                                                                     |

A **text** is a resource of type `scripture` or with one of the four scripture subjects; a book part of a resource that
is not a text (TN, TQ, TWL) quotes the original.

**Files.** A resource's files at its ref, as `path → git blob sha`:

- path: repository-relative, `/`-separated, no `./`, no zip top folder (`es-419_tn/tn_RUT.tsv` → `tn_RUT.tsv`). From a
  Door43 tree: every entry of type `blob` (symlinks included: the zip stores their target, which is their blob;
  submodules are no blob). From a zip: every entry that is not a directory, the one top folder taken off (a zip
  without exactly one is refused);
- sha: `sha1("blob " + <byte length> + "\0" + <bytes>)`, lowercase hex, of the exact bytes (CRLF, BOM and all);
- `manifest.yaml` (at the root) is never a file input: only its normalized sha256 is;
- lexicons: only the files that make rows, keyed by row path (`lexiconRowPath`): `content/<f>.json` or
  `domains/<f>.json` at the root, or the same from under a `…/v0/` folder
  (`resources/en/lexicons/uhl/v0/content/1.json` → `content/1.json`). Two files with one row path: the last one wins, as in the store (archive order, which is git's
  tree order; a difference shows as a tree mismatch). The manifest is the root's `manifest.yaml` only;
- MACULA: in Taller's git tree at the MACULA commit, the regular files (mode `100…`, no symlinks) directly in
  `public/trees` and `public/referents` whose name without `.json` matches `^[1-3A-Z]{3}$`, keyed `trees/RUT.json`,
  `referents/RUT.json`; split by book (`maculaKeyOf`): the 27 New Testament books to the Greek key, the rest to the
  Hebrew. No manifest. The build checks its folder against `git ls-tree` at that commit.

**A resource's books** (book-scoped resources and originals): its catalog ingredients minus those absent from the
release. An ingredient is present when it has no path, or when its path without `./` equals, or is the end of, a file
path or a file's base name (`ingredientPresentInPathSet`, loose on purpose, as the loaders find a file by the end of its
path; the build tests the zip's entry names, top folder included). `books[b]` = that path, b the identifier in
lowercase. A book whose path is not exactly one of the files (found only by the loose match, as `./RUT.tsv` finds
`tn_RUT.tsv`) has no blob, so its quote and alignment keys carry the release stamp: then the release stamp is an input
wherever its file would be (the "release-stamped" books of the report). Units: one per book of any book-scoped resource
or original, the canon in order, then the others (`frt`…) sorted.

**The release stamp** (`resourceContentStamp` of the catalog row): `<tag>#<published_at>`, tag = `release.tag_name`
or else `version`, each trimmed and with `:`, `|`, `@` turned to `_` (`v91#2026-10-01T12_00_00Z`); one of the two alone
when the other is empty; `nostamp` when both are.

**The normalized manifest** (`normalizeManifest`), on the text as UTF-8 decoding gives it (`TextDecoder` or
`Response.text()`: a leading BOM removed, invalid bytes as U+FFFD):

1. CRLF → LF, split on LF, trailing spaces and tabs dropped from every line.
2. Exactly one line starts with `dublin_core:`, and it is `dublin_core:` alone (a ` # comment` may follow). Its block
   is the lines after it that are blank, a comment (`^ *#`) or start with a space or a tab.
3. No line of the block is indented with a tab. The key indent is that of the block's first line that is neither blank
   nor a comment; no such line is indented less; each one at the key indent is a key (`^[A-Za-z_][\w-]*:( +.*)?$`,
   its value taken without a trailing ` #…`) or an item `- …`, which belongs to the key before it. Nothing but blanks
   and comments before the first key.
4. `version`, `modified`, `issued` (keys at that indent only): the key's line is dropped, its blank and comment lines
   kept, when its value is one line: not empty, not starting with `|`, `>`, `[`, `{`, `&`, `*` or `!`, and nothing
   under it but blanks and comments.
5. `relation`: an inline value is kept if it holds no `?v=`. As a block, every line under it is blank, a comment or an
   item `- <value>`, the value being a whole `'…'` or `"…"` scalar, or a plain one (not empty, not starting with a
   quote, `|`, `>`, `[`, `{`, `&`, `*` or `!`, no `: ` and no final `:`). In each item `?v=` and all that follows it in
   the value is removed: `'hbo/uhb?v=2.1.30'` → `'hbo/uhb'`, `en/tn?x=1?v=2` → `en/tn?x=1`; a plain item's
   ` # comment` after `?v=` goes with it.
6. Every other line (other keys, deeper lines, other sections) is kept; the lines are joined with LF.

Anything else (the steps' "exactly", "no", "every" failing) is an **unexpected shape: the original text, unchanged**,
not even CRLF turned to LF: a rebuild too many, never a missed change. With JavaScript's regular expressions `.` stops
at CR, U+2028 and U+2029, so a key line or a relation item holding a lone CR is an unexpected shape; elsewhere a lone CR
stays in its line and is hashed. A BOM that reaches the rule (text decoded without stripping it) hides a first-line
`dublin_core:`: unexpected shape. `manifestFingerprint` is the sha256 (hex) of the result's UTF-8.

**Inputs of a part.** R is the part's resource, b its book, O the original of b (`resolveOriginalLanguageKey`: UGNT for
the 27 New Testament books, UHB for every other; none if the build has no such resource). "X's file for b" is the file
at `books[b]`; if b is release-stamped for X, X's release stamp instead; nothing if X has no b. Every part reads its
resource's manifest (MACULA has none) and the manifest of every resource whose file for b it reads (O's even when O
lacks b).

| Kind (id)                              | Files                                                                                              | Stamps                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `book:R:b`, R a text                   | R's file for b                                                                                     | if release-stamped                               |
| `book:R:b`, R not a text (TN, TQ, TWL) | R's and O's file for b                                                                             | if release-stamped                               |
| `alignments:R:b`                       | R's and O's file for b, and the file for b of every text other than the originals that has b       | if release-stamped                               |
| `original:R:b`                         | R's file for b                                                                                     | if release-stamped                               |
| `macula:R:b`                           | `trees/<B>.json`, `referents/<B>.json` (B = b in capitals)                                         | —                                                |
| `tw:R:<folder>:<n>`                    | every `bible/<folder>/….md` of that group                                                          | —                                                |
| `ta:R:translate:<n>`, `ta:R:<manual>`  | every file `<manual>/<article>/…` of that group, and the manual's own files (`translate/toc.yaml`) | —                                                |
| `titles:R` (TW and TA)                 | every file of R                                                                                    | R's (their `helps-text:…@{stamp}` keys carry it) |
| `lexicon:R:<group>`                    | the row files of that group                                                                        | —                                                |
| `obs:R:<range>`                        | every file of R                                                                                    | —                                                |

And every part of R reads R's **unmapped files**, those no rule above gives to particular parts: for book-scoped
resources and originals every file that is not one of `books`' paths (README, LICENSE, `media.yaml`, front matter not
in the ingredients, a whole `_old/` folder); for TW every file but `bible/{kt,names,other}/….md`; for TA the files of
one segment and those outside the four manuals; for MACULA a selected file named without `.json`; none for lexicons and
OBS. O's unmapped files count only for O's own parts.

**Inputs of a unit.**

- `book <b>`: for each resource the unit builds (each language resource whose books have b, and O if its books have
  b): its unmapped files, its file for b and its manifest; and O's file for b and manifest in any case.
- `shared`: for each shared resource (the language's resources that are not book-scoped: TW, TA, and OBS when on;
  the lexicons; each MACULA key that has files): every file and its manifest; and TW's and TA's release stamps.

A part's inputs must be within its unit's; the build throws otherwise. MACULA, though sliced by book, is in the shared
unit.

**The fingerprint** (`fingerprintOf`):

```
sha256hex(utf8(stableJson({ v: FINGERPRINT_VERSION, code, id, files, manifests, stamps })))
```

- `files`: `[resource key, path, blob sha]`; `manifests`: `[resource key, manifestFingerprint]`; `stamps`:
  `[resource key, release stamp]`. Each list deduplicated and sorted element by element (UTF-16 code units, as
  JavaScript's `<`; a shorter tuple first on a tie).
- `stableJson`: object keys sorted by code units at every depth, members whose value is `undefined` left out, no
  spaces, strings and numbers as `JSON.stringify` writes them.
- `id`: a part's slot id, `kind:resource[:book][:group]` (`book:test_gl/es-419/tn:rut`, `tw:unfoldingWord/en/tw:kt:6`,
  `ta:…:translate:3`, `ta:…:checking`, `titles:…`, `lexicon:…:1`, `macula:Biblica/hbo/macula:rut`, `obs:…:1-10`), so
  two parts with the same files still differ; a unit's id, `shared` or `book <b>` (`book rut`, `book frt`).
- `FINGERPRINT_VERSION = 1`. A change to any rule here bumps it, and the sample-output check then asks for a
  `PARTS_FORMAT_VERSION` bump too.
- `code` (Decision 12 of plan 2b-2, amended after its first review): the parts compat key, `+`, and the first 16 hex
  of `sha256(stableJson(partsCodeVersions()))`; today `f2.0-u2.3.0-p6000230-q9-a12-t1+7bc31e739fbeed69`.
  `partsCodeVersions()` holds every row-producing version constant by name (the USJ processing and tool versions, the
  TSV parsers, the TW/TA/OBS/lexicon/MACULA rows, every preparer, the markdown pipeline, quotes, alignments, titles,
  the helps ingest schema), the installed version of every third-party package on the row path and of everything it
  depends on (`npm <name>`), and a sample of the stamp formats. Both lists carry it (`PartsList.code`). **The Worker
  reads `code` from the published language list and never recomputes it**: it cannot know the build machine's
  versions. A build reuses no previous list of another `code` (everything is rebuilt; unchanged bytes keep their
  sha256). So a new builder version is invisible to the Worker until a build is asked for by other means.

**Groups** (the bucket hash inputs). `fnv1a32` is 32-bit FNV-1a over the text's UTF-8 bytes (offset `0x811c9dc5`, prime
`0x01000193`, unsigned).

| Kind    | From                                                                                             | Group                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| TW      | `bible/<folder>/<name>.md`, or the row id `bible/<folder>/<name>`; folder `kt`, `names`, `other` | `<folder>:<fnv1a32("<folder>/<name>.md") % 8>`: `bible/` left out, `.md` kept                                         |
| TA      | `<manual>/<article>[/…]`; manual `translate`, `checking`, `process`, `intro`                     | `translate:<fnv1a32("<article>") % 4>` (the directory name alone); else `<manual>`                                    |
| lexicon | a row path                                                                                       | `domains/…` → `domains`; `content/<non-digits><digits><no slash>` → `floor(<digits> / 1000)` in decimal; else `other` |
| OBS     | a row's story n                                                                                  | `<lo>-<lo + 9>`, lo = `floor((n − 1) / 10) × 10 + 1`; rows of no story → `index`                                      |

Counts: `TW_BUCKETS = 8`, `TA_TRANSLATE_BUCKETS = 4`, `LEXICON_RANGE = 1000`, `OBS_STORIES_PER_PART = 10`; the TW and
TA counts are pending the English sizes run (plan 2b-2, Task 11 Step 3).

**Golden vectors** (tc-study's tests, `fingerprint.test.ts`, `partSlots.test.ts`; checked with `git hash-object` and
`sha256sum`):

| Input                                                             | Value                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| blob of `hello\n`                                                 | `ce013625030ba8dba906f756967f9e9ca394464a`                                                           |
| blob of no bytes                                                  | `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`                                                           |
| blob of `וַיְהִי` (UTF-8)                                         | `a4421f7588b769770e69f34b9baef03e686008d3`                                                           |
| blob of `# Noemí\r\n\r\nSuegra de Rut.\r\n`                       | `bbd12cda1a558ce7e534075dd878f89967d28c57`                                                           |
| blob of bytes `00 ff 01` + `binary`                               | `1fb4642e1f5eed2ca814167bb3a2e0ddabe08fb2`                                                           |
| `manifestFingerprint("dublin_core:\n  title: x\n  version: 3\n")` | `2acd14c15af65b9062bf6a32dba51ec43828f8a7e835d4b473a73d46d4b86f85` (of `dublin_core:\n  title: x\n`) |
| `fnv1a32` of empty, `a`, `foobar`                                 | `0x811c9dc5`, `0xe40c292c`, `0xbf9cf968`                                                             |
| `fnv1a32("kt/god.md")` → group of `bible/kt/god.md`               | `0xd9c9135e` → `kt:6`                                                                                |
| `fnv1a32("figs-idiom")` → group of `translate/figs-idiom/01.md`   | `0xe31513cb` → `translate:3`                                                                         |

The golden fingerprint: code `f2.0-u2.3.0-p6000230-q9-a12-t1`, id `book:test_gl/es-419/tn:rut`, files
`[test_gl/es-419/tn, tn_RUT.tsv, ce0136…]` and `[unfoldingWord/hbo/uhb, 08-RUT.usfm, e69de2…]`, manifest
`[test_gl/es-419/tn, 2acd14…]`, no stamps. Its stable JSON and fingerprint:

```
{"code":"f2.0-u2.3.0-p6000230-q9-a12-t1","files":[["test_gl/es-419/tn","tn_RUT.tsv","ce013625030ba8dba906f756967f9e9ca394464a"],["unfoldingWord/hbo/uhb","08-RUT.usfm","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"]],"id":"book:test_gl/es-419/tn:rut","manifests":[["test_gl/es-419/tn","2acd14c15af65b9062bf6a32dba51ec43828f8a7e835d4b473a73d46d4b86f85"]],"stamps":[],"v":1}
→ 4234512231f52e21faca28991e5de566823401099ea2fd839f3bb7df64694723
```

A worked example of the input rules (the small context of `sampleOutput.test.ts`, `inputsGolden`; blob shas there are
`n` as 40 hex digits, written `#n`): TN with `tn_RUT.tsv #1`, `tn_JON.tsv #2`, `README.md #3`, `manifest.yaml #4`; GLT
with `08-RUT.usfm #5`, `LICENSE.md #6`; UHB with `08-RUT.usfm #7`; TW with `bible/kt/god.md #8`, `bible/kt/faith.md #9`,
`bible/config.yaml #10`; TA with `translate/toc.yaml #11`, `translate/figs-idiom/01.md #12`, `…/title.md #13`,
`checking/acceptable/01.md #14`; UHL with `content/H1961.json #15`, `domains/12.json #16`; MACULA (Hebrew) with
`trees/RUT.json #17`, `referents/RUT.json #18`, `trees/TIT.json #19`; OBS with `content/01.md #20`:

| Part or unit                        | Files                       | Manifests        | Stamps |
| ----------------------------------- | --------------------------- | ---------------- | ------ |
| `book:…/tn:rut`                     | TN #1 #3, UHB #7            | TN, UHB          |        |
| `alignments:…/tn:rut`               | TN #1 #3, UHB #7, GLT #5    | TN, UHB, GLT     |        |
| `book:…/glt:rut`                    | GLT #5 #6                   | GLT              |        |
| `original:…/uhb:rut`                | UHB #7                      | UHB              |        |
| `macula:…:rut`                      | #17 #18                     |                  |        |
| `tw:…:kt:6`                         | #8 #10                      | TW               |        |
| `ta:…:translate:3`                  | #11 #12 #13                 | TA               |        |
| `titles:…/tw`                       | #8 #9 #10                   | TW               | TW     |
| `lexicon:…/uhl:1`                   | #15                         | UHL              |        |
| `obs:…:1-10`                        | #20                         | OBS              |        |
| `book rut` (TN, GLT, UHB)           | TN #1 #3, GLT #5 #6, UHB #7 | TN, GLT, UHB     |        |
| `shared` (TW, TA, UHL, MACULA, OBS) | #8–#20, every file of each  | TW, TA, UHL, OBS | TW, TA |

**For the Worker** (delivery 3): per check it needs each resource's tree at its tag, the text of each resource's
`manifest.yaml` at its tag (the list records no manifest hash, so it is fetched, one small request per resource), the
catalog rows (ingredients, subject, release), each lexicon's commit at `master` and its tree, and Taller's GitHub tree
at the MACULA commit. It computes the unit fingerprints with the list's `code` and compares them with the list's
`units`.

## 3. Format and storage

**Parts in R2:** `parts/<sha256>.part.gz`, immutable, addressed by content. Inside, JSONL rows
`{"layer", "key", "value"}`, gzip. Deterministic: rows sorted by layer (`sot`, `prepared`, `quote`, `align`,
`text`), then by key, no dates in the rows (the `timestamp` and `expiresAt` of quote and alignment rows are set by the
importing app), gzip without a name or mtime. The same content always has the same sha256, so an unchanged part is
never uploaded or downloaded again, and identical parts are shared between languages: originals and MACULA by book,
English lexicons for every language that uses them.

**Derived keys lose the release.** Quote and alignment keys name what they were computed from by fingerprint instead
of by release stamp, so identical content keeps its keys. tc-study's app shares that code and adopts the same keys,
with no parameter keeping the old ones: the app gains the same thing (a release with unchanged content costs it no
recomputation), and two key schemes in one code path would double what has to be tested.

**The list:** `catalog/<compat>/<language>.json` (schema 2), no-cache, written last. As built (2026-10-24):

- `schema: 2`, `language`, `compat`, `code` (§2: the code its fingerprints were made with), `versions` (the compat
  key's versions);
- `resources`: `key`, `stamp` (the release stamp, for display and credit), `role` (`language`, or `original` in the
  originals list), `subject`, `title`, `books` (book-scoped resources: the books that have source rows), `metadata`
  (the catalog row, `bookBlobs` and `bookBlobsRef` included, without the catalog's bookkeeping: the volatile dates,
  `updatedAt`, `accessedAt`, `accessCount`, `downloadedAt`, `lastDownload`, `downloadStats`, `downloadedIngredients`
  and `availability`, which says whether the build machine has it and would make a carried build's list differ). An
  importer puts back `catalogedAt` (the import time) and `availability` (`online`, nothing offline yet:
  `restoreCatalogBookkeeping`), and sets `offline` once the parts are in;
- `parts`: `sha256`, `bytes`, `rows`, `kind` (`book`, `alignments`, `original`, `macula`, `tw`, `ta`, `titles`,
  `lexicon`, `obs`), `resource`, `book` (lowercase) and `group` when it has them, `fingerprint` (§2), `layers`;
- `units` (the language list only): `{ id, fingerprint }` of every unit built or carried, `shared` and `book <b>`,
  which the next build and the Worker compare;
- `originals`: `{ path, sha256 }` of the originals list this language's quote and alignment rows were made against,
  at its content address `catalog/<compat>/originals/<sha256>.json`, sha256 being that of its text. Another
  language's run cannot overwrite it.

The originals list is a list of the same shape with `language: "originals"`, the `original` and `macula` parts and no
`units`. Each run writes it at its content address and as `catalog/<compat>/originals.json`, the latest (last writer
wins between languages); a reader takes the one the language list names, and a build reuses a previous list only when
its `originals.path` is that address and the list there has that sha256.

Both lists are stable JSON (§2): parts sorted by kind, resource, book, group, their layers in the order `sot`,
`prepared`, `quote`, `align`, `text`; resources by key, their books sorted; units by id. A run whose language list
comes out byte-identical to the published one is `unchanged`.

**Writes, in this order** (2026-10-24, `publishLanguageParts`); a build with any failure, or whose originals list lacks
UHB, UGNT or MACULA parts, or whose language has no aligned literal text, writes nothing:

| Key                                                   | Content type       | Cache-Control                         | Written                                                                                |
| ----------------------------------------------------- | ------------------ | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `parts/<sha256>.part.gz` (every part both lists name) | `application/gzip` | `public, max-age=31536000, immutable` | when the bucket lacks it (asked first); no `Content-Encoding`                          |
| `catalog/<compat>/originals/<sha256>.json`            | `application/json` | `public, max-age=31536000, immutable` | when the language list changed and the bucket lacks it                                 |
| `catalog/<compat>/originals.json`                     | `application/json` | `no-cache`                            | when the language list changed and names other originals than the previous one (below) |
| `catalog/<compat>/<language>.json`                    | `application/json` | `no-cache`                            | last, when it changed, once every part both lists name is known to be in the bucket    |

`originals.json` is also written when no previous list was read or the bucket lacks it, and left alone when this
language's originals did not change: another language may have written newer ones since. Until the language list is
written the bucket names the previous build, whose parts nothing deletes (cleanup is delivery 3). Parts are gzip from
pako 2.1.0 at level 9 with mtime 0 and OS byte 255, so Bun and Node, Linux and Windows give the same bytes.

**New compat key `f2.0-…`.** Lists in the `f1.1` format stay until every app has moved.

**Cleanup:** a part no current list names is deleted after 30 days, so nothing a phone is downloading disappears.

**Requests:** the full English language is about 700 parts (66 books × ~10 kinds, plus shared). With 4 downloads at a
time that is under a minute of round trips on a normal connection, but more than the Worker's current 90 requests a
minute per IP: part requests get their own limit (about 600 a minute) and `Cache-Control: immutable`, so Cloudflare's
cache answers repeats. Many small parts also resume better than one large zip on a poor connection.

## 4. The build, one part at a time

The same tc-study code as today (loaders, parsers, the warm jobs that compute quotes, alignments and the prepared
layer), so phones get exactly the rows tc-study computes. What changes is the scope of each database:

1. **Plan:** compute fingerprints (§2) and list the parts that differ, in dependency order: texts and originals, then
   quotes, then alignments, then titles, then the MCP views.
2. **Inputs:** with no previous list, download each resource's zip at its tag to disk, once. Otherwise fetch only the
   files the parts to build need, by `GET /api/v1/repos/{owner}/{repo}/raw/{path}?ref={tag}` (to redo Ruth's TN
   alignments: `tn_RUT.tsv`, `08-RUT.usfm` of ULT, UST and UHB, and the manifests).
3. **Per book:** open a fresh database, load only that book's files, run only that book's jobs (English: about 340 of
   the 22,569), extract each part's rows, write them to disk, drop the database. Memory follows the largest book
   (Psalms, Isaiah), not the language.
4. **Shared parts** (TW and TA groups, lexicons, titles) once each, each in its own database.
5. **In parallel:** books are independent; 2–3 at a time within the runner's memory.
6. **Upload:** new parts first (a part R2 already has, by sha256, is skipped), then the originals list at its content
   address and `originals.json`, then the language list last (§3, 2026-10-24).
7. **MCP views** (`v1/<lang>/notes/{BOOK}/{ch}`, `word-links/…`, `questions/…`) are regenerated only for chapters
   whose parts changed. A view's fingerprint is made of its parts' fingerprints; a changed TA title regenerates only
   the views that cite it. No Door43 download is needed for that.

A part whose fingerprint did not change is carried into the new list with the same sha256: not fetched, not computed,
not uploaded.

**Checks:**

- the parts build of es-419 gives exactly the rows of today's whole build (the main test);
- the sample-output check (Ruth 4:5) moves to parts and still fails when output changes under the same compat key;
- each book's peak memory is measured; past a set limit the build fails with a clear message instead of being killed;
- the English measurement is repeated with this build before English is scheduled.

## 5. Servos

- **On project creation** the project's book is downloaded: the shared parts plus every part of that book (texts,
  helps, alignments, original, MACULA). Its size is shown first.
- **In settings,** "Download the whole language", with what is missing ("41 MB left").
- **Checks** on opening, every few hours while open, and when the connection returns: the list is fetched (a `304`
  when unchanged). `202` → "preparing the language", retried later; `404 old-compat` → "update the app".
- **What to download:** Servos keeps a register of slots (resource, kind, book) with the sha256 it holds. Within what
  the user chose, the slots missing or with a different sha256 are downloaded.
- **When:** fast Wi-Fi without data saver → in the background. Otherwise a notice, "An update of 340 KB (about 20 s)",
  with "Download now".
- **How:** 4 parts at a time, originals first; each part's sha256 is checked; parts wait in a staging area, so a cut
  connection resumes where it stopped.
- **Applying:** only when every part of the update is there, and all at once: notes applied before their alignments
  would show new notes marked in old places. Each part replaces its slot's rows.
- **Never touched:** the team's work. Packs carry sources and helps only.
- **What the user sees:** almost nothing. A line in settings, "Resources up to date · literal text v92 · notes v92",
  and the notice when permission is needed; a progress screen only on the first download.

## 6. Deliveries

Each with its own plan and PRs, in this order:

1. **Immediate fixes** (small, before anything is deployed):
   - discovery: the OBS exception covers only OBS's own helps (drops the TW forks);
   - lexicons: an owner option (`test_org` for English) and a reader for translationCore's layout (`brief`/`long`);
   - Worker: drop the unconditional daily builds of es-419 and en; the daily sweep only checks releases;
   - the tc-study commit (`generator`) leaves the build id, so an unrelated commit rebuilds nothing.
2. **Parts and the per-book build** (tc-study, the largest), in three plans:
   - **2a, per-book keys:** derived keys (quote, alignment) stamped per book, not per release (below);
   - **2b, parts and the per-book build:** deterministic parts, the list (schema 2), fingerprints from Door43 trees,
     one database per book, reuse of unchanged parts, the shared originals list, compat `f2.0`; the es-419
     equivalence test, then the English measurement;
   - **2c, MCP views from parts:** only the chapters whose parts changed.

   Decided 2026-10-22, after mapping the code:
   - **A book's stamp is its file's git blob sha.** Door43's tree gives it per file (`tn_RUT.tsv`, `08-RUT.usfm`);
     a download records it in the resource's catalog row (`contentMetadata.bookBlobs`), and packs carry those rows,
     so the build, the Worker, tc-study's app and Servos all derive the same stamp. Without it (an old row, Door43
     down) the release stamp is used, as today.
   - **The receipt moves into the list.** A part names its resource, book and fingerprint; a resource is complete
     when every part the person chose is there.
   - **The per-book build plans only what a resource has**, and counts failures apart instead of hiding them among
     «sin hacer» (the English measurement's 3,002).

   English measured on a GitHub runner on 2026-10-22, with today's whole build: 46:51, 14.9 GB peak of the runner's
   16 GB, a 155.2 MB language pack. It fits, with no margin; parts come before English is published.

3. **Worker and MCP v2:** fingerprint comparison before asking for a build, the parts route with cache and its own
   rate limit, views from parts with fingerprints, cleanup after 30 days.
4. **Servos online** (plan 3, now written for parts): project-book download, "the whole language", updates by
   connection, staging and apply-all-at-once.

**Meanwhile:** the infrastructure steps go on (Admin on tc-study, its Environments, the GitHub App, the Worker's
secrets); parts need them all. Staging with es-419 still tests the whole path. The production backfill of every
language (INFRA step 9) waits for parts: building a hundred languages in `f1.1` only to replace them is waste.

## Open points

- The bucket counts for TW and TA (§1): pending the English sizes run (plan 2b-2, Task 11 Step 3). Today 8 and 4; a
  change bumps `PARTS_FORMAT_VERSION` (a new compat folder).
- For delivery 3 (2026-10-24): §2 step 5's "rewrite the list with the new tags only" cannot be a plain edit of
  `resources[].stamp`: each `metadata` holds `bookBlobsRef`, the tag `bookContentStamp` compares, and with a new tag
  and the old `bookBlobsRef` an app would stamp a book's keys with the release, not its blob. Either a tags-only change
  asks for a build (which carries every unit, downloads the zips and rewrites the rows), or the Worker rewrites the
  catalog rows exactly as the build does.
