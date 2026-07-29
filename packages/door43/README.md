# `@translation-helps/door43`

Door43 / DCS catalog client, ZIP resource fetcher, and parsers for Bible
translation resources (scripture USFM, Translation Notes/Questions/Words,
Translation Academy, Open Bible Stories).

**Status:** internal workspace package (`private: true`). Not published to npm
yet — import from the monorepo as `@translation-helps/door43`.

## Install (workspace)

Already listed in the root `package.json` workspaces. From another package:

```json
{
  "dependencies": {
    "@translation-helps/door43": "*"
  }
}
```

## Quickstart

```ts
import {
  catalogSearch,
  getResourceZipUrl,
  ZipResourceFetcher2,
  parseTranslationNotesTsv,
  extractVerses,
} from "@translation-helps/door43";

// 1. Catalog lookup (optional KV cache injected)
const entries = await catalogSearch({
  lang: "en",
  subject: "Aligned Bible",
});

// 2. Resolve a ZIP URL for Translation Notes
const resolved = await getResourceZipUrl("en", "Translation Notes");
if (!resolved) throw new Error("TN not found");

// 3. Download / extract (inject R2/KV when running on Cloudflare)
const fetcher = new ZipResourceFetcher2({
  // R2: env.ZIP_FILES,
  // KV: env.TRANSLATION_HELPS_CACHE,
  // waitUntil: (p) => ctx.waitUntil(p),
});
const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
const tsv = await fetcher.extractFileFromZip(zip, "tn_TIT.tsv");
const notes = parseTranslationNotesTsv(tsv ?? "", {
  book: "TIT",
  chapter: 2,
  verse: 12,
});
```

## Platform injection

Cloudflare-specific types are **not** required. Pass structural interfaces:

| Binding             | Interface    | Typical CF source             |
| ------------------- | ------------ | ----------------------------- |
| Catalog / TOC cache | `KvLike`     | `env.TRANSLATION_HELPS_CACHE` |
| ZIP persistence     | `BucketLike` | `env.ZIP_FILES`               |
| Background writes   | `waitUntil`  | `(p) => ctx.waitUntil(p)`     |

See `src/platform.ts`.

## Modules

- **Catalog** — `catalogSearch`, `listLanguages`, `getResourceZipUrl`, …
- **ZIP** — `ZipResourceFetcher2` (memory → R2 → network, single-flight)
- **Parsers** — USFM, TSV (TN/TWL/TQ), TA/TW catalog, OBS markdown
- **Alignment** — `QuoteMatcher`, USFM tokenizer
- **Contracts** — shared TypeScript shapes used by the REST API and MCP layers

## Higher layers

- REST API (`src/api`) adapts these into `/api/v1/*` HTTP endpoints
- MCP tools (`src/mcp`) mostly call the REST API; legacy tools import this package directly
- Website docs: `/v2/docs/library`
