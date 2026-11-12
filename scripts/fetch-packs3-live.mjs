#!/usr/bin/env node
// Reads today's answers of the API Worker (read-only GETs of /api/v1/notes and /api/v1/word-links, no credentials) for
// whole chapters of the fixture books and stores them compactly in tests/fixtures/packs3/live/{lang}-{book}.json.
// A note body is kept as its SHA-1 (`noteSha`) plus whether it has link markup (`noteLinks`), to keep the files small.
// Usage: node scripts/fetch-packs3-live.mjs [baseUrl]
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (
  process.argv[2] ??
  "https://translation-helps-api-v2.unfoldingword.workers.dev"
).replace(/\/$/, "");
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "tests",
  "fixtures",
  "packs3",
  "live",
);
const BOOKS = [
  ["en", "Tit", 3],
  ["es-419", "Tit", 3],
  ["es-419", "Rut", 4],
];
const get = async (kind, lang, ref) => {
  const res = await fetch(
    `${BASE}/api/v1/${kind}?reference=${encodeURIComponent(ref)}&language=${lang}`,
  );
  if (!res.ok) throw new Error(`${kind} ${lang} ${ref}: ${res.status}`);
  return res.json();
};
mkdirSync(OUT, { recursive: true });
for (const [lang, book, n] of BOOKS) {
  const out = { lang, book, source: BASE, chapters: {} };
  for (let c = 1; c <= n; c++) {
    const notes = await get("notes", lang, `${book} ${c}`);
    const links = await get("word-links", lang, `${book} ${c}`);
    out.chapters[c] = {
      source: notes.source,
      notes: notes.notes.map(({ note, gatewayQuote, ...r }) => ({
        ...r,
        ...(book === "Rut" ? {} : { gatewayQuote }),
        noteSha: createHash("sha1").update(note).digest("hex"),
        noteLinks: /rc:\/\/|\]\(\.\.?\//.test(note),
        ...(r.verse === "intro"
          ? {
              heading:
                (note
                  .split("\n")
                  .map((l) => /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l.trim()))
                  .find(Boolean) ?? [])[1] ?? "",
            }
          : {}),
      })),
      // Hebrew books are only compared in fields=index mode (no aligned words): keep the files small.
      wordLinks:
        book === "Rut"
          ? links.wordLinks.map(({ gatewayQuote, ...r }) => r)
          : links.wordLinks,
    };
  }
  writeFileSync(
    join(OUT, `${lang}-${book.toLowerCase()}.json`),
    JSON.stringify(out),
  );
}
