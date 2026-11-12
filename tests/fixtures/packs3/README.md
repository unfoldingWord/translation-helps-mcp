# Format 3 fixtures

Real catalogs and segments of the staging Worker (`https://translation-helps-mcp-v2-preview.unfoldingword.workers.dev`),
stored under their R2 keys (`v3/catalog/{lang}.seg`, `v3/seg/{id}.seg`). They are signed with the staging key
`78d2e6299a2de4d0`. `index.json` lists ids, sizes and the units each segment serves.

Contents: the `en`, `es-419` and common catalogs; `en` `book:tit`, `orig:tit`; `es-419` `book:rut`, `orig:rut`;
`art:tw:kt` and `art:ta:translate` of both languages; the `map` unit of both languages.

Sources (all CC BY-SA 4.0): unfoldingWord Translation Words, Translation Academy, ULT/UST and the Hebrew and Greek
originals (UHB, UGNT), and the es-419 resources as published by unfoldingWord and the Door43 community.

Refresh with `node scripts/fetch-packs3-fixtures.mjs` (read-only GETs; size target 2.5 MB or less).
