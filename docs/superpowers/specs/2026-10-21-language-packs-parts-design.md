# Language packs in parts: build only what changed, download only what changed

Date: 2026-10-21. Status: approved by Abel (2026-10-22). Builds on `2026-10-20-language-packs-online-design.md` (plan 2, merged
into `v2` as #69–#72) and changes its pack format, its build and its update rule.

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

  The reader turns `brief`/`long` into one entry with one sense. English Words will show less than Spanish until a
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

Every fingerprint also includes the versions of the code that computes its layers (the compat key components), so a
builder change rebuilds exactly the parts it affects.

**Why alignments are their own part:** when only the literal text of Ruth changes, the notes of Ruth and their quotes
stay; only where they fall in the literal text changes. The phone downloads a few KB of alignments, not the notes.

**Why titles are their own part:** today TA and TW titles come from the whole TA and TW. As parts they are about
5 KB (TA) and 20 KB (TW), and a corrected title changes only them. A note is joined with its title when shown.

**Groups never move an item.** If groups were cut by size or alphabetically, one new article would shift every later
boundary, every later part would get a new sha256 and phones would download them all again. So each item's group is a
fixed function of its name or number:

- TW: folder (`kt`, `names`, `other`) × a bucket from a hash of the article's file name, among a fixed number of
  buckets (8 to start);
- TA: by manual; `translate`, the largest, also in hash buckets;
- lexicons: by Strong number range, a thousand at a time (G1–G999, G1000–G1999…); Strong numbers never move;
- OBS: ten stories at a time.

The aim is about 250 KB a part. The bucket counts are set from the English measurement (§4) and are part of the compat
key, since changing them moves items.

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
3. **The manifest, normalized.** It says which books a resource has, its title and direction, so it is not ignored:
   its fingerprint is taken without `dublin_core.version`, `modified`, `issued` and the version numbers in `relation`.
   A version bump alone does not change it.
4. **A part's fingerprint** is the sha256 of: the sorted list of its input files with their blob shas (dependencies
   included), the normalized manifest's fingerprint, and the versions of the code for its layers.
5. **Decide.** The new fingerprints are compared with those in the published list:
   - none changed: no build. The list is rewritten with the new release tags only (so apps show the right version and
     credit); phones download that list and nothing else;
   - some changed: a build is asked for;
   - a new book or a removed one adds or drops its parts.
6. **The build does not trust the asker.** It recomputes every fingerprint itself and builds what does not match.
7. **When it runs:** the Worker checks when a language is requested (at most hourly per language, as now), and a
   daily sweep runs step 1 for every published language. `DAILY_LANGUAGES` and its unconditional daily builds go.

## 3. Format and storage

**Parts in R2:** `parts/<sha256>.part.gz`, immutable, addressed by content. Inside, JSONL rows
`{"layer", "key", "value"}`, gzip. Deterministic: rows sorted by key, no dates in the rows (the `timestamp` and
`expiresAt` of quote and alignment rows are set by the importing app), gzip without a name or mtime. The same content
always has the same sha256, so an unchanged part is never uploaded or downloaded again, and identical parts are shared
between languages: originals and MACULA by book, English lexicons for every language that uses them.

**Derived keys lose the release.** Quote and alignment keys name what they were computed from by fingerprint instead
of by release stamp, so identical content keeps its keys. tc-study's app shares that code and adopts the same keys,
with no parameter keeping the old ones: the app gains the same thing (a release with unchanged content costs it no
recomputation), and two key schemes in one code path would double what has to be tested.

**The list:** `catalog/<compat>/<language>.json` (schema 2), no-cache, written last:

- `resources`: key, release tag (for display and credit), title, role (literal, simple, notes…), books;
- `parts`: `sha256`, `bytes`, `kind` (text, original, macula, helps, alignments, shared, titles, lexicon, obs),
  `resource`, `book` when it has one, `fingerprint`, `layers`;
- `originals`: the path and sha256 of `catalog/<compat>/originals.json`, the shared list of original-language and
  MACULA parts that every language names.

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
6. **Upload:** new parts first (a part R2 already has, by sha256, is skipped), then `originals.json`, then the
   language list last.
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
2. **Parts and the per-book build** (tc-study, the largest): deterministic parts, fingerprints from Door43 trees,
   one database per book, reuse of unchanged parts, the shared originals list, compat `f2.0`. The es-419 equivalence
   test, then the English measurement.
3. **Worker and MCP v2:** fingerprint comparison before asking for a build, the parts route with cache and its own
   rate limit, views from parts with fingerprints, cleanup after 30 days.
4. **Servos online** (plan 3, now written for parts): project-book download, "the whole language", updates by
   connection, staging and apply-all-at-once.

**Meanwhile:** the infrastructure steps go on (Admin on tc-study, its Environments, the GitHub App, the Worker's
secrets); parts need them all. Staging with es-419 still tests the whole path. The production backfill of every
language (INFRA step 9) waits for parts: building a hundred languages in `f1.1` only to replace them is waste.

## Open points

- The bucket counts for TW and TA (§1): set from the English measurement in delivery 2.
