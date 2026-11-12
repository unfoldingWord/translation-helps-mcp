#!/usr/bin/env node
// Downloads the format 3 test fixtures from the staging Worker (read-only GETs) into tests/fixtures/packs3/v3/...
// under their R2 keys, and writes tests/fixtures/packs3/index.json. Usage: node scripts/fetch-packs3-fixtures.mjs [baseUrl]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCatalogFile } from "../vendor/language-pack-client/index.js";

const BASE = (process.argv[2] ?? "https://translation-helps-mcp-v2-preview.unfoldingword.workers.dev").replace(/\/$/, "");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "packs3");
const WANT = {
  en: ["book:tit", "orig:tit", "art:tw:kt", "art:ta:translate", "map"],
  "es-419": ["book:rut", "orig:rut", "book:tit", "orig:tit", "art:tw:kt", "art:ta:translate", "map"],
};
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const index = { source: BASE, catalogs: {}, segments: {} };

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get("etag") };
}
function save(key, bytes) {
  const file = join(OUT, key);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}
async function catalog(name) {
  const { bytes, etag } = await get(`/v3/packs/${name}/catalog`);
  const v = await verifyCatalogFile(bytes, {}, { from: "network" });
  const key = `v3/catalog/${name}.seg`;
  save(key, bytes);
  index.catalogs[name] = { key, id: v.id, size: bytes.length, etag };
  return v.catalog;
}
async function segment(idBytes, unit) {
  const id = hex(idBytes);
  if (index.segments[id]) return void index.segments[id].units.push(unit);
  const { bytes } = await get(`/v3/packs/seg/${id}`);
  const key = `v3/seg/${id}.seg`;
  save(key, bytes);
  index.segments[id] = { key, size: bytes.length, units: [unit] };
}

const common = await catalog("common");
for (const [lang, units] of Object.entries(WANT)) {
  const cat = await catalog(lang);
  for (const unit of units) {
    for (const c of [cat, common]) {
      const u = c.units.find((x) => x.id === unit);
      if (!u) continue;
      for (const i of u.segments) await segment(c.segments[i].id, `${lang}:${unit}`);
      break;
    }
  }
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
const total = Object.values(index.catalogs).concat(Object.values(index.segments)).reduce((n, e) => n + e.size, 0);
console.log(`${Object.keys(index.segments).length} segments, ${total} bytes`);
