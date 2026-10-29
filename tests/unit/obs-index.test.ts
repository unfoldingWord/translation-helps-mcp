/**
 * OBS word links route and get_obs_index (#56).
 *
 * Fixture rows: 1:1, 1:3, a second 1:3 term, and 2:1.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { strictToolSchema } from "../../src/mcp/jsonSchema.js";

const SAMPLE_TWL_TSV = [
  "Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink",
  "1:1\ta1\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god",
  "1:3\tb1\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god",
  "1:3\tb2\tkeyterm\tcreate\t1\trc://*/tw/dict/bible/kt/create",
  "2:1\tc1\tkeyterm\tNoah\t1\trc://*/tw/dict/bible/kt/noah",
].join("\n");

const SAMPLE_TN_TSV = [
  "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote",
  "1:1\tn1\t\trc://*/ta/man/translate/figs-metaphor\tGod\t1\tBODY one must not leak",
  "1:3\tn3\t\trc://*/ta/man/translate/figs-idiom\theaven\t1\tBODY three must not leak",
  "2:1\tn2\t\t\tflood\t1\tBODY two must not leak",
].join("\n");

const catalog = vi.hoisted(() => ({
  zips: new Map<string, Map<string, string>>(),
  files: new Map<string, string>(),
  titles: new Map<string, string>([
    ["bible/kt/god", "God"],
    ["bible/kt/create", "Create (verb)"],
    ["bible/kt/noah", "Noah"],
  ]),
  failNotes: false,
  failWordLinks: false,
}));

vi.mock("@translation-helps/door43", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@translation-helps/door43")>();
  return {
    ...actual,
    resolveCatalogLanguage: async (lang: string) => ({
      language: lang,
      entries: [],
    }),
    getArticleTitleMap: async () => catalog.titles,
    getResourceZipUrl: async (lang: string, subject: string) => {
      const bySubject = catalog.zips.get(lang);
      if (!bySubject) return null;
      const preferred = subject.includes(",")
        ? subject.split(",")[0]!.trim()
        : subject;
      const zipUrl =
        bySubject.get(preferred) ??
        bySubject.get(subject) ??
        [...bySubject.entries()].find(([s]) =>
          subject.split(",").some((p) => p.trim() === s),
        )?.[1];
      if (!zipUrl) return null;
      return {
        zipUrl,
        entry: {
          owner: "unfoldingWord",
          repo: `${lang}_obs-twl`,
          name: `${lang}_obs-twl`,
          ingredients: [],
          catalog: { prod: { zipball_url: zipUrl } },
        },
      };
    },
    ZipResourceFetcher2: class {
      async getOrDownloadZip(url: string): Promise<Uint8Array> {
        return new TextEncoder().encode(url);
      }
      async extractFileFromZip(
        _zip: Uint8Array,
        path: string,
      ): Promise<string | null> {
        return (
          catalog.files.get(path) ??
          catalog.files.get(path.toLowerCase()) ??
          null
        );
      }
    },
  };
});

import {
  handleObsNotes,
  handleObsWordLinks,
} from "../../src/api/routes/obs.js";
import { getObsIndexTool } from "../../src/mcp/tools/getObsIndex.js";

const TWL_SUBJECT = "TSV OBS Translation Words Links";
const TN_SUBJECT = "TSV OBS Translation Notes";

function putSubject(language: string, subject: string, zipName: string): void {
  const zip = `https://example.test/${language}-${zipName}.zip`;
  const bySubject = catalog.zips.get(language) ?? new Map();
  bySubject.set(subject, zip);
  catalog.zips.set(language, bySubject);
}

beforeEach(() => {
  catalog.zips.clear();
  catalog.files.clear();
  catalog.failNotes = false;
  catalog.failWordLinks = false;
  catalog.titles.clear();
  catalog.titles.set("bible/kt/god", "God");
  catalog.titles.set("bible/kt/create", "Create (verb)");
  catalog.titles.set("bible/kt/noah", "Noah");
  catalog.files.set("twl_OBS.tsv", SAMPLE_TWL_TSV);
  catalog.files.set("tn_OBS.tsv", SAMPLE_TN_TSV);
  putSubject("en", TWL_SUBJECT, "obs-twl");
  putSubject("en", TN_SUBJECT, "obs-tn");
  putSubject("notesonly", TN_SUBJECT, "obs-tn");
  putSubject("linksonly", TWL_SUBJECT, "obs-twl");
});

async function getJson(
  reference: string,
  language: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handleObsWordLinks({
    url: new URL(
      `http://internal/api/v1/obs-word-links?reference=${encodeURIComponent(reference)}&language=${encodeURIComponent(language)}`,
    ),
    env: {} as never,
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

type WordRow = {
  reference: string;
  id: string;
  origWords: string;
  twArticle: { path: string; category: string; title: string } | null;
};

function wordsOf(body: Record<string, unknown>): WordRow[] {
  return body.words as WordRow[];
}

describe("GET /api/v1/obs-word-links", () => {
  it("1:3 returns the two 1:3 rows", async () => {
    const { status, body } = await getJson("1:3", "en");
    expect(status).toBe(200);
    expect(body.available).not.toBe(false);
    const words = wordsOf(body);
    expect(words.map((w) => w.id)).toEqual(["b1", "b2"]);
    expect(words.map((w) => w.reference)).toEqual(["1:3", "1:3"]);
  });

  it("1:1-3 returns 1:1 and both 1:3 rows", async () => {
    const { body } = await getJson("1:1-3", "en");
    expect(wordsOf(body).map((w) => w.id)).toEqual(["a1", "b1", "b2"]);
  });

  it("1 returns the three story 1 rows", async () => {
    const { body } = await getJson("1", "en");
    expect(wordsOf(body).map((w) => w.id)).toEqual(["a1", "b1", "b2"]);
  });

  it("a language without the resource is available: false", async () => {
    const { status, body } = await getJson("1:3", "zz");
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.code).toBe("RESOURCE_NOT_AVAILABLE");
    expect(String(body.message)).toMatch(/OBS Translation Words Links/i);
    expect(String(body.message)).toMatch(/zz/);
  });

  it("takes twArticle.path from the TWLink and the article title from the TW catalog", async () => {
    const { body } = await getJson("1:3", "en");
    const create = wordsOf(body).find((w) => w.id === "b2");
    expect(create?.twArticle).toEqual({
      path: "bible/kt/create",
      category: "kt",
      title: "Create (verb)",
    });
  });
});

async function callIndex(
  reference: string,
  language: string,
): Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text: string }>;
}> {
  const api = {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(href);
      if (url.pathname.endsWith("/obs-notes") && catalog.failNotes) {
        return new Response(
          JSON.stringify({
            error: {
              code: "UPSTREAM",
              message: "zip download failed",
              retryable: true,
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname.endsWith("/obs-word-links") && catalog.failWordLinks) {
        return new Response(
          JSON.stringify({
            error: {
              code: "UPSTREAM",
              message: "word links zip failed",
              retryable: true,
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      const handler = url.pathname.endsWith("/obs-word-links")
        ? handleObsWordLinks
        : url.pathname.endsWith("/obs-notes")
          ? handleObsNotes
          : null;
      if (!handler) return new Response("{}", { status: 404 });
      return handler({
        url: new URL(`http://internal${url.pathname}?${url.searchParams}`),
        env: {} as never,
      });
    },
  };
  return (await getObsIndexTool.handler(
    { reference, language },
    { API: api } as never,
    "test",
  )) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type: string; text: string }>;
  };
}

describe("get_obs_index", () => {
  it("dedupes keyTerms by path and counts them", async () => {
    const result = await callIndex("1:1-3", "en");
    expect(result.isError).not.toBe(true);
    const terms = result.structuredContent?.keyTerms as Array<{
      path: string;
      count: number;
      frames: string[];
    }>;
    const god = terms.find((t) => t.path === "bible/kt/god");
    expect(god).toMatchObject({
      path: "bible/kt/god",
      count: 2,
      frames: ["1:1", "1:3"],
    });
    expect(terms.filter((t) => t.path === "bible/kt/god")).toHaveLength(1);
  });

  it("reads twArticle.path bible/kt/god from rc://*/tw/dict/bible/kt/god", async () => {
    const result = await callIndex("1:1", "en");
    const words = result.structuredContent?.words as WordRow[];
    expect(words[0]?.twArticle?.path).toBe("bible/kt/god");
  });

  it("returns compact notes with no note body", async () => {
    const result = await callIndex("1:3", "en");
    const notes = result.structuredContent?.notes as Array<
      Record<string, unknown>
    >;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      reference: "1:3",
      id: "n3",
      quote: "heaven",
      occurrence: "1",
      taArticle: { path: "translate/figs-idiom", title: "Figs Idiom" },
    });
    expect(notes[0]).not.toHaveProperty("note");
    expect(JSON.stringify(notes)).not.toContain("must not leak");
  });

  it("returns notes when the language has no key terms", async () => {
    const result = await callIndex("1:3", "notesonly");
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.available).not.toBe(false);
    const notes = result.structuredContent?.notes as unknown[];
    const words = result.structuredContent?.words as unknown[];
    expect(notes.length).toBeGreaterThan(0);
    expect(words).toEqual([]);
    expect(String(result.structuredContent?.message)).toMatch(
      /Translation Words Links|key terms/i,
    );
  });

  it("returns key terms when the language has no notes", async () => {
    const result = await callIndex("1:3", "linksonly");
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.available).not.toBe(false);
    const notes = result.structuredContent?.notes as unknown[];
    const words = result.structuredContent?.words as WordRow[];
    expect(notes).toEqual([]);
    expect(words.map((w) => w.id)).toEqual(["b1", "b2"]);
    expect(String(result.structuredContent?.message)).toMatch(
      /Translation Notes/i,
    );
  });

  it("is not available when neither notes nor key terms exist", async () => {
    const result = await callIndex("1:3", "zz");
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.available).toBe(false);
    expect(result.structuredContent?.code).toBe("RESOURCE_NOT_AVAILABLE");
  });

  it("says notes failed when the notes fetch errors and word links succeed", async () => {
    catalog.failNotes = true;
    const result = await callIndex("1:3", "en");
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.available).not.toBe(false);
    const words = result.structuredContent?.words as WordRow[];
    expect(words.map((w) => w.id)).toEqual(["b1", "b2"]);
    expect(result.structuredContent?.notes).toEqual([]);
    expect(result.structuredContent?.notesError).toBe("zip download failed");
    const message = String(result.structuredContent?.message ?? "");
    expect(message).toMatch(/fail/i);
    expect(message).not.toMatch(/not available/i);
    const summary = result.content?.[0]?.text ?? "";
    expect(summary).toMatch(/fail/i);
    expect(summary).not.toMatch(/not available/i);
  });

  it("says word links failed when the word-links fetch errors and notes succeed", async () => {
    catalog.failWordLinks = true;
    const result = await callIndex("1:3", "en");
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.available).not.toBe(false);
    const notes = result.structuredContent?.notes as Array<
      Record<string, unknown>
    >;
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).not.toHaveProperty("note");
    expect(result.structuredContent?.words).toEqual([]);
    expect(result.structuredContent?.wordLinksError).toBe(
      "word links zip failed",
    );
    expect(result.structuredContent?.notesError).toBeUndefined();
    const message = String(result.structuredContent?.message ?? "");
    expect(message).toMatch(/fail/i);
    expect(message).not.toMatch(/not available/i);
    const summary = result.content?.[0]?.text ?? "";
    expect(summary).toMatch(/fail/i);
    expect(summary).not.toMatch(/not available/i);
  });

  it("keeps both reasons when notes and word links both fail", async () => {
    catalog.failNotes = true;
    catalog.failWordLinks = true;
    let thrown: unknown;
    try {
      await callIndex("1:3", "en");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain("zip download failed");
    expect(message).toContain("word links zip failed");
  });

  it("uses the catalog TA title when it differs from the slug", async () => {
    catalog.titles.set("translate/figs-idiom", "Idiom");
    const result = await callIndex("1:3", "en");
    const notes = result.structuredContent?.notes as Array<{
      taArticle: { path: string; title: string } | null;
    }>;
    expect(notes[0]?.taArticle).toEqual({
      path: "translate/figs-idiom",
      title: "Idiom",
    });
  });
});

describe("get_obs_index over the MCP transport", () => {
  it("tools/call succeeds for en 1:3 and tools/list has 16 tools", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    for (const tool of MCP_TOOLS) {
      const shape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: strictToolSchema(shape),
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        },
        async (raw: unknown) => {
          if (tool.name !== "get_obs_index") {
            return { content: [{ type: "text" as const, text: "ok" }] };
          }
          const api = {
            async fetch(input: RequestInfo | URL): Promise<Response> {
              const href =
                typeof input === "string"
                  ? input
                  : input instanceof URL
                    ? input.href
                    : input.url;
              const url = new URL(href);
              const handler = url.pathname.endsWith("/obs-word-links")
                ? handleObsWordLinks
                : url.pathname.endsWith("/obs-notes")
                  ? handleObsNotes
                  : null;
              if (!handler) return new Response("{}", { status: 404 });
              return handler({
                url: new URL(
                  `http://internal${url.pathname}?${url.searchParams}`,
                ),
                env: {} as never,
              });
            },
          };
          return tool.handler(
            raw as { reference: string; language: string },
            { API: api } as never,
            "contract",
          );
        },
      );
    }

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "probe", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(16);
    const definition = listed.tools.find((t) => t.name === "get_obs_index");
    expect(definition).toBeDefined();
    expect(JSON.stringify(definition).length).toBeGreaterThan(100);
    const referenceField = (
      MCP_TOOLS.find((t) => t.name === "get_obs_index")?.inputSchema as
        | z.ZodObject<z.ZodRawShape>
        | undefined
    )?.shape.reference as z.ZodTypeAny | undefined;
    const referenceDesc = referenceField?.description ?? "";
    expect(referenceDesc).toContain(
      "`story` and `frame` as separate numbers are also accepted.",
    );

    const called = await client.callTool({
      name: "get_obs_index",
      arguments: { reference: "1:3", language: "en" },
    });
    expect(called.isError).not.toBe(true);
    const structured = called.structuredContent as {
      words?: Array<{ id: string }>;
    };
    expect(structured.words?.map((w) => w.id)).toEqual(["b1", "b2"]);
  });
});
