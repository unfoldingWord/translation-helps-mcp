/**
 * tools/call with no session. Resolution runs through the real API route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({
  zips: new Map<string, Map<string, string>>(),
}));

vi.mock("@translation-helps/door43", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@translation-helps/door43")>();
  return {
    ...actual,
    resolveCatalogLanguage: async (
      lang: string,
      opts?: { subject?: string },
    ) => {
      const academy = /academy/i.test(opts?.subject ?? "");
      const zipUrl = `https://example.test/${lang}-${academy ? "ta" : "tw"}.zip`;
      return {
        language: lang,
        entries: [
          {
            owner: "unfoldingWord",
            repo: academy ? `${lang}_ta` : `${lang}_tw`,
            name: academy ? `${lang}_ta` : `${lang}_tw`,
            subject: opts?.subject,
            ingredients: [],
            catalog: { prod: { zipball_url: zipUrl } },
          },
        ],
      };
    },
    ZipResourceFetcher2: class {
      async getOrDownloadZip(url: string): Promise<Uint8Array> {
        return new TextEncoder().encode(url);
      }
      listZipEntries(zip: Uint8Array): string[] {
        const url = new TextDecoder().decode(zip);
        return [...(catalog.zips.get(url)?.keys() ?? [])];
      }
      async extractFileFromZip(
        zip: Uint8Array,
        path: string,
      ): Promise<string | null> {
        const url = new TextDecoder().decode(zip);
        const files = catalog.zips.get(url);
        if (!files) return null;
        for (const [name, text] of files) {
          if (name === path || name.endsWith(`/${path}`)) return text;
        }
        return null;
      }
    },
  };
});

import { EN_TW_ZIP, fillArticleZips } from "../fixtures/articleZips.js";
import { clearArticleCatalogCacheForTests } from "../../src/api/routes/articleCatalog.js";
import { handleWordsPath } from "../../src/api/routes/words.js";
import { handleAcademyPath } from "../../src/api/routes/academy.js";
import { handleSearch } from "../../src/api/routes/search.js";
import worker, { type Env } from "../../src/worker.js";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit.js";

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

beforeEach(() => {
  catalog.zips.clear();
  fillArticleZips(catalog.zips);
  clearArticleCatalogCacheForTests();
  resetRateLimitStoreForTests();
});

function env(): Env {
  return {
    MCP_AGENT: new Proxy(
      {},
      {
        get() {
          throw new Error("stateless call opened a session");
        },
      },
    ),
    ANALYTICS: { writeDataPoint() {} },
    API: {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const request =
          typeof input === "string" || input instanceof URL
            ? new Request(input, init)
            : new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname.startsWith("/api/v1/words/")) {
          return handleWordsPath({
            url,
            env: {} as never,
            pathParam: decodeURIComponent(
              url.pathname.slice("/api/v1/words/".length),
            ),
          });
        }
        if (url.pathname.startsWith("/api/v1/academy/")) {
          return handleAcademyPath({
            url,
            env: {} as never,
            pathParam: decodeURIComponent(
              url.pathname.slice("/api/v1/academy/".length),
            ),
          });
        }
        if (url.pathname === "/api/v1/search") {
          return handleSearch({ url, env: {} as never });
        }
        return Response.json(
          { error: { code: "NOT_FOUND", message: url.pathname } },
          { status: 404 },
        );
      },
    },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    RATE_LIMIT_RPM: "0",
  } as unknown as Env;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{
  session: string | null;
  body: {
    result?: {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    error?: { message?: string };
  };
}> {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    env(),
    {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as never,
  );
  return {
    session: response.headers.get("mcp-session-id"),
    body: await response.json(),
  };
}

describe("get_word_article tools/call without a session", () => {
  it("resolves bible/other/sheol to the Hades article", async () => {
    const { session, body } = await callTool("get_word_article", {
      path: "bible/other/sheol",
      language: "en",
    });
    expect(session).toBeNull();
    expect(body.error).toBeUndefined();
    expect(body.result?.isError).not.toBe(true);
    expect(body.result?.structuredContent).toMatchObject({
      path: "bible/kt/hades",
      resolvedFrom: "title",
      title: "Hades, Sheol",
      requestedPath: "bible/other/sheol",
    });
  });

  it("soft-fails a miss and rejects an unsafe path", async () => {
    const miss = await callTool("get_word_article", {
      path: "not-a-term",
      language: "en",
    });
    expect(miss.body.result?.isError).toBe(false);
    expect(miss.body.result?.structuredContent).toMatchObject({
      code: "RESOURCE_NOT_AVAILABLE",
    });

    const unsafe = await callTool("get_word_article", {
      path: "../secret",
      language: "en",
    });
    expect(unsafe.body.result?.isError).toBe(true);
  });

  it("returns candidates for an ambiguous name, without a session", async () => {
    const { session, body } = await callTool("get_word_article", {
      path: "paul",
      language: "en",
    });
    expect(session).toBeNull();
    expect(body.result?.isError).toBe(false);
    expect(body.result?.structuredContent).toMatchObject({
      available: false,
      candidates: [
        { path: "bible/names/paul", title: "Paul" },
        { path: "bible/other/paul", title: "Paul (other)" },
      ],
    });
  });

  it("resolves a multi-word term to the file name, without a session", async () => {
    const phrase = await callTool("get_word_article", {
      path: "son of god",
      language: "en",
    });
    expect(phrase.session).toBeNull();
    expect(phrase.body.result?.isError).not.toBe(true);
    expect(phrase.body.result?.structuredContent).toMatchObject({
      path: "bible/kt/sonofgod",
      title: "Son of God, the Son",
      resolvedFrom: "category",
    });
  });

  it("resolves son's on this fixture, where only one title contains the word son", async () => {
    // The zip has "Son of God, the Son" and "sons of God". The second title
    // does not contain the word "son", so the possessive resolves. Published
    // English TW has several titles with that word; the next test covers that.
    const possessive = await callTool("get_word_article", {
      path: "son's",
      language: "en",
    });
    expect(possessive.session).toBeNull();
    expect(possessive.body.result?.isError).toBe(false);
    expect(possessive.body.result?.structuredContent).toMatchObject({
      path: "bible/kt/sonofgod",
      title: "Son of God, the Son",
      resolvedFrom: "partial",
      note: "Partial title match.",
      requestedPath: "son's",
    });
  });

  it("returns candidates for son's when several titles contain the word son", async () => {
    const files = catalog.zips.get(EN_TW_ZIP);
    files?.set("en_tw/bible/kt/sonofman.md", "# Son of Man, son of man\n");
    files?.set(
      "en_tw/bible/names/jamessonofalphaeus.md",
      "# James, son of Alphaeus\n",
    );
    files?.set("en_tw/bible/other/offspring.md", "# the son, sons\n");
    clearArticleCatalogCacheForTests();

    const { session, body } = await callTool("get_word_article", {
      path: "son's",
      language: "en",
    });
    const content = body.result?.structuredContent;
    const candidates = content?.candidates as Array<{
      path: string;
      title: string;
    }>;
    expect(session).toBeNull();
    expect(body.result?.isError).toBe(false);
    expect(content).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      requestedPath: "son's",
    });
    expect(content?.path).toBeUndefined();
    expect(candidates[0]).toEqual({
      path: "bible/kt/sonofgod",
      title: "Son of God, the Son",
    });
    expect(candidates.map((item) => item.path)).not.toContain(
      "bible/kt/sonsofgod",
    );
  });

  it("accepts resourceType as an alias of types", async () => {
    const { body } = await callTool("search_articles", {
      query: "metaphor",
      resourceType: "ta",
      language: "en",
    });
    const results = body.result?.structuredContent?.results as Array<{
      path: string;
      resourceType: string;
      score: number;
    }>;
    expect(results[0]).toMatchObject({
      path: "translate/figs-metaphor",
      resourceType: "ta",
      score: 1,
    });
    expect(results.every((item) => item.resourceType === "ta")).toBe(true);
  });
});
