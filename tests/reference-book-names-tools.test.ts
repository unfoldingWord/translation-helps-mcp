/**
 * Integration: tools must accept full book names (not only 3-letter codes).
 * - English: "John 3:16" ≈ "JHN 3:16"
 * - es / es-419: "Juan 3:16" ≈ "JHN 3:16" with the same `language`
 * - pt-br: "João 3:16" ≈ "JHN 3:16"
 *
 * Skips when no API is up (default http://127.0.0.1:8174, override with TEST_BASE_URL).
 * Do not use Vite’s BASE_URL (often `/`); that breaks health checks. Start: `cd ui && npm run dev`
 */

import { beforeAll, describe, expect, it } from "vitest";
import { TestClient, extractMCPText } from "./helpers/test-client";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8174";

const client = new TestClient(baseUrl.replace(/\/$/, ""));

let serverUp = false;

beforeAll(async () => {
  try {
    await client.waitForServer(12_000);
    serverUp = true;
  } catch {
    serverUp = false;
    // eslint-disable-next-line no-console
    console.warn(
      `[skip] reference-book-names-tools: no server at ${baseUrl} (cd ui && npm run dev)`,
    );
  }
}, 20_000);

function firstScriptureText(data: unknown): string {
  const o = data as { scripture?: Array<{ text?: string }> };
  return String(o?.scripture?.[0]?.text ?? "");
}

function verseNotesLen(data: unknown): number {
  const o = data as { verseNotes?: unknown[] };
  return o?.verseNotes?.length ?? 0;
}

function tqItemsLen(data: unknown): number {
  const o = data as { items?: unknown[] };
  return o?.items?.length ?? 0;
}

function twlItemsLen(data: unknown): number {
  const o = data as { items?: unknown[] };
  return o?.items?.length ?? 0;
}

function parseMcpJson(mcp: { content?: Array<{ text?: string }> }): unknown {
  return JSON.parse(extractMCPText(mcp));
}

describe("Reference book names: REST + MCP", () => {
  it("REST fetch-scripture: John 3:16 matches JHN 3:16 (en)", async () => {
    if (!serverUp) return;
    const a = await client.callREST("fetch-scripture", {
      reference: "John 3:16",
      language: "en",
    });
    const b = await client.callREST("fetch-scripture", {
      reference: "JHN 3:16",
      language: "en",
    });
    expect(firstScriptureText(a).length).toBeGreaterThan(20);
    expect(firstScriptureText(a)).toBe(firstScriptureText(b));
  }, 60_000);

  it("REST fetch-translation-* : English name matches code", async () => {
    if (!serverUp) return;
    const [notesA, notesB, tqA, tqB, twlA, twlB] = await Promise.all([
      client.callREST("fetch-translation-notes", {
        reference: "John 3:16",
        language: "en",
      }),
      client.callREST("fetch-translation-notes", {
        reference: "JHN 3:16",
        language: "en",
      }),
      client.callREST("fetch-translation-questions", {
        reference: "John 3:16",
        language: "en",
      }),
      client.callREST("fetch-translation-questions", {
        reference: "JHN 3:16",
        language: "en",
      }),
      client.callREST("fetch-translation-word-links", {
        reference: "John 3:16",
        language: "en",
      }),
      client.callREST("fetch-translation-word-links", {
        reference: "JHN 3:16",
        language: "en",
      }),
    ]);
    expect(verseNotesLen(notesA)).toBe(verseNotesLen(notesB));
    expect(tqItemsLen(tqA)).toBe(tqItemsLen(tqB));
    expect(twlItemsLen(twlA)).toBe(twlItemsLen(twlB));
  }, 90_000);

  it("REST: Spanish Juan vs JHN (es); es-419 notes; pt-br TWL; Génesis (es)", async () => {
    if (!serverUp) return;
    const [sEsA, sEsB] = await Promise.all([
      client.callREST("fetch-scripture", {
        reference: "Juan 3:16",
        language: "es",
      }),
      client.callREST("fetch-scripture", {
        reference: "JHN 3:16",
        language: "es",
      }),
    ]);
    expect(firstScriptureText(sEsA)).toBe(firstScriptureText(sEsB));

    const [nA, nB] = await Promise.all([
      client.callREST("fetch-translation-notes", {
        reference: "Juan 3:16",
        language: "es-419",
      }),
      client.callREST("fetch-translation-notes", {
        reference: "JHN 3:16",
        language: "es-419",
      }),
    ]);
    expect(verseNotesLen(nA)).toBe(verseNotesLen(nB));

    const [tA, tB] = await Promise.all([
      client.callREST("fetch-translation-word-links", {
        reference: "João 3:16",
        language: "pt-br",
      }),
      client.callREST("fetch-translation-word-links", {
        reference: "JHN 3:16",
        language: "pt-br",
      }),
    ]);
    expect(twlItemsLen(tA)).toBe(twlItemsLen(tB));

    const [gA, gB] = await Promise.all([
      client.callREST("fetch-scripture", {
        reference: "Génesis 1:1",
        language: "es",
      }),
      client.callREST("fetch-scripture", {
        reference: "GEN 1:1",
        language: "es",
      }),
    ]);
    expect(firstScriptureText(gA)).toBe(firstScriptureText(gB));
  }, 120_000);

  it("MCP fetch_scripture + fetch_translation_notes: name vs code", async () => {
    if (!serverUp) return;
    const s1 = await client.callMCPTool({
      name: "fetch_scripture",
      arguments: { reference: "John 3:16", language: "en" },
    });
    const s2 = await client.callMCPTool({
      name: "fetch_scripture",
      arguments: { reference: "JHN 3:16", language: "en" },
    });
    const js1 = parseMcpJson(s1) as { scripture?: Array<{ text?: string }> };
    const js2 = parseMcpJson(s2) as { scripture?: Array<{ text?: string }> };
    expect(js1?.scripture?.[0]?.text).toBe(js2?.scripture?.[0]?.text);

    const s3 = await client.callMCPTool({
      name: "fetch_scripture",
      arguments: { reference: "Juan 3:16", language: "es" },
    });
    const s4 = await client.callMCPTool({
      name: "fetch_scripture",
      arguments: { reference: "JHN 3:16", language: "es" },
    });
    const js3 = parseMcpJson(s3) as { scripture?: Array<{ text?: string }> };
    const js4 = parseMcpJson(s4) as { scripture?: Array<{ text?: string }> };
    expect(js3?.scripture?.[0]?.text).toBe(js4?.scripture?.[0]?.text);

    const n1 = await client.callMCPTool({
      name: "fetch_translation_notes",
      arguments: { reference: "John 3:16", language: "en" },
    });
    const n2 = await client.callMCPTool({
      name: "fetch_translation_notes",
      arguments: { reference: "JHN 3:16", language: "en" },
    });
    const jn1 = parseMcpJson(n1) as { verseNotes?: unknown[] };
    const jn2 = parseMcpJson(n2) as { verseNotes?: unknown[] };
    expect(jn1?.verseNotes?.length).toBe(jn2?.verseNotes?.length);
  }, 120_000);
});
