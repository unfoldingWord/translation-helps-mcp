# Vendored language pack client

Built from `packages/language-pack-client` of unfoldingWord/tc-study at the commit in `SOURCE.json`. Do not edit `index.js`:
rebuild it with `node scripts/vendor-language-pack-client.mjs --tc-study <checkout>`.

Exports: `openFromSegments`, `verifyCatalogFile`, `ClientError`. `index.d.ts` is hand-written (the Worker only uses the
calls listed in the plan's global constraints). The library's MIT `LICENSE` is copied alongside.
