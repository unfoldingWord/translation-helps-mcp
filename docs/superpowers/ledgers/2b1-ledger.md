# 2b-1 ledger (feat/packs-book-by-book)
Plan: /home/user/unfoldingword/translation-helps-mcp/docs/superpowers/plans/2026-10-22-language-packs-2b1-book-by-book-build.md
Baseline: language-pack 42 pass, resource-pipeline 126 pass. Bun 1.4.2 (1.3.3 unavailable via proxy).

## Tasks 1-3 (aef8e50, 2239faf, 011200a) — language-pack 69 pass
Deviations: gzip OS byte forced 255; zlib lazy-imported; writePart throws on receipts and duplicate layer+key; serializePartsList drops LIST_DROPPED_FIELDS from metadata (volatile + updatedAt, accessedAt, accessCount, downloadedAt, lastDownload, downloadStats, downloadedIngredients) — importer must set catalogedAt; lexicon domains/*.json → group 'domains'; OBS-TN book row → group 'index'; TW bucket on 'kt/god.md' even though keys lack .md; TA translate bucket on article dir.
Pending for Abel: CURRENT_PACK_COMPAT in MCP src/packs/dispatch.ts must become f2.0-u2.3.0-p6000230-q9-a12-t1 when deployed (not done).
## Task 4 (0297475) — resource-pipeline 143 pass
API: chaptersFromStore(cache,rk,book); collectLane3Groups/buildLanguageArtifacts {books, chaptersOf (may be async in build), articles, obs}; BuildReport.jobs.failed, failures[≤20]; BuildJobOutcome.
Deviations: TN/TQ/TWL chaptersFromStore returns 1..chapterCount when book row exists (today's build writes empty prepared rows for chapters without notes); articles:false also skips TA/TW titles (shared unit must pass articles:true); alignment chapters = notes ∩ target text chapters.
## Review 1-3 → fixes (agent running)
- TW/TA prepared rows bucketed by wrong string (article split across parts) → slot by segment 3.
- node:zlib bytes differ Bun vs Node → pako 2.1.0 + golden hash test.
- carried-but-unmatched rows must throw, not drop.
- DECISION (mine, tell Abel): whole packs stay format 1.1.0; new PARTS_FORMAT_VERSION 2.0.0 only for parts compat (spec §3: f1.1 stays until apps move). No CURRENT_PACK_COMPAT change needed.
- restoreCatalogBookkeeping helper for 2c; books sorted; toJSON honoured.
- Deferred to 2c: readPart in browser now via pako; layer lifetimes from code on import; write exact bucket hash inputs into spec for the 2b-2 Worker.
## Review 4 — nothing blocks. Folded into Task 6: print j.failed + failures in prepareAndPack.ts:169-172 summary; per-book build should treat blocked prepare jobs as failures (scripturePreparer catch returns null); each per-book DB needs the original's receipt (readyOlKeys); Task 7 ignore warm-coverage:v1.
## Fixes 1-3 (480f9b3) — language-pack 79, resource-pipeline 143
Golden part hash 427f2352… (242 B) same Bun 1.4.2 / Node 22. Web Crypto for sha256. articleIdOfRow uses segment 4 (original case) fallback 3. Book-scoped row without book (e.g. {rk}/manifest) now throws — watch in Task 6/7.
## Task 5 (be6d0da) — resource-pipeline 150; pre-existing fails: scripture-loader 1 (usjChapterStore skipExisting), TN 3 (absentFromRelease)
API: zipCachingClient(client, dir), zipCachePath; downloadResource books option (absentFromRelease read from existing resource:{key} receipt; no receipt/prune/tree request in book mode; books:[] no-op; failed book throws); runDownload books (skips completeness/markComplete/blobs/markError). ingredientsForBooks in resource-catalog.
Task 6 must: write receipts (with absentFromRelease) BEFORE runDownload per book DB; pass books only to book-scoped resources.
## Review 5 — nothing blocks. Sent to Task 6: derive absentFromRelease from cached zip names + persistAbsentFromRelease on catalog DB, copy to per-book receipts; zipCache delete-on-bad-zip, avoid double copy; zip dir per run; whole-vs-book Ruth rows equality test.
## Task 6 (90c87ee, b87d924, fbeafd7) — resource-pipeline 158, language-pack 79; actionlint clean
Absent books from cached zip file list; units = canon books of any book-scoped resource OR original (originals pack carries all UHB/UGNT books); MACULA in shared unit, sliced per book; failures returned, CLI exits 1 after writing; test hooks door43Client/discover/fetch/rss; zips in <work>/zips; parts-report.json.
Untested: lexicons, OBS. Real es-419 run blocked (git.door43.org 403).
## Task 7 script (99c1826) — resource-pipeline 163, language-pack 80
compare-parts on fixture: 0 differences (25 parts, 9 receipts ignored). Parts list carries books for UGNT/UHB, whole manifest doesn't — compared only when whole has them. readPack + withoutBookkeeping exported from language-pack. Follow-up: buildLanguageParts.test.ts could import partsFixture.ts.
Steps 1-3 (real es-419, English) blocked on network / merge.
## Review 6 — nothing blocks merge; fix before English: memory check only between units (after delete) → sample during unit, log start, report in finally. Also: non-canon books (frt) dropped; no try/finally; hand-copied whole build in test; blocked delete only logged; unplaceable rows abort; shared download error message lost; no zip retry; compat check in parts mode. Fix agent running.
## Fixes 6 (80e2829, 26faa5d, 7992cee) — resource-pipeline 170, language-pack 80; actionlint clean
In-unit RSS sampling + per-unit peak; report written each unit + finally; non-canon books as units; try/finally deletes; equivalence via real prepareAndPack + compareParts (fixture has TQ, TA, lexicon, FRT, OBS; no OBS helps); slotRows failures capped 20/unit; zip retries 2/4/8 s; --parts --force rejected; compat check skipped in parts mode. Units report peakRssMb.
Final review running.
## English measurement (run 39942659119, master 28f8a50, no-upload, parts) — success
975 s build step (~16 min vs 46:51 whole); peak RSS 2121 MB (vs 14.9 GB); 595 en parts + 132 originals; 0 failures.
Largest growth: gen +1114 MB, psa +1049 (139.7 s, slowest), mat +967, shared +598, 1sa +493.
num, 1ch, 2ch, ecc, isa, jer, ezk: only 3 parts (bsb, t4t, uhb) — ULT/UST/TN/TQ/TWL had no such book in this release (no download attempted). Likely those books aren't in en v91 releases; unverified against a whole build (Door43 blocked here).
Artifact parts-report.json not downloadable from the cloud session (blob storage blocked); figures from the job log.
Abel confirmed: those 7 books are missing from en v91 → 3 parts is correct.
## es-419 compare (run 39949734159, master 5771dcf) — success, compare-parts exit 0 (no differences)
Parts: 81 es-419 parts + 132 originals, peak 1442 MB, 79 s, 0 failures. Whole: 7.9 MB es-419 pack (9 resources) + 21.9 MB originals, ~170 s, 0 failed. compare ~25 s.
Plan 2b-1 complete.
