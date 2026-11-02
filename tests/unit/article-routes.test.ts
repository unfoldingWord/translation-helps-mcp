/**
 * Words and Academy routes resolve against a catalog built from zip fixtures.
 * The REST body stays the zip markdown. The MCP tool rewrites links.
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

import { fillArticleZips } from "../fixtures/articleZips.js";
import { clearArticleCatalogCacheForTests } from "../../src/api/routes/articleCatalog.js";
import { handleWordsPath } from "../../src/api/routes/words.js";
import { handleAcademyPath } from "../../src/api/routes/academy.js";
import { handleSearch } from "../../src/api/routes/search.js";
import type { Env as ToolEnv } from "../../src/mcp/agent.js";
import { getWordArticleTool } from "../../src/mcp/tools/getWordArticle.js";
import { getAcademyArticleTool } from "../../src/mcp/tools/getAcademyArticle.js";

function routeUrl(query: Record<string, string>): URL {
  const url = new URL("https://example.test/api/v1/item");
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

beforeEach(() => {
  catalog.zips.clear();
  fillArticleZips(catalog.zips);
  clearArticleCatalogCacheForTests();
});

describe("word and academy routes", () => {
  it("keeps an exact path and does not set resolvedFrom", async () => {
    const { status, body } = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "bible/kt/Covenant.md",
      }),
    );
    expect(status).toBe(200);
    expect(body.path).toBe("bible/kt/covenant");
    expect(body.resolvedFrom).toBeUndefined();
    expect(body.title).toBe("Covenant");
  });

  it("resolves a wrong category, a title, and a plural", async () => {
    const category = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "bible/other/hades",
      }),
    );
    expect(category.body).toMatchObject({
      path: "bible/kt/hades",
      resolvedFrom: "category",
    });

    const title = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "sheol",
      }),
    );
    expect(title.body).toMatchObject({
      path: "bible/kt/hades",
      resolvedFrom: "title",
      title: "Hades, Sheol",
    });
    expect(title.body.article).toContain("../kt/promise.md");
    expect(title.body.article).toContain("rc://en/tn/help/gen/37/35");

    const plural = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "covenants",
      }),
    );
    expect(plural.body).toMatchObject({
      path: "bible/kt/covenant",
      resolvedFrom: "plural",
    });
  });

  it("does not guess when two articles share a name", async () => {
    const { status, body } = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "paul",
      }),
    );
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.code).toBe("RESOURCE_NOT_AVAILABLE");
    expect(body.path).toBeUndefined();
    expect(body.candidates).toEqual([
      { path: "bible/names/paul", title: "Paul" },
      { path: "bible/other/paul", title: "Paul (other)" },
    ]);
  });

  it("resolves a bare term with spaces and does not reject apostrophes", async () => {
    const files = catalog.zips.get("https://example.test/en-tw.zip");
    files?.set("en_tw/bible/kt/arkofthecovenant.md", "# Ark of the Covenant\n");
    files?.set("en_tw/bible/other/godsrightand.md", "# God's Right Hand\n");

    const son = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "son of god",
      }),
    );
    expect(son.status).toBe(200);
    expect(son.body).toMatchObject({
      path: "bible/kt/sonofgod",
      resolvedFrom: "category",
      title: "Son of God, the Son",
    });

    const ark = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "ark of the covenant",
      }),
    );
    expect(ark.status).toBe(200);
    expect(ark.body).toMatchObject({
      path: "bible/kt/arkofthecovenant",
      resolvedFrom: "category",
    });

    const hand = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "right hand",
      }),
    );
    expect(hand.status).toBe(200);
    expect(hand.body).toMatchObject({
      path: "bible/other/godsrightand",
      title: "God's Right Hand",
      resolvedFrom: "partial",
      note: "Partial title match.",
    });

    for (const pathParam of ["son's", "son\u2019s"]) {
      const apostrophe = await read(
        await handleWordsPath({
          url: routeUrl({ language: "en" }),
          env: {} as never,
          pathParam,
        }),
      );
      expect(apostrophe.status, pathParam).toBe(200);
      expect(apostrophe.body, pathParam).toMatchObject({
        path: "bible/kt/sonofgod",
        title: "Son of God, the Son",
        resolvedFrom: "partial",
        note: "Partial title match.",
      });
    }

    const slashed = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "bible/kt/son of god",
      }),
    );
    expect(slashed.status).toBe(400);
    expect(slashed.body).toMatchObject({
      error: { code: "INVALID_PARAMS" },
    });
  });

  it("rejects an unsafe path and 404s a miss", async () => {
    const unsafe = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "../secret",
      }),
    );
    expect(unsafe.status).toBe(400);
    expect(unsafe.body).toMatchObject({
      error: { code: "INVALID_PARAMS" },
    });

    const miss = await read(
      await handleWordsPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "not-a-term",
      }),
    );
    expect(miss.status).toBe(404);
  });

  it("matches a Spanish title in the requested language", async () => {
    const { body } = await read(
      await handleWordsPath({
        url: routeUrl({ language: "es-419" }),
        env: {} as never,
        pathParam: "pacto",
      }),
    );
    expect(body).toMatchObject({
      path: "bible/kt/covenant",
      resolvedFrom: "title",
      title: "Pacto, alianza",
    });
  });

  it("resolves an academy slug and an exact title", async () => {
    const slug = await read(
      await handleAcademyPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "figs-metaphor",
      }),
    );
    expect(slug.body).toMatchObject({
      path: "translate/figs-metaphor",
      resolvedFrom: "manual",
      title: "Metaphor",
    });

    const title = await read(
      await handleAcademyPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "metaphor",
      }),
    );
    expect(title.body).toMatchObject({
      path: "translate/figs-metaphor",
      resolvedFrom: "title",
    });
    expect(title.body.article).toContain("../figs-simile/01.md");

    const exact = await read(
      await handleAcademyPath({
        url: routeUrl({ language: "en" }),
        env: {} as never,
        pathParam: "translate/figs-metaphor",
      }),
    );
    expect(exact.body.path).toBe("translate/figs-metaphor");
    expect(exact.body.resolvedFrom).toBeUndefined();
  });

  it("ranks an exact title first", async () => {
    const { body } = await read(
      await handleSearch({
        url: routeUrl({ language: "en", q: "metaphor", types: "ta" }),
        env: {} as never,
      }),
    );
    const results = body.results as Array<{ path: string; score: number }>;
    expect(results[0]).toMatchObject({
      path: "translate/figs-metaphor",
      score: 1,
    });
    expect(results[1]?.path).toBe("translate/figs-complexmetaphor");
    expect(results[1]?.score).toBeLessThan(1);
  });
});

describe("MCP article tools", () => {
  function toolEnv(): ToolEnv {
    return {
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
          return Response.json(
            { error: { code: "NOT_FOUND", message: url.pathname } },
            { status: 404 },
          );
        },
      },
    } as ToolEnv;
  }

  it("rewrites links and keeps the note reference", async () => {
    const result = await getWordArticleTool.handler(
      { path: "bible/other/sheol", language: "en" },
      toolEnv(),
      "t",
    );
    const data = result.structuredContent as {
      path: string;
      resolvedFrom: string;
      title: string;
      article: string;
      requestedPath: string;
      related: Array<{ path: string; title: string }>;
    };
    expect(data).toMatchObject({
      path: "bible/kt/hades",
      resolvedFrom: "title",
      title: "Hades, Sheol",
      requestedPath: "bible/other/sheol",
    });
    expect(data.article).toContain("bible/kt/promise");
    expect(data.article).not.toContain("../kt/promise.md");
    expect(data.article).toContain("rc://en/tn/help/gen/37/35");
    expect(data.related).toContainEqual({
      path: "bible/kt/promise",
      title: "Promise",
    });
  });

  it("rewrites an academy link", async () => {
    const result = await getAcademyArticleTool.handler(
      { path: "metaphor", language: "en" },
      toolEnv(),
      "t",
    );
    const data = result.structuredContent as {
      path: string;
      resolvedFrom: string;
      article: string;
    };
    expect(data.path).toBe("translate/figs-metaphor");
    expect(data.resolvedFrom).toBe("title");
    expect(data.article).toContain("translate/figs-simile");
    expect(data.article).not.toContain("../figs-simile/01.md");
  });
});
