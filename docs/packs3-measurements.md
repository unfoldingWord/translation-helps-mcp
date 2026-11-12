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
