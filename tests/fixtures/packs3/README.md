# Format 3 fixtures

Real catalogs and segments of the staging Worker (`https://translation-helps-mcp-v2-preview.unfoldingword.workers.dev`),
stored under their R2 keys (`v3/catalog/{lang}.seg`, `v3/seg/{id}.seg`). They are signed with the staging key
`78d2e6299a2de4d0`. `index.json` lists ids, sizes and the units each segment serves.

Contents: the `en`, `es-419` and common catalogs; `en` `book:tit`, `orig:tit`; `es-419` `book:rut`, `orig:rut`, `book:tit` (its `orig:tit` is the same segment as the English one);
`art:tw:kt`, `art:tw:names`, `art:tw:other` and `art:ta:translate` of both languages (the three tW groups hold the titles of the word links); the `map` unit of both languages.

`live/{lang}-{book}.json` are today's answers of the production API Worker for `/api/v1/notes` and `/api/v1/word-links`
(en TIT, es-419 TIT and RUT, whole chapters; note bodies kept as SHA-1 plus whether they have links; RUT without
`gatewayQuote`, it is compared in `fields=index` mode only). Refresh with `node scripts/fetch-packs3-live.mjs`.

Sources (all CC BY-SA 4.0): unfoldingWord Translation Words, Translation Academy, ULT/UST and the Hebrew and Greek
originals (UHB, UGNT), and the es-419 resources as published by unfoldingWord and the Door43 community.

Refresh with `node scripts/fetch-packs3-fixtures.mjs` (read-only GETs; size target: all tracked files here total 2,500,000 bytes or less).
