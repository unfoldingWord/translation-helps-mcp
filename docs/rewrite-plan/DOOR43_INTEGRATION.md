Door43 Integration — retrieval, normalization, storage, and caching

Source formats

- ZIP archives from Door43 (git archives): contain USFM files for scripture, TSV for notes/translation-words, Markdown for academy and word articles.

Retrieval mechanisms

- Primary: `ZipResourceFetcher2` uses R2 + Cache API to read extracted file contents fast.
- Fallbacks: GitHub/git.door43.org HTTP ZIP download, local FS (dev).
- R2 keys are computed by `r2KeyFromUrl(zipUrl)` and extracted files stored at `${r2Key}/files/${path}`.

Normalization & canonicalization

- externalReference: parse `rc://` and supportReference fields into canonical `externalReference.path` values like `bible/kt/love`.
- Resource identity: tuple `(owner, project, refTag)` and `project` naming convention like `es_xxx`.

Storage layout (R2)

- Raw ZIPs: `zips/${owner}/${project}@${refTag}.zip`
- Extracted files: `files/${r2Key}/${path}` or `files/${owner}/${project}@${refTag}/${path}`
- Parsed artifacts: `parsed/${r2Key}/${path}.json` (optional)
- Bundles: `bundles/${language}/${reference}.json`

Vector & KV

- Embeddings: stored in vector DB with metadata containing `r2Key` and `path`.
- Small parsed JSON (note lists, externalReference lists): store in Redis for quick lookups.

Caching rules

- Memory cache: hot chunk content and bundles, TTL 1–5 min depending on traffic.
- Edge/Cache API: bundles and small parsed JSON, TTL 5–60 min.
- Redis: presence flags, `lastIndexedAt`, `resourceIndex` entries; persisted until explicit invalidation.
- R2: durable storage of raw and parsed files.

Chunking & mapping back to files

- Every chunk stores backrefs: `{r2Key, path, startOffset, endOffset, chunkIndex}` so we can present precise citations and extract long excerpts when needed.

Link graph

- Build a graph mapping `reference` → notes → externalReference.paths → TA/TW articles. Store graph as `resourceGraph:${language}:${reference}` JSON in Redis for fast traversal and warmers.

Indexing heuristics

- Prioritize `bible` subject and commonly requested languages for warm-up.
- For translations with many projects, index ULT/UST first, then T4T, then community variants.

Handling changes

- When a new ZIP version appears (refTag changed), reindex that project; maintain historical versions via `r2Key` including refTag.

License & provenance

- Extract license from project metadata and attach to each document in index metadata; always surface in responses.

Developer notes

- Reuse `ZipResourceFetcher2` internals for extraction and respect its cache-first behavior: memory → Cache API → R2 → download ZIP and put into R2.
- Provide utilities to rehydrate `externalReference` maps from existing parsed artifacts to help backfill the link graph.
