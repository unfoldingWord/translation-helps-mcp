/**
 * The notes and word links of a set of references, two ways: from Door43 as the
 * API Worker builds them today (catalog, zips, TSV, quote matching), and from
 * the language packs' views (routes/packViews.ts). Runs the real route handlers
 * in Node, with KV and R2 kept in memory and the views read from a folder.
 *
 *   npx tsx scripts/compare-pack-views.ts <views folder> [report.md]
 *
 * The views folder holds `v1/{lang}/…` as bt-synergy's
 * `packages/resource-pipeline/cli/mcp-views.ts` writes it. Door43 is read over
 * the network, so the first reference of each book pays the downloads.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { handleNotes } from "../src/api/routes/notes.js";
import { handleWordLinks } from "../src/api/routes/wordLinks.js";
import type { Env, RouteContext } from "../src/api/worker.js";

const viewsDir = resolve(process.argv[2] ?? ".");
const reportPath = process.argv[3];

/** What a passage asks: Titus and Ruth whole verses, poetry in Jonah, a qere in Ruth, ranges, the variant code «es». */
const REFERENCES: Array<[string, string]> = [
  ["es-419", "TIT 1:1"],
  ["es-419", "TIT 1:5"],
  ["es-419", "TIT 1:12"],
  ["es-419", "TIT 2:11-14"],
  ["es-419", "TIT 3:5"],
  ["es", "TIT 2:1"],
  ["es-419", "RUT 1:1"],
  ["es-419", "RUT 1:8"],
  ["es-419", "RUT 1:16"],
  ["es-419", "RUT 2:12"],
  ["es-419", "RUT 3:9"],
  ["es-419", "RUT 4:5"],
  ["es-419", "RUT 2:1-3"],
  ["es-419", "JON 1:3"],
  ["es-419", "JON 1:14"],
  ["es-419", "JON 2:2"],
  ["es-419", "JON 2:5-6"],
  ["es-419", "JON 3:4"],
  ["es-419", "JON 4:11"],
  ["es-419", "3JN 1:1"],
  ["es-419", "3JN 1:9-10"],
];

// --- KV, R2 and the views folder, in memory --------------------------------------------------------------------------

const kvStore = new Map<string, string>();
const kv = {
  get: async (key: string) => kvStore.get(key) ?? null,
  put: async (key: string, value: string) => void kvStore.set(key, String(value)),
  delete: async (key: string) => void kvStore.delete(key),
};
const r2Store = new Map<string, Uint8Array>();
const r2 = {
  get: async (key: string) => {
    const bytes = r2Store.get(key);
    return bytes
      ? {
          arrayBuffer: async () => bytes.slice().buffer,
          json: async () => JSON.parse(new TextDecoder().decode(bytes)),
        }
      : null;
  },
  put: async (key: string, value: ArrayBuffer | Uint8Array) => void r2Store.set(key, new Uint8Array(value)),
};
const folder = {
  get: async (key: string) => {
    const file = join(viewsDir, key);
    return existsSync(file) ? { json: async () => JSON.parse(readFileSync(file, "utf8")) } : null;
  },
};

const door43Env = { TRANSLATION_HELPS_CACHE: kv, ZIP_FILES: r2 } as unknown as Env;
const packEnv = { ...door43Env, LANGUAGE_PACKS: folder } as unknown as Env;
const execCtx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException() {} } as unknown as ExecutionContext;

async function call(
  handler: (ctx: RouteContext) => Promise<Response>,
  env: Env,
  route: string,
  language: string,
  reference: string,
) {
  // Each reference is built anew: no answer kept from the other path or from an earlier reference.
  kvStore.forEach((_, key) => key.startsWith("resp:") && kvStore.delete(key));
  const url = new URL(`https://api.local/api/v1/${route}?reference=${encodeURIComponent(reference)}&language=${language}`);
  const started = performance.now();
  const body = (await (await handler({ url, env, execCtx })).json()) as Record<string, unknown>;
  return { body, ms: performance.now() - started };
}

// --- Comparing ---------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown> & { gatewayQuote?: { original?: string; aligned?: string; simple?: string } };
const isVerseRow = (r: Row) => r.verse !== "intro";
const idOf = (r: Row) => String(r.id ?? r.twId ?? "");
const fold = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

interface Tally {
  rows: number;
  onlyDoor43: number;
  onlyPack: number;
  same: number;
  differ: number;
  emptyDoor43: number;
  emptyPack: number;
  simple: number;
  door43Ms: number[];
  packMs: number[];
}
const tally = (): Tally => ({ rows: 0, onlyDoor43: 0, onlyPack: 0, same: 0, differ: 0, emptyDoor43: 0, emptyPack: 0, simple: 0, door43Ms: [], packMs: [] });
const totals = { notes: tally(), wordLinks: tally() };
const lines: string[] = [];
const examples: string[] = [];
const rangeOnly: string[] = [];

for (const [language, reference] of REFERENCES) {
  for (const [kind, handler, route, field] of [
    ["notes", handleNotes, "notes", "notes"],
    ["wordLinks", handleWordLinks, "word-links", "wordLinks"],
  ] as const) {
    const t = totals[kind];
    const live = await call(handler, door43Env, route, language, reference);
    const pack = await call(handler, packEnv, route, language, reference);
    t.door43Ms.push(live.ms);
    t.packMs.push(pack.ms);
    const a = ((live.body[field] as Row[]) ?? []).filter(isVerseRow);
    const b = ((pack.body[field] as Row[]) ?? []).filter(isVerseRow);
    const byId = new Map(b.map((r) => [idOf(r), r]));
    const liveIds = new Set(a.map(idOf));
    let same = 0;
    let differ = 0;
    for (const row of a) {
      const other = byId.get(idOf(row));
      if (!other) {
        t.onlyDoor43++;
        continue;
      }
      const x = fold(row.gatewayQuote?.aligned ?? "");
      const y = fold(other.gatewayQuote?.aligned ?? "");
      if (!x) t.emptyDoor43++;
      if (!y) t.emptyPack++;
      if (x === y) same++;
      else {
        differ++;
        examples.push(
          `| ${reference} | ${kind === "notes" ? "nota" : "enlace"} | ${row.gatewayQuote?.original ?? ""} | ${x || "—"} | ${y || "—"} | ${fold(other.gatewayQuote?.simple ?? "") || "—"} |`,
        );
      }
    }
    for (const row of b) {
      if (!liveIds.has(idOf(row))) {
        t.onlyPack++;
        if (rangeOnly.length < 8)
          rangeOnly.push(
            `| ${reference} | ${kind === "notes" ? "nota" : "enlace"} (${row.reference}) | ${row.gatewayQuote?.original ?? ""} | — | ${fold(row.gatewayQuote?.aligned ?? "") || "—"} | ${fold(row.gatewayQuote?.simple ?? "") || "—"} |`,
          );
      }
      if (fold(row.gatewayQuote?.simple ?? "")) t.simple++;
    }
    t.rows += a.length;
    t.same += same;
    t.differ += differ;
    lines.push(
      `| ${language} ${reference} | ${kind === "notes" ? "notas" : "enlaces"} | ${a.length} | ${b.length} | ${same} | ${differ} | ${live.ms.toFixed(0)} ms (${String((live.body.meta as { cache?: string })?.cache ?? "")}) | ${pack.ms.toFixed(1)} ms (${String((pack.body.meta as { cache?: string })?.cache ?? "")}) |`,
    );
    process.stdout.write(".");
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const summary = (name: string, t: Tally) =>
  [
    `### ${name}`,
    "",
    `- Filas de versículo (Door43): ${t.rows}. Solo en Door43: ${t.onlyDoor43}. Solo en el paquete: ${t.onlyPack}.`,
    `- Mismas palabras en el texto literal: ${t.same}. Distintas: ${t.differ}. Vacías en Door43: ${t.emptyDoor43}. Vacías en el paquete: ${t.emptyPack}.`,
    `- Filas con sus palabras en el texto simple (solo el paquete las da): ${t.simple}.`,
    `- Tiempo: Door43 mediana ${median(t.door43Ms).toFixed(0)} ms, máximo ${Math.max(...t.door43Ms).toFixed(0)} ms; paquete mediana ${median(t.packMs).toFixed(1)} ms, máximo ${Math.max(...t.packMs).toFixed(1)} ms.`,
    "",
  ].join("\n");

const report = [
  "# Notas y enlaces de palabras: Door43 frente a los paquetes",
  "",
  `${new Date().toISOString()} · vistas en \`${viewsDir}\``,
  "",
  summary("Notas", totals.notes),
  summary("Enlaces de palabras", totals.wordLinks),
  "## Por referencia",
  "",
  "| Referencia | Qué | Door43 | Paquete | Iguales | Distintas | Door43 | Paquete |",
  "|---|---|---|---|---|---|---|---|",
  ...lines,
  "",
  "## Palabras alineadas distintas",
  "",
  "| Referencia | Qué | Original | Door43 (literal) | Paquete (literal) | Paquete (simple) |",
  "|---|---|---|---|---|---|",
  ...examples,
  "",
  "## Filas que solo da el paquete (los demás versículos de un rango; hasta 8)",
  "",
  "| Referencia | Qué | Original | Door43 | Paquete (literal) | Paquete (simple) |",
  "|---|---|---|---|---|---|",
  ...rangeOnly,
  "",
].join("\n");

console.log("\n" + summary("Notas", totals.notes) + "\n" + summary("Enlaces de palabras", totals.wordLinks));
if (reportPath) writeFileSync(reportPath, report);
