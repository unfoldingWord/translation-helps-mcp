/**
 * Save the home page's sample answers: npx tsx scripts/capture-home-snapshot.ts [origin]
 *
 * Calls each ANATOMY_PARTS call, then for the hero get_passage_index (the notes, their
 * quotes and Academy topics, and the counts), get_note for each hero note's text, and
 * get_questions for the count of questions, all in one MCP session against `origin`
 * (default: the production Worker, DEFAULT_ORIGIN). Writes web/src/lib/home/snapshot.json.
 * The home page shows only these until someone chooses a part. Never run in the build.
 */
import { writeFileSync } from "node:fs";
import { McpHttpClient } from "../web/src/lib/mcp/client";
import { DEFAULT_ORIGIN } from "../web/src/lib/endpoint";
import { endpointFor } from "../web/src/lib/site";
import {
  ANATOMY_PARTS,
  PASSAGE,
  excerptFrom,
  heroCounts,
  heroNotes,
  noteTextFrom,
  stripVerseNumber,
  type AnatomyPartId,
  type HeroNote,
  type HomeSnapshot,
} from "../web/src/lib/home/anatomy";

const origin = (process.argv[2] ?? DEFAULT_ORIGIN).replace(/\/$/, "");
const out = new URL("../web/src/lib/home/snapshot.json", import.meta.url);

function fail(message: string): never {
  console.error(`capture-home-snapshot: ${message}`);
  // workers-types v5 types global `process` as `any`, so tsc no longer sees exit() as `never`.
  return process.exit(1) as never;
}

async function main() {
  const client = new McpHttpClient(endpointFor(origin));
  await client.initialize();

  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool(tool, args);
    if (r.isError || !r.structured)
      fail(`${tool} gave no answer: ${r.text.slice(0, 200)}`);
    console.log(
      `  ${tool} ${JSON.stringify(args)} · ${r.exchange.bytes} bytes`,
    );
    return r.structured;
  };

  const excerpts = {} as Record<AnatomyPartId, string>;
  let versions: Record<string, unknown>[] = [];
  for (const part of ANATOMY_PARTS) {
    const structured = await call(part.call.tool, part.call.args);
    const text = excerptFrom(part.id, structured);
    if (!text) fail(`no excerpt for ${part.id}`);
    excerpts[part.id] = text;
    if (part.id === "text" && Array.isArray(structured.versions)) {
      versions = structured.versions as Record<string, unknown>[];
    }
  }

  const index = await call("get_passage_index", { ...PASSAGE });
  const picked = heroNotes(index);
  if (picked.length < 2) fail("fewer than two notes with aligned quotes");
  const notes: HeroNote[] = [];
  for (const n of picked) {
    const note = noteTextFrom(await call("get_note", { ...PASSAGE, id: n.id }));
    if (!note) fail(`note ${n.id} has no text`);
    notes.push({ ...n, note });
  }
  const counts = heroCounts(index, await call("get_questions", { ...PASSAGE }));
  if (!counts.notes) fail("the index lists no notes");

  const verseOf = (role: string) =>
    stripVerseNumber(String(versions.find((v) => v.role === role)?.text ?? ""));
  const verse = {
    original: verseOf("original"),
    translation: verseOf("literal"),
  };
  if (!verse.original || !verse.translation)
    fail("the verse is missing a version");

  const snapshot: HomeSnapshot = {
    ...excerpts,
    hero: { notes, counts },
    verse,
    capturedAt: new Date().toISOString().slice(0, 10),
    origin,
  };
  writeFileSync(out, JSON.stringify(snapshot, null, "\t") + "\n");
  console.log(`Wrote ${out.pathname}`);
}

main().then(
  // The server may keep a stream open; nothing else is left to wait for.
  () => process.exit(0),
  (err) => fail(err instanceof Error ? err.message : String(err)),
);
