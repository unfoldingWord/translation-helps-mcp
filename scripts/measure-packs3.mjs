#!/usr/bin/env node
/**
 * Measures the vendored language pack client under V8 (the Worker's engine): heap after each read and wall time.
 * Usage: node --expose-gc --max-old-space-size=128 scripts/measure-packs3.mjs --base <worker url> [--lang en]
 * Only GET requests; the key is the public staging key (PACKS_V3_TRUSTED_KEYS).
 */
import { openFromSegments, verifyCatalogFile } from "../vendor/language-pack-client/index.js";

const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const base = arg("--base", "https://translation-helps-mcp-v2-preview.unfoldingword.workers.dev").replace(/\/$/, "");
const langs = arg("--langs", "en,es-419").split(",");
const KEY = "78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911";
const [keyId, keyHex] = KEY.split(":");
const trustedKeys = { [keyId]: Uint8Array.from(keyHex.match(/../g), (h) => parseInt(h, 16)) };

if (typeof global.gc !== "function") {
  console.error("run with --expose-gc");
  process.exit(2);
}
const mb = (n) => +(n / 1048576).toFixed(1);
const heap = () => {
  global.gc();
  global.gc();
  return mb(process.memoryUsage().heapUsed);
};

let bytesFetched = 0;
let requests = 0;
async function getBytes(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return undefined;
  const b = new Uint8Array(await res.arrayBuffer());
  bytesFetched += b.length;
  requests++;
  return b;
}
const catalogOf = async (name) => {
  const bytes = await getBytes(`${base}/v3/packs/${name}/catalog`);
  if (!bytes) throw new Error(`no catalog for ${name}`);
  return verifyCatalogFile(bytes, { trustedKeys }, { from: "network" });
};

async function runLang(lang) {
  const rows = [];
  const catalogs = [await catalogOf(lang), await catalogOf("common")];
  const reader = openFromSegments({ lang, catalogs, get: (id) => getBytes(`${base}/v3/packs/seg/${id}`) });
  rows.push({ step: "open (2 catalogs verified)", heapMB: heap(), ms: 0, ok: true, note: `${bytesFetched} B so far` });
  const steps = [
    ["book('psa')", () => reader.book("psa")],
    ["passage('psa 119:1-8')", () => reader.passage("psa 119:1-8")],
    ["passage('psa 23:1-3')", () => reader.passage("psa 23:1-3")],
    ["orig('psa')", () => reader.orig("psa")],
    ["articles('tw:kt')", () => reader.articles("tw:kt")],
    ["articles('ta:translate')", () => reader.articles("ta:translate")],
    ["book('isa')", () => reader.book("isa")],
    ["book('jer')", () => reader.book("jer")],
  ];
  for (const [step, fn] of steps) {
    const t0 = performance.now();
    let ok = true;
    let note = "";
    try {
      const r = await fn();
      if (r === undefined || (r && r.data === null)) {
        ok = false;
        note = "no answer";
      }
    } catch (e) {
      ok = false;
      note = String(e?.message ?? e).slice(0, 80);
    }
    const ms = Math.round(performance.now() - t0);
    rows.push({ step, heapMB: heap(), ms, ok, note });
    console.error(`  [progress] ${step}: ${rows.at(-1).heapMB} MB`);
  }
  return rows;
}

const limit = process.execArgv.find((a) => a.startsWith("--max-old-space-size")) ?? "default";
console.log(`node ${process.version} ${limit} base=${base}`);
let failed = false;
for (const lang of langs) {
  try {
    const rows = await runLang(lang);
    console.log(`\n### ${lang}\n\n| step | heap MB after gc | ms | ok | note |\n|---|---|---|---|---|`);
    for (const r of rows) console.log(`| ${r.step} | ${r.heapMB} | ${r.ms} | ${r.ok} | ${r.note} |`);
  } catch (e) {
    failed = true;
    console.log(`\n### ${lang}\n\nFAILED: ${e?.message ?? e}`);
  }
}
console.log(`\nrequests ${requests}, bytes ${bytesFetched}, peak rss ${mb(process.resourceUsage().maxRSS * 1024)} MB`);
process.exit(failed ? 1 : 0);
