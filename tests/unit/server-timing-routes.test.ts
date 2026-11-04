/**
 * Every REST route /v3 calls names the layer that answered.
 * A cache hit and a miss both send Server-Timing, and the header has no
 * path, cache key, or caller text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteContext } from "../../src/api/worker.js";
import { handleLanguages } from "../../src/api/routes/languages.js";
import { handleResources } from "../../src/api/routes/resources.js";
import { handleScripture } from "../../src/api/routes/scripture.js";
import { handleNotes } from "../../src/api/routes/notes.js";
import { handleWordLinks } from "../../src/api/routes/wordLinks.js";
import { handleQuestions } from "../../src/api/routes/questions.js";
import { handleWords } from "../../src/api/routes/words.js";
import { handleAcademy } from "../../src/api/routes/academy.js";
import { handleSearch } from "../../src/api/routes/search.js";
import {
  handleObs,
  handleObsNotes,
  handleObsQuestions,
  handleObsStudyNotes,
  handleObsStudyQuestions,
  handleObsWordLinks,
} from "../../src/api/routes/obs.js";
import {
  cacheVerse,
  responseCacheKey,
} from "../../src/api/routes/responseCache.js";
import { formatServerTiming } from "../../src/api/serverTiming.js";
import { clearArticleCatalogCacheForTests } from "../../src/api/routes/articleCatalog.js";
import {
  clearCatalogProcessCache,
  clearZipCachesForTests,
} from "@translation-helps/door43";

const CATALOG_ENTRY = {
  owner: "unfoldingWord",
  lang: "en",
  repo: "en_tn",
  name: "English notes",
  subject: "TSV Translation Notes",
  abbreviation: "tn",
  ingredients: [],
  catalog: {
    prod: {
      zipball_url: "https://example.test/en.zip",
      branch_or_tag_name: "v1",
    },
  },
};

function envelope(data: unknown): string {
  return JSON.stringify({ fetchedAt: Date.now(), data });
}

function memoryKv(
  seed: Record<string, string> = {},
  warm = false,
): KVNamespace {
  const store = new Map(Object.entries(seed));
  return {
    async get(key: string) {
      if (store.has(key)) return store.get(key) ?? null;
      if (!warm) return null;
      if (key.startsWith("catalog:tw:") || key.startsWith("catalog:ta:")) {
        return seed["catalog:list"] ?? null;
      }
      if (key.startsWith("catalog:list:languages:")) {
        return envelope([{ code: "en", name: "English", direction: "ltr" }]);
      }
      if (
        key.startsWith("catalog:search:") ||
        key.startsWith("catalog:list:")
      ) {
        return seed["catalog:search"] ?? null;
      }
      return null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function call(
  path: string,
  kv: KVNamespace,
  extra: Partial<RouteContext["env"]> = {},
): RouteContext {
  return {
    url: new URL(`https://example.test${path}`),
    env: {
      TRANSLATION_HELPS_CACHE: kv,
      ...extra,
    } as RouteContext["env"],
    execCtx: {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
  };
}

function layer(response: Response): string {
  const header = response.headers.get("Server-Timing") ?? "";
  return /layer;desc="([^"]+)"/.exec(header)?.[1] ?? "";
}

function assertHeader(response: Response, expected: string): void {
  const header = response.headers.get("Server-Timing") ?? "";
  expect(layer(response)).toBe(expected);
  expect(header).toMatch(/total;dur=\d+/);
  expect(header).not.toMatch(/humility|catalog:|resp:|php\//i);
}

const VERSE = "PHP 2:5";
const verseKey = cacheVerse("2", "5");

const routes: Array<{
  name: string;
  path: string;
  hit: Record<string, string>;
  warm?: boolean;
  run: (ctx: RouteContext) => Promise<Response>;
}> = [
  {
    name: "scripture",
    path: `/api/v1/scripture?reference=${encodeURIComponent(VERSE)}&language=en`,
    hit: {
      [responseCacheKey(
        "scripture",
        "en",
        "PHP",
        "2",
        "5",
        "text",
        "primary",
        "lang-book",
      )]: JSON.stringify({ reference: VERSE, language: "en" }),
    },
    run: handleScripture,
  },
  {
    name: "notes",
    path: `/api/v1/notes?reference=${encodeURIComponent(VERSE)}&language=en`,
    hit: {
      [responseCacheKey("notes", "en", "PHP", "2", verseKey)]: JSON.stringify({
        reference: VERSE,
        notes: [],
      }),
    },
    run: handleNotes,
  },
  {
    name: "word-links",
    path: `/api/v1/word-links?reference=${encodeURIComponent(VERSE)}&language=en`,
    hit: {
      [responseCacheKey("word-links", "en", "PHP", "2", verseKey)]:
        JSON.stringify({ reference: VERSE, wordLinks: [] }),
    },
    run: handleWordLinks,
  },
  {
    name: "questions",
    path: `/api/v1/questions?reference=${encodeURIComponent(VERSE)}&language=en`,
    hit: {
      [responseCacheKey("questions", "en", "PHP", "2", "5")]: JSON.stringify({
        reference: VERSE,
        questions: [],
      }),
    },
    run: handleQuestions,
  },
  {
    name: "words",
    path: "/api/v1/words?language=en",
    hit: {
      "catalog:search": envelope([CATALOG_ENTRY]),
      "catalog:list": "[]",
    },
    warm: true,
    run: handleWords,
  },
  {
    name: "academy",
    path: "/api/v1/academy?language=en",
    hit: {
      "catalog:search": envelope([CATALOG_ENTRY]),
      "catalog:list": "[]",
    },
    warm: true,
    run: handleAcademy,
  },
  {
    name: "resources",
    path: "/api/v1/resources?language=en",
    hit: { "catalog:search": envelope([CATALOG_ENTRY]) },
    warm: true,
    run: handleResources,
  },
  {
    name: "languages",
    path: "/api/v1/languages",
    hit: {},
    warm: true,
    run: handleLanguages,
  },
];

describe("Server-Timing on /v3 routes", () => {
  beforeEach(() => {
    clearCatalogProcessCache();
    clearZipCachesForTests();
    clearArticleCatalogCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps caller text out of the header", () => {
    const header = formatServerTiming({
      layer: "pack",
      totalMs: 12.6,
      timings: { catalogMs: 3, total: 9, "php/2": 1, layer: 1 },
    });
    expect(header).toBe('layer;desc="views", total;dur=13, catalogMs;dur=3');
  });

  it.each(routes)("$name answers from kv without fetching", async (route) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`fetch on ${route.name} hit`);
      }),
    );
    const response = await route.run(
      call(route.path, memoryKv(route.hit, route.warm)),
    );
    expect(response.status).toBeLessThan(500);
    assertHeader(response, "kv");
  });

  it.each(routes)("$name misses on an empty catalog", async (route) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [] })),
    );
    const response = await route.run(call(route.path, memoryKv()));
    expect(response.status).toBeLessThan(500);
    assertHeader(response, "network");
  });

  it("reads notes from language-pack views", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("views should not fetch");
      }),
    );
    const view = {
      schema: 1,
      language: "en",
      book: "PHP",
      chapter: 2,
      sources: {},
      notes: [
        {
          id: "n1",
          reference: "2:5",
          verse: 5,
          intro: null,
          quote: "word",
          occurrence: "1",
          note: "A note.",
          tags: "",
          supportReference: "",
          supportReferenceTitle: null,
          aligned: { literal: "word", simple: "word" },
        },
      ],
    };
    const response = await handleNotes(
      call(
        `/api/v1/notes?reference=${encodeURIComponent(VERSE)}&language=en`,
        memoryKv(),
        {
          LANGUAGE_PACKS: {
            async get(key: string) {
              if (key === "v1/en/notes/PHP/2.json") {
                return { json: async () => view };
              }
              return null;
            },
          } as unknown as R2Bucket,
        },
      ),
    );
    expect(response.status).toBe(200);
    assertHeader(response, "views");
  });

  const obs = [
    { name: "obs", run: handleObs },
    { name: "obs-notes", run: handleObsNotes },
    { name: "obs-questions", run: handleObsQuestions },
    { name: "obs-study-notes", run: handleObsStudyNotes },
    { name: "obs-study-questions", run: handleObsStudyQuestions },
    { name: "obs-word-links", run: handleObsWordLinks },
  ];

  it.each(obs)("$name misses then reuses the catalog", async (route) => {
    let fetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetches += 1;
        return Response.json({ data: [] });
      }),
    );
    const kv = memoryKv();
    const path = `/api/v1/${route.name}?reference=1:1&language=en`;
    const first = await route.run(call(path, kv));
    const afterFirst = fetches;
    expect(afterFirst).toBeGreaterThan(0);
    assertHeader(first, "network");
    const second = await route.run(call(path, kv));
    expect(fetches).toBe(afterFirst);
    // The catalog write lands in KV, so the repeat's slowest layer is kv.
    assertHeader(second, "kv");
  });

  it("caches a search and reports kv on the repeat", async () => {
    let fetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetches += 1;
        return Response.json({ data: [] });
      }),
    );
    const kv = memoryKv();
    const path = "/api/v1/search?q=humility&language=en&types=ta,tw&limit=5";
    const first = await handleSearch(call(path, kv));
    const afterFirst = fetches;
    assertHeader(first, "network");
    const second = await handleSearch(call(path, kv));
    expect(fetches).toBe(afterFirst);
    assertHeader(second, "kv");
  });
});
