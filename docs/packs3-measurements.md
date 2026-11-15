# Format 3 reader under V8

Measured with `scripts/measure-packs3.mjs` against the staging Worker (GET only, staging public key), Node v22.20.0 (V8),
vendored client from tc-study `ac276343ce0ec8600353ded04f60551bcf0b48ef`. Heap is `heapUsed` after two `global.gc()` calls.
One reader per language, the same reader for every step. The Bun table the plan refers to is not in this repository, so no
side-by-side comparison is made here.

Command: `node --expose-gc --max-old-space-size=128 scripts/measure-packs3.mjs`

## en, 128 MB old space: completed

| step                       | heap MB after gc | ms   |
| -------------------------- | ---------------- | ---- |
| open (2 catalogs verified) | 9.1              | 0    |
| book('psa')                | 57.4             | 1343 |
| passage('psa 119:1-8')     | 60.6             | 3124 |
| passage('psa 23:1-3')      | 60.7             | 24   |
| orig('psa')                | 79.2             | 2419 |
| articles('tw:kt')          | 80.2             | 605  |
| articles('ta:translate')   | 82.1             | 827  |
| book('isa')                | 84.0             | 462  |
| book('jer')                | 85.5             | 519  |

The whole run (en and es-419) fetched 73 segments/catalogs, 3.1 MB; peak RSS 170.7 MB.

## es-419, 128 MB old space

The staging es-419 catalog lists no `psa`, `isa` or `jer` book, so those steps give no answer (the Worker would fall back to
the API). The steps that answer: orig('psa') 28.7 MB (1271 ms), articles('tw:kt') 29.7 MB (515 ms), articles('ta:translate')
31.5 MB (811 ms).

## 64 MB old space: fails

`--max-old-space-size=64` ends with `FATAL ERROR: Reached heap limit` (exit 134) during `orig('psa')` for en. Before it:
book('psa') 56.0 MB, passage('psa 119:1-8') 59.3 MB, passage('psa 23:1-3') 59.4 MB.

## Reading

- Heap after the Psalms book is 57.4 MB (gate: 80 MB); the 128 MB run completes.
- Heap only grows within one reader (decoded units are kept): after Psalms, the Psalms originals and the other books it is
  84-86 MB. A Worker isolate has 128 MB in total, so a reader must not be kept across requests for several books.
- Wall times include the network fetches from staging, not just decoding.

## Reader byte budget (Task 3)

Heap measured at about 41 MB per compressed MB opened (Psalms: 1.17 MB compressed, 57 MB heap after the book, about 48 MB
of it for the unit itself). Rules: at most 2 readers per isolate (live and recycled-but-running together; a third call
falls back to the API Worker), a reader is replaced once the compressed bytes of its opened units pass 1 MB, and the
compressed segment cache is 8 MB.

Arithmetic: 1 MB x 41 MB/MB = about 41 MB per reader at the budget, 2 readers = about 82 MB, plus the 8 MB segment cache
and the isolate's own code and temporaries, about 90 MB plus working memory, against the 128 MB isolate.

Caveat: the budget is checked between calls, so a single unit can overshoot it (Psalms alone is about 48 MB), and the
overshoot happens inside one callback: a reader at 0.9 MB that then reads Psalms reaches about 85 MB alone. Two such
readers would not fit, which is why they are bounded together. This is an estimate, not a measurement of two readers at
once: it is to be measured in staging step S4 (the exceededMemory tail).

## Exclusive reader for big books (Task 14a-OT)

en Psalms (book 1,097,745 + orig 418,898 compressed bytes) and en Genesis (757,575 + 374,287) are over the 1 MB budget.
They are read in an exclusive reader (readers.ts): opened only when no other reader has a call running, blocking every
other call meanwhile, retired right after its call, hard cap 1.8 MB compressed. Opening it drops the idle live readers (accepted: they
reopen on their next call); a reader with a call running is never dropped, the exclusive call waits for none and falls
back with `readers-busy` instead. An exclusive call that has not returned after 30 s of wall time is treated as
abandoned: the next call clears the slot (logged once per isolate) and a late finish of the old call does not clear a
newer slot.

Measured with a script that calls `withReader` with `need: bookBytes` from the local staging bucket (no network), Node
v22, reading `book` then `orig`, in the order PSA, GEN, PSA:
`node --import tsx --expose-gc --max-old-space-size=<N> measure-ot.mjs <bucket>` (kept in the Task 14a-OT scratch folder).

| old space | PSA heap after book / after orig (gc) | GEN after book / after orig | after each call | sampled peak (no gc) |
| --------- | ------------------------------------- | --------------------------- | --------------- | -------------------- |
| 128 MB    | 61.5 / 79.9 MB                        | 61.0 / 78.4 MB              | 11.8-12.8 MB    | 87.7 MB              |
| 110 MB    | 61.6 / 79.9 MB                        | 61.0 / 78.4 MB              | 11.4-12.8 MB    | 87.0 MB              |
| 96 MB     | 61.6 / 79.9 MB                        | 61.0 / 77.5 MB              | 11.4-12.6 MB    | 86.0 MB              |

All three complete. One call takes 0.5-0.85 s (decode only). The sampled peak is heapUsed every 5 ms without gc, so a
lower bound on the true peak; the 96 MB run completing is the stronger evidence that one exclusive call fits under
~110 MB. The heap is about 45-47 MB per compressed MB (Psalms 1.52 MB measured, peak 80 MB after gc). The cap is 1.8 MB: just
above the largest measured book, about 85 MB of heap at that rate. A cap of 2.5 MB would be about 129 MB, past the
128 MB isolate and unmeasured. A book over 1.8 MB compressed falls back (`book-too-large`).

## Psalms notes, default shape (Task 14b-OT fix 1)

A default-shape notes call opens the book and its original (en ULT + UHB, Psalms 1.52 MB compressed, exclusive
reader) and builds the route's word tokens for its `gatewayQuote.aligned`. The tokens are built only for the verses
of the rows asked (a whole book of Psalms would be about 20k Hebrew and 50k+ English token objects). Measured with a
script that calls `buildNotesAnswer` from the local staging bucket, Node v22:
`node --import tsx --expose-gc --max-old-space-size=<N> measure-notes.mjs <bucket> "<refs>"` (Task 14b-OT scratch
folder). Psalms 119, 3, 18, 37, 68, 78 and 89 are sweep exceptions and fall back before any token is built.

| old space | call                  | rows (aligned) | verses tokenised (orig + text) | sampled peak (no gc) | after call (gc) |
| --------- | --------------------- | -------------- | ------------------------------ | -------------------- | --------------- |
| 128 MB    | Psa 23:1              | 4 (2)          | 2                              | 101.1 MB             | 13.2 MB         |
| 128 MB    | Psa 1 (chapter)       | 38 (36)        | 12                             | 94.4 MB              | 13.3 MB         |
| 128 MB    | Psa 105 (chapter)     | 113 (111)      | 88                             | 96.3 MB              | 12.2 MB         |
| 128 MB    | Psa 106 (chapter)     | 136 (134)      | 94                             | 86.5 MB              | 12.3 MB         |
| 110 MB    | Psa 1, 23:1, 105, 106 | as above       | as above                       | 84.3-91.8 MB         | 11.9-13.4 MB    |
| 96 MB     | Psa 1, 23:1, 105, 106 | as above       | as above                       | 84.7-92.3 MB         | 11.9-12.4 MB    |

Every run completes. The sampled peak is heapUsed every 5 ms without gc: garbage not yet collected moves it by
±10 MB from run to run (Psa 23:1 101.1 MB at 128 MB old space, 84-88 MB at 110 and 96), so it is a noisy lower
bound; the 96 MB run completing every call is the stronger evidence that a Psalms notes call fits under ~110 MB.
The decode of book + original (about 80 MB after gc, see above) dominates; the tokens of a chapter add little.
