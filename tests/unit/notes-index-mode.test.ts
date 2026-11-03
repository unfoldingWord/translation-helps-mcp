/**
 * Public notes and word-link routes.
 * A book alone stays 400. fields=index is the compact read the v3 index uses:
 * no note bodies, no quote alignment, and the same /api/v1 rate limit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOTES_ZIP = "https://example.test/tn.zip";
const LINKS_ZIP = "https://example.test/twl.zip";

const NOTES_TSV = [
  "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote",
  "front:intro\tbook\t\t\t\t1\t# Introduction to Jonah\\n\\nSECRET BODY",
  "1:1\ta\t\trc://*/ta/man/translate/figs-metaphor\tword of\t1\tSECRET NOTE BODY",
].join("\n");

const LINKS_TSV = [
  "Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink",
  "1:1\tw1\t\tcovenant\t1\trc://*/tw/dict/bible/kt/covenant",
].join("\n");

const catalog = vi.hoisted(() => ({
  entries: "ready" as "ready" | "none" | "nofile",
  files: new Map<string, string>(),
}));

const alignment = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../../src/api/routes/alignmentHelper.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/api/routes/alignmentHelper.js")
    >();
  return {
    ...actual,
    batchGatewayQuotes: async () => {
      alignment.calls += 1;
      return new Map();
    },
  };
});

vi.mock("@translation-helps/door43", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@translation-helps/door43")>();
  return {
    ...actual,
    getArticleTitleMap: async () => new Map<string, string>(),
    resolveCatalogLanguage: async (
      lang: string,
      opts?: { subject?: string },
    ) => {
      if (catalog.entries === "none") return { language: lang, entries: [] };
      const links = /Words Links/i.test(opts?.subject ?? "");
      const zip = links ? LINKS_ZIP : NOTES_ZIP;
      return {
        language: lang,
        entries: [
          {
            owner: "unfoldingWord",
            repo: links ? "en_twl" : "en_tn",
            name: links ? "en_twl" : "en_tn",
            subject: opts?.subject,
            ingredients: [],
            catalog: {
              prod: {
                zipball_url:
                  catalog.entries === "nofile"
                    ? "https://example.test/missing.zip"
                    : zip,
              },
            },
          },
        ],
      };
    },
    ZipResourceFetcher2: class {
      lastCacheSource = "memory" as const;
      async getFileText(url: string): Promise<string | null> {
        return catalog.files.get(url) ?? null;
      }
    },
  };
});

import { handleNotes } from "../../src/api/routes/notes.js";
import { handleWordLinks } from "../../src/api/routes/wordLinks.js";
import { responseCacheKey } from "../../src/api/routes/responseCache.js";
import worker, { type Env } from "../../src/api/worker.js";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit.js";

function routeUrl(path: string, query: Record<string, string>): URL {
  const url = new URL(`https://example.test${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function read(response: Response): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  return { status: response.status, body: await response.json() };
}

const ctx = {
  env: {} as never,
  execCtx: {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext,
};

beforeEach(() => {
  catalog.entries = "ready";
  catalog.files.clear();
  catalog.files.set(NOTES_ZIP, NOTES_TSV);
  catalog.files.set(LINKS_ZIP, LINKS_TSV);
  alignment.calls = 0;
  resetRateLimitStoreForTests();
});

describe("GET /api/v1/notes", () => {
  it("rejects a book alone and accepts fields=index without bodies", async () => {
    const bare = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", { reference: "JON", language: "en" }),
      }),
    );
    expect(bare.status).toBe(400);
    expect(bare.body).toMatchObject({
      error: { code: "BAD_REQUEST" },
    });
    expect(JSON.stringify(bare.body)).toMatch(/Invalid reference/);

    const junk = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", {
          reference: "not-a-book",
          language: "en",
          fields: "index",
        }),
      }),
    );
    expect(junk.status).toBe(400);

    const indexed = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", {
          reference: "JON",
          language: "en",
          fields: "index",
        }),
      }),
    );
    expect(indexed.status).toBe(200);
    expect(alignment.calls).toBe(0);
    const notes = indexed.body.notes as Array<Record<string, unknown>>;
    expect(notes.map((row) => row.id)).toEqual(["book", "a"]);
    expect(
      notes.every((row) => !("note" in row) && !("gatewayQuote" in row)),
    ).toBe(true);
    expect(JSON.stringify(indexed.body)).not.toContain("SECRET");
    expect(notes[0]).toMatchObject({
      chapter: "front",
      verse: "intro",
      heading: "Introduction to Jonah",
    });
    expect(notes[1]).toMatchObject({
      id: "a",
      quote: "word of",
      supportReference: "rc://*/ta/man/translate/figs-metaphor",
      supportReferenceTitle: "Figs Metaphor",
    });
  });

  it("still returns bodies and aligns a chapter", async () => {
    const { status, body } = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", { reference: "JON 1", language: "en" }),
      }),
    );
    expect(status).toBe(200);
    expect(alignment.calls).toBe(1);
    const notes = body.notes as Array<Record<string, unknown>>;
    const verse = notes.find((row) => row.id === "a");
    expect(verse?.note).toBe("SECRET NOTE BODY");
    expect(verse).toHaveProperty("gatewayQuote");
  });

  it("answers not available when the catalog has no entry and when the file is missing", async () => {
    catalog.entries = "none";
    const empty = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", { reference: "JON 1", language: "zh" }),
      }),
    );
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      notes: [],
    });

    catalog.entries = "nofile";
    const missing = await read(
      await handleNotes({
        ...ctx,
        url: routeUrl("/api/v1/notes", { reference: "JON 1", language: "zh" }),
      }),
    );
    expect(missing.status).toBe(200);
    expect(missing.body).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      notes: [],
    });
    expect(typeof missing.body.message).toBe("string");
    expect(missing.body.message).not.toBe("");
  });

  it("does not serve a cached full book body for fields=index", async () => {
    const fullKey = responseCacheKey("notes", "en", "JON", "*", undefined);
    const kv = new Map<string, string>([
      [
        fullKey,
        JSON.stringify({
          reference: "JON",
          language: "en",
          book: "JON",
          chapter: "*",
          notes: [{ id: "x", note: "LEAKED BODY", chapter: "1", verse: "1" }],
        }),
      ],
    ]);
    const { status, body } = await read(
      await handleNotes({
        url: routeUrl("/api/v1/notes", {
          reference: "JON",
          language: "en",
          fields: "index",
        }),
        env: {
          TRANSLATION_HELPS_CACHE: {
            get: async (key: string) => kv.get(key) ?? null,
            put: async (key: string, value: string) => {
              kv.set(key, value);
            },
          },
        } as unknown as Env,
        execCtx: ctx.execCtx,
      }),
    );
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("LEAKED BODY");
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
});

describe("GET /api/v1/word-links", () => {
  it("rejects a book alone and returns index rows without alignment", async () => {
    const bare = await read(
      await handleWordLinks({
        ...ctx,
        url: routeUrl("/api/v1/word-links", {
          reference: "JON",
          language: "en",
        }),
      }),
    );
    expect(bare.status).toBe(400);
    expect(JSON.stringify(bare.body)).toMatch(/Invalid reference/);

    const indexed = await read(
      await handleWordLinks({
        ...ctx,
        url: routeUrl("/api/v1/word-links", {
          reference: "Jonah",
          language: "en",
          fields: "index",
        }),
      }),
    );
    expect(indexed.status).toBe(200);
    expect(alignment.calls).toBe(0);
    const links = indexed.body.wordLinks as Array<Record<string, unknown>>;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      origWords: "covenant",
      wordPath: "bible/kt/covenant",
      twTitle: "Covenant",
    });
    expect(links[0]).not.toHaveProperty("gatewayQuote");
  });

  it("does not serve a cached full book payload for fields=index", async () => {
    const fullKey = responseCacheKey("word-links", "en", "JON", "*", undefined);
    const kv = new Map<string, string>([
      [
        fullKey,
        JSON.stringify({
          reference: "JON",
          language: "en",
          book: "JON",
          chapter: "*",
          wordLinks: [
            {
              origWords: "LEAKED ALIGNED",
              gatewayQuote: { original: "x", aligned: "LEAKED ALIGNED" },
            },
          ],
        }),
      ],
    ]);
    const { status, body } = await read(
      await handleWordLinks({
        url: routeUrl("/api/v1/word-links", {
          reference: "JON",
          language: "en",
          fields: "index",
        }),
        env: {
          TRANSLATION_HELPS_CACHE: {
            get: async (key: string) => kv.get(key) ?? null,
            put: async (key: string, value: string) => {
              kv.set(key, value);
            },
          },
        } as unknown as Env,
        execCtx: ctx.execCtx,
      }),
    );
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("LEAKED ALIGNED");
    expect(alignment.calls).toBe(0);
  });

  it("still aligns a chapter", async () => {
    const { status, body } = await read(
      await handleWordLinks({
        ...ctx,
        url: routeUrl("/api/v1/word-links", {
          reference: "JON 1",
          language: "en",
        }),
      }),
    );
    expect(status).toBe(200);
    expect(alignment.calls).toBe(1);
    const links = body.wordLinks as Array<Record<string, unknown>>;
    expect(links[0]).toHaveProperty("gatewayQuote");
    expect(links[0]?.origWords).toBe("covenant");
  });
});

describe("fields=index rate limit", () => {
  it("counts fields=index in the same /api/v1 window", async () => {
    // /notes is edge-cached. Node has no Worker `caches` global; an empty
    // default makes the route run the handler instead of throwing.
    (globalThis as { caches?: { default?: Cache } }).caches = {};
    const headers = { "CF-Connecting-IP": "203.0.113.52" };
    const env = { RATE_LIMIT_RPM: "1" } as Env;
    const exec = ctx.execCtx;
    const first = await worker.fetch(
      new Request(
        "https://example.test/api/v1/notes?reference=JON&language=en",
        { headers },
      ),
      env,
      exec,
    );
    expect(first.status).toBe(400);
    const notes = await worker.fetch(
      new Request(
        "https://example.test/api/v1/notes?reference=JON&language=en&fields=index",
        { headers },
      ),
      env,
      exec,
    );
    expect(notes.status).toBe(429);
    const links = await worker.fetch(
      new Request(
        "https://example.test/api/v1/word-links?reference=JON&language=en&fields=index",
        { headers },
      ),
      env,
      exec,
    );
    expect(links.status).toBe(429);
  });
});
