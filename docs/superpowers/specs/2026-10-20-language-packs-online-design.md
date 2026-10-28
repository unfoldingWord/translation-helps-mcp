# Language packs online: generated on demand, served from R2, updated in Servos

Date: 2026-10-20. Status: design, for review.

## Why

Language packs are zips made by bt-synergy (`packages/resource-pipeline/cli/prepare-language.ts`): a language's
Door43 resources already parsed, with every help's quote matched to the original and aligned to the gateway texts.
That covers the literal and simple texts with their alignments, TN, TQ, TWL, TW and TA. Three apps use them:

- **Servos**, the offline-first translation app, receives them as files today (a file input, or packs bundled in its
  installers). Nothing is downloaded over the network.
- **tc-study** builds the same rows itself.
- **This MCP** answers `notes` and `word-links` from "views" derived from a pack, when an R2 binding
  `LANGUAGE_PACKS` holds them (791ea3dc). The binding is in the code but in no deploy's configuration.

In the es-419 comparison (`docs/pack-views-comparison-es-419.md`), wherever the pack and Door43's live path differ,
the pack is right: quotes of occurrence -1, quotes written with accents, quotes naming a Hebrew qere. Pack reads are
about 6× faster (median 2 ms vs 13 ms).

What is missing:

- a place where packs live;
- a way to keep them current;
- a way for Servos to fetch them.

This design adds all three, at the lowest running cost that stays effective.

## Decisions taken

- **Packs live in unfoldingWord's Cloudflare account** (account `5a3ffd86…`, where the MCP and API Workers run).
  unfoldingWord has agreed (20-10-2026). Testing uses a staging bucket and the Workers' staging environments in the
  same account, so nothing has to move afterwards.
- **People reach them at `tc-helps.mcp.servant.bible/v2/...`**, the host that already serves the MCP v2. It is a
  custom domain of the Pages project `translation-helps-mcp-945`; the zone `servant.bible` is on Epik's name servers,
  not on Cloudflare, so R2 cannot serve it directly (an R2 custom domain needs the zone in the account). Packs are
  therefore streamed from R2 by the Worker under that host. At a few downloads a week per phone the cost is
  negligible; serving straight from R2 waits until a zone is in the account.
- **Eligible languages:**
  - Those the MCP and tc-study's Read page already list: resources marked `tc-ready`, stage `prod`, in the Door43
    catalog.
  - They must also have an aligned literal text: Servos cannot open a language without one
    (`servos/src/resources/sources.ts:119`), and many tc-ready languages have only OBS.
  - No other language triggers generation.
- **Generation is automatic:**
  - **es-419 and en** are checked daily.
  - **Every other eligible language** is generated once in a **backfill** spread over days (at most 20 a day), and
    again when Door43 publishes a newer release of one of its resources. GitHub minutes are free and a language takes
    10–30 MB of R2, so tens of languages stay within R2's free 10 GB, and the MCP answers every language from packs
    from the start.
  - **A language asked for before its turn** is generated then, as in the backfill.
  - **Manual runs** stay possible for any language.
- **Generation runs in GitHub Actions**, free on this public repository.
  - A standard runner has 4 CPUs, 16 GB of memory and a 6-hour job limit.
  - A Worker cannot generate: it has 128 MB of memory, while es-419 takes about 9 minutes and more than 1 GB.
  - Cloudflare Containers would work too, but bill by the minute.
- **Nothing changes for the person in Servos until they choose.** The app tells them what is new and how big it is;
  they decide to download it.
- **The generator is pinned to tc-study's `main`.** `feat/language-pack` (unfoldingWord/tc-study, formerly
  bt-synergy) is merged first, after a look at tc-study's highlights in the browser (pending since 18-10); the
  workflow then pins a commit of `main`, not of an unmerged branch.
- **Where the routes live:** `/api/v1/...` is the API Worker (`translation-helps-api-v2`); `/v2/mcp` is the MCP
  Worker. Pack routes go where the host reaches: under `tc-helps.mcp.servant.bible/v2/` (see part 4).

## Two ideas the rest depends on

**A pack is compatible with an app by its whole set of versions, not one number.**

- Servos refuses or silently drops layers when any of these differ: the USJ processing, prepared scripture, helps
  quote, helps align, and helps text versions, and the pack format.
- So packs and catalog entries are filed under a **compatibility key** made of all of them, for example
  `f1.1-u2.3.0-p6000230-q8-a11-t1`.
- An app asks only for its own key. When bt-synergy changes any version, old apps keep reading the last packs of their
  key. Packs for the new key are built on the first request, like a new language.

**A pack changes when Door43 changes or when the builder changes.**

- A rebuild with fixed code but the same Door43 stamps used to look «the same» to Servos, so the fix never reached
  a phone. Each catalog entry therefore carries a **build id**: the bt-synergy commit and the Door43 stamps it was
  built from.
- Servos replaces a language's derived layers (quote, align, text, prepared) when the build id is newer, even if the
  stamps are equal.
- A builder change that alters output must bump one of the versions above. CI checks this by building a fixed sample
  and comparing it with a stored one.

## Parts

### 1. Generator (bt-synergy)

**Made runnable in CI first.** Today it depends on Abel's machine:

- it reads MACULA from a local Taller folder;
- it needs compiled `dist/` folders that are not in git;
- it lives on an unmerged branch.

The workflow therefore:

- checks out bt-synergy and `idiomaspuentes/taller` (MACULA) at pinned commits;
- builds the packages;
- runs the generator with the flags used today (`--no-obs --macula …`).

Lexicons are read from a pinned commit instead of `master`, so their changes are seen as builder changes.

**Per language, it:**

1. computes the build id from the Door43 stamps and its own commit;
2. stops if the catalog entry for this compatibility key has the same build id (seconds of runtime);
3. otherwise builds the language pack and the MCP views. Book packs are not built: downloading single books is
   postponed, and they cost ~16 s each (60+ books in English);
4. uploads both under names that include their sha256, so they are immutable and cacheable forever. Packs are never
   byte-identical between runs (dates inside the zip), so the name, not the content, decides what is new;
5. writes the catalog entry last. R2 reads are strongly consistent, so the catalog never names a file not there yet.

**The originals pack** (UHB, UGNT, MACULA, 22 MB) is built by its own job, only when its Door43 stamps, MACULA or the
builder change. Every language entry names the originals build it requires.

**English is unmeasured.** A run on a development machine reached 1.7 GB before its first download finished; es-419
has 6 books, the English ULT 60. Before en is scheduled:

1. a one-off run on a runner, with `/usr/bin/time -v`, measures memory, time and size;
2. if memory runs out, the generator writes each resource's rows to disk instead of keeping them all in memory.

### 2. Workflow (GitHub Actions, in this repository)

`.github/workflows/language-packs.yml`, triggered by `workflow_dispatch(language)` only:

- **Who triggers it:**
  - the Worker, on demand;
  - a Cloudflare cron trigger, daily, for es-419 and en (GitHub disables schedules in public repositories after 60
    days without activity, and delays them);
  - anyone, by hand.
- **One run per language:** `concurrency: packs-${{ inputs.language }}` with `cancel-in-progress: false` (at most one
  running and one waiting). This is the real lock; KV is eventually consistent and cannot be one.
- **Input safety:** the language is checked against the eligible list and passed through `env:`, never written into a
  `run:` line.
- **Credentials:** an R2 S3 token for this bucket only (Object Read & Write), kept in a GitHub Environment limited to
  `main`. It is not the existing `CLOUDFLARE_API_TOKEN`, which can deploy Workers.

### 3. Storage (R2 bucket `LANGUAGE_PACKS`)

```
catalog/<compat>/<lang>.json                       one small entry per language and compatibility key
packs/<compat>/<lang>/<sha256>.langpack.zip        immutable
packs/<compat>/originals/<sha256>.langpack.zip     immutable
v1/<lang>/...                                      MCP views (layout unchanged)
```

- A catalog entry holds:
  - the language, its compatibility key and build id, and `createdAt`;
  - the Door43 stamps;
  - the resources left out and why;
  - the originals build it requires;
  - the pack's file, bytes and sha256, and the manifest `versions`.
- Objects no catalog names are deleted after 30 days.
- Views are overwritten in place, so for a few minutes after a build they mix old and new chapters. That is accepted:
  the MCP's answers then come from one of two correct builds.

### 4. MCP and API Workers

- **New routes**, under `https://tc-helps.mcp.servant.bible/v2/packs/` (first step of the plan: confirm how `/v2/*`
  reaches the MCP Worker on that host, and add `/v2/packs/*` the same way; the API Worker's code is reused there):
  - `GET /v2/packs/<compat>/<lang>` returns the catalog entry, with `no-cache` and an ETag (an unchanged entry costs a
    304).
  - `GET /v2/packs/<compat>/<lang>/<sha256>` returns the pack, streamed from R2, with Range and `If-None-Match`
    (`bucket.get(key, { range, onlyIf })`) and `immutable` caching.
  - Either route on an eligible language with no entry dispatches a build and answers `202` («preparing»).
- **CORS:** allow `Range` and `If-None-Match`, and HEAD; expose `ETag`, `Content-Range`, `Content-Length`,
  `Accept-Ranges` and `Retry-After`.
- **Existing routes** (`notes`, `word-links`) keep reading views when they exist; otherwise they answer from Door43 as
  today.
- **Freshness check:** at most once an hour per language, compare the entry's stamps with Door43's.
  - The cached catalog keeps only tag and zipball today; `mapApiEntry` must also keep `published_at`.
  - The in-process cache gets a TTL (today it never expires).
  - If a resource is newer, dispatch a build and keep serving what exists.
- **Dispatch guard (best effort, in KV, written inside `waitUntil`):**
  - after a failure, no dispatch for 24 hours;
  - after three failures in a row, none until reset by hand;
  - at most 20 dispatches a day in total (the Free plan runs 20 jobs at once).
  - The workflow's concurrency group, not KV, prevents duplicate runs.
- **GitHub credentials:** a GitHub App with only `actions:write` on this repository (a fine-grained personal token
  expires and needs rotating).
- **Configuration:** the bucket is bound in the base config and in every `[env.*]` of both wrangler files (Wrangler
  does not inherit bindings); staging binds `language-packs-staging`.
- **Measuring:** each pack and view request writes one data point to the existing `ANALYTICS` binding: language,
  route, and whether a pack was there, missing or stale. It shows which languages people use and whether the system
  works, at no extra cost.

### 5. Servos

- **When it checks:**
  - when the app opens and when the connection returns, at most once a day;
  - for each language its projects use, it asks for its compatibility key's catalog entry, with `If-None-Match`.
- **Whether to offer:**
  - The card runs the same rules opening a pack runs (`packAgainstDevice`), on the entry's stamps and build id.
  - It offers only what opening would actually replace. Otherwise «nothing new» would follow a 10 MB download, and the
    card would come back every day.
  - The build id last opened or dismissed is remembered.
- **What it shows:** one card on Home: «Hay ayudas nuevas para Español (10 MB). Bajar / Ahora no». The size is shown
  because the app cannot always tell Wi-Fi from mobile data. Nothing downloads by itself.
- **Before downloading:** it checks `navigator.storage.estimate()`. Opened rows take up to ~10× the zip.
- **What it downloads, in this order:**
  1. the originals pack, if the device lacks the build the entry requires;
  2. the language pack.
  - The order matters: opened against another originals release, a language pack's quote and align layers are dropped
    and never come back.
  - Downloads go to IndexedDB in pieces with Range, so a cut connection resumes instead of starting over.
- **Opening:**
  - after the sha256 matches, through the existing receive flow (`openPack`), with its notice of which translated
    verses had their helps changed;
  - each layer is read line by line instead of as one string. Today the originals' UHB layer alone is 82 MB unzipped,
    too much for a 2 GB phone as one string.
- **Cleaning:** after a replacement, the rows keyed by the old stamps are deleted. Today they stay forever.
- **Not built yet:** a language with no entry yet shows «Se está preparando; vuelva a mirar más tarde».
- **Configuration:**
  - the catalog's address defaults to `https://tc-helps.mcp.servant.bible/v2/packs/` and is a setting, so staging
    can stand in for it;
  - the Tauri CSP `connect-src` adds the pack host.

## Failures

| What fails                               | What happens                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A build (Door43 down, memory, a bug)     | The catalog is untouched: the previous pack (or none) stays, and the MCP keeps its Door43 path. The run's log stays in Actions; KV records the failure. |
| A Door43 resource incomplete             | It is left out and named in the entry, as today (Esther has only the literal text).                                                                     |
| The download on a phone                  | Resumed with Range next time; discarded if the sha256 does not match. No automatic retry.                                                               |
| Opening the pack (app closed, phone off) | Already handled: the next start says the pack must be received again.                                                                                   |
| No connection, or the MCP unreachable    | Nothing visible; Servos checks again the next day or when the connection returns.                                                                       |
| An app too old for the current packs     | It keeps the last packs of its compatibility key; when none exist, it says to update the app before downloading.                                        |

## Testing

- **bt-synergy:**
  - building a catalog entry and its build id;
  - deciding nothing changed;
  - the sample-output check that catches builder changes without a version bump;
  - streaming a layer line by line.
- **MCP:**
  - the routes: ETag, 304, Range, streaming, 202;
  - eligibility;
  - the dispatch guard;
  - answers from Door43 while no pack exists.
- **Servos:**
  - the offer rules (same as opening, build id, dismissed builds);
  - the order originals → language;
  - a download cut and resumed;
  - the sha256 check;
  - cleaning old rows;
  - opening the originals on a low-memory Android phone;
  - an end-to-end run in the browser against staging (`language-packs-staging` and the Workers' staging
    environments), then against production.

## Order of work

1. **tc-study:** check its highlights in the browser and merge `feat/language-pack` into `main`.
2. **Generator runnable in CI**, and the English measurement (a one-off run). Everything else waits on knowing
   whether English fits.
3. **Compatibility key, build id and catalog entry** in the generator; streaming import in the language-pack package.
4. **unfoldingWord's account, staging first:** the buckets (`language-packs-staging`, `language-packs`), the R2 token
   and the GitHub App; the workflow against staging.
5. **Worker routes, freshness check, dispatch and measuring**, deployed to staging.
6. **Servos:** the offer card, ordered and resumable downloads, cleaning; end to end against staging.
7. **Production:** bind `language-packs`, deploy, start the backfill, schedule es-419 and en.

## Later, not now

- **Downloading only the books a project uses** (base pack plus book packs). The base pack alone is 8 MB, so the
  saving is small today, and partial packs complicate the replacement rules.
- **Converting references to a project's versification** while building packs. tC4 does this with Proskomma at run
  time; every unfoldingWord resource is in `eng` today.
- **A smaller es-419 pack:** it carries two TW copies (es-419_gl and es-419_obt) and Servos uses one.
- **Attribution inside each zip** (`ATTRIBUTION` file), and the license in the public catalog. The content is
  CC BY-SA and MACULA CC BY 4.0, and the change is indicated. Catalog rows already carry licenses and Servos shows
  credits; lexicon rows' licenses are unconfirmed.
- **Serving packs straight from R2** through a custom domain, once a zone (for example `servant.bible`, moved to
  Cloudflare) is in the account: no Worker invocation per download, and Cloudflare's cache near the phone.
