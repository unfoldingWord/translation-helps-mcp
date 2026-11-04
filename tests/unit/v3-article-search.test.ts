/**
 * th_get_article and th_search call the same words, academy and search
 * routes as v2. The fake API records the URL and returns fixtures.
 */
import { describe, expect, it } from "vitest";
import { rankArticles } from "@translation-helps/door43";
import type { Env } from "../../src/mcp/agent.js";
import { ErrorCode } from "../../src/core/errors.js";
import { VERSION } from "../../src/core/version.js";
import { V3_SERVER_INSTRUCTIONS } from "../../src/mcp/v3/instructions.js";
import { normalizeV3ToolArgs } from "../../src/mcp/v3/normalizeArgs.js";
import { getArticleV3Tool } from "../../src/mcp/v3/tools/getArticle.js";
import {
  SEARCH_DESCRIPTION,
  searchV3Tool,
} from "../../src/mcp/v3/tools/search.js";
import { toJsonSchema, strictToolSchema } from "../../src/mcp/jsonSchema.js";
import { getPassageV3Tool } from "../../src/mcp/v3/tools/getPassage.js";

const COVENANT = [
  "# Covenant",
  "",
  "## Definition:",
  "",
  "A covenant is a solemn agreement.",
  "",
  "## Translation Suggestions:",
  "",
  "Translate covenant as a binding promise.",
  "",
  "See [the promise](../kt/promise.md).",
  "",
  "## Bible References:",
  "",
  "Genesis 15:18 is a reference.",
  "",
].join("\n");

const METAPHOR = [
  "# Metaphor",
  "",
  "### Description",
  "",
  "A metaphor speaks of one thing as another.",
  "",
  "### Examples From the Bible",
  "",
  "Psalm 18:2 calls the Lord a rock.",
  "",
].join("\n");

const SEARCH_CATALOG = [
  {
    path: "translate/figs-complexmetaphor",
    title: "Complex Metaphor",
    category: "translate",
    resourceType: "ta" as const,
  },
  {
    path: "translate/figs-metaphor",
    title: "Metaphor",
    category: "translate",
    resourceType: "ta" as const,
  },
  {
    path: "translate/figs-metonymy",
    title: "Metonymy",
    category: "translate",
    resourceType: "ta" as const,
  },
  {
    path: "bible/kt/covenant",
    title: "Covenant",
    category: "kt",
    resourceType: "tw" as const,
  },
];

function apiEnv(payload: (url: URL) => unknown): { env: Env; calls: URL[] } {
  const calls: URL[] = [];
  const env = {
    API: {
      async fetch(input: RequestInfo | URL) {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const url = new URL(raw);
        calls.push(url);
        const data = await Promise.resolve(payload(url));
        if (data instanceof Response) return data;
        return Response.json(data);
      },
    },
  } as Env;
  return { env, calls };
}

function notFound(): Response {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "missing" } },
    { status: 404 },
  );
}

function hit(
  type: "tw" | "ta",
  path: string,
  title: string,
  article: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    language: "en",
    path,
    title,
    article,
    related: [],
    ...extra,
  };
}

function paths(calls: URL[]): string[] {
  return calls.map((url) => url.pathname);
}

describe("v3 th_get_article", () => {
  it("says a summary keeps the title", () => {
    const published = toJsonSchema(
      strictToolSchema(getArticleV3Tool.inputSchema.shape),
    ) as { properties?: { detail?: { description?: string } } };
    const detail = published.properties?.detail?.description ?? "";
    expect(detail).toMatch(/title/i);
    expect(detail).toMatch(/summary/i);
  });

  it("loads a Translation Words path from the words route only", async () => {
    const { env, calls } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return hit("tw", "bible/kt/covenant", "Covenant", COVENANT, {
          requestedPath: url.searchParams.get("requestedPath"),
          related: [{ path: "bible/kt/promise", title: "Promise" }],
        });
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "bible/kt/covenant", language: "en" },
      env,
      "req",
    );
    expect(paths(calls)).toEqual(["/api/v1/words/bible/kt/covenant"]);
    expect(calls[0]?.searchParams.get("prepared")).toBe("1");
    expect(calls[0]?.searchParams.get("requestedPath")).toBe(
      "bible/kt/covenant",
    );
    expect(result.structuredContent).toMatchObject({
      path: "bible/kt/covenant",
      type: "tw",
      title: "Covenant",
    });
    expect(result.structuredContent?.article).toContain("Genesis 15:18");
    const related = result.structuredContent?.related as Array<{
      path: string;
      next: { tool: string; args: { path: string; language?: string } };
    }>;
    expect(related).toEqual([
      {
        path: "bible/kt/promise",
        title: "Promise",
        next: {
          tool: "th_get_article",
          args: { path: "bible/kt/promise" },
        },
      },
    ]);
  });

  it("loads a Translation Academy path from the academy route only", async () => {
    const { env, calls } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/academy/")) {
        return hit("ta", "translate/figs-metaphor", "Metaphor", METAPHOR, {
          requestedPath: url.searchParams.get("requestedPath"),
        });
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "translate/figs-metaphor", language: "en" },
      env,
      "req",
    );
    expect(paths(calls)).toEqual(["/api/v1/academy/translate/figs-metaphor"]);
    expect(result.structuredContent).toMatchObject({
      path: "translate/figs-metaphor",
      type: "ta",
      title: "Metaphor",
    });
  });

  it("follows an rc:// Translation Words link to the words route", async () => {
    const { env, calls } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return hit("tw", "bible/kt/covenant", "Covenant", COVENANT);
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "rc://*/tw/dict/bible/kt/covenant", language: "en" },
      env,
      "req",
    );
    expect(paths(calls)).toEqual(["/api/v1/words/bible/kt/covenant"]);
    expect(calls[0]?.searchParams.get("requestedPath")).toBe(
      "rc://*/tw/dict/bible/kt/covenant",
    );
    expect(result.structuredContent).toMatchObject({
      type: "tw",
      path: "bible/kt/covenant",
    });
  });

  it("follows an rc:// Translation Academy link to the academy route", async () => {
    const { env, calls } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/academy/")) {
        return hit("ta", "translate/figs-metonymy", "Metonymy", METAPHOR);
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      {
        path: "rc://*/ta/man/translate/figs-metonymy",
        language: "en",
      },
      env,
      "req",
    );
    expect(paths(calls)).toEqual(["/api/v1/academy/translate/figs-metonymy"]);
    expect(result.structuredContent).toMatchObject({
      type: "ta",
      path: "translate/figs-metonymy",
    });
  });

  it("resolves the bare term covenant to Translation Words", async () => {
    const { env, calls } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return hit("tw", "bible/kt/covenant", "Covenant", COVENANT, {
          resolvedFrom: "category",
        });
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "covenant", language: "en" },
      env,
      "req",
    );
    expect(paths(calls).sort()).toEqual([
      "/api/v1/academy/covenant",
      "/api/v1/words/covenant",
    ]);
    expect(result.structuredContent).toMatchObject({
      type: "tw",
      path: "bible/kt/covenant",
      resolvedFrom: "category",
    });
  });

  it("resolves the bare term metaphor to Translation Academy", async () => {
    const { env, calls } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/academy/")) {
        return hit("ta", "translate/figs-metaphor", "Metaphor", METAPHOR, {
          resolvedFrom: "title",
        });
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "metaphor", language: "en" },
      env,
      "req",
    );
    expect(paths(calls).sort()).toEqual([
      "/api/v1/academy/metaphor",
      "/api/v1/words/metaphor",
    ]);
    expect(result.structuredContent).toMatchObject({
      type: "ta",
      path: "translate/figs-metaphor",
      resolvedFrom: "title",
    });
  });

  it("returns both sides as candidates when a term resolves twice", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return hit("tw", "bible/other/call", "Call", COVENANT);
      }
      if (url.pathname.startsWith("/api/v1/academy/")) {
        return hit("ta", "translate/figs-call", "Call", METAPHOR);
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "call", language: "en" },
      env,
      "req",
    );
    const data = result.structuredContent ?? {};
    expect(data.available).toBe(false);
    expect(data.article).toBeUndefined();
    expect(data.otherCandidates).toBeUndefined();
    expect(data.candidates).toEqual([
      {
        path: "bible/other/call",
        title: "Call",
        type: "tw",
        next: { tool: "th_get_article", args: { path: "bible/other/call" } },
      },
      {
        path: "translate/figs-call",
        title: "Call",
        type: "ta",
        next: {
          tool: "th_get_article",
          args: { path: "translate/figs-call" },
        },
      },
    ]);
  });

  it("returns the resolved article when the other catalog is only ambiguous", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return hit("tw", "bible/kt/covenant", "Covenant", COVENANT);
      }
      if (url.pathname.startsWith("/api/v1/academy/")) {
        return {
          available: false,
          candidates: [
            { path: "translate/figs-covenant", title: "Covenant language" },
            { path: "checking/covenant", title: "Covenant check" },
          ],
        };
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "covenant", language: "en" },
      env,
      "req",
    );
    expect(result.structuredContent?.available).toBeUndefined();
    expect(result.structuredContent?.article).toContain("solemn agreement");
    expect(result.structuredContent).toMatchObject({
      path: "bible/kt/covenant",
      type: "tw",
      title: "Covenant",
    });
    expect(result.structuredContent?.candidates).toBeUndefined();
    expect(result.structuredContent?.otherCandidates).toEqual([
      {
        path: "translate/figs-covenant",
        title: "Covenant language",
        type: "ta",
        next: {
          tool: "th_get_article",
          args: { path: "translate/figs-covenant" },
        },
      },
      {
        path: "checking/covenant",
        title: "Covenant check",
        type: "ta",
        next: { tool: "th_get_article", args: { path: "checking/covenant" } },
      },
    ]);
  });

  it("returns the academy article when only Words is ambiguous", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/academy/")) {
        return hit("ta", "translate/figs-metaphor", "Metaphor", METAPHOR);
      }
      if (url.pathname.startsWith("/api/v1/words/")) {
        return {
          available: false,
          candidates: [
            { path: "bible/kt/metaphor", title: "Metaphor" },
            { path: "bible/other/metaphor", title: "Metaphor (other)" },
          ],
        };
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "metaphor", language: "en" },
      env,
      "req",
    );
    expect(result.structuredContent).toMatchObject({
      path: "translate/figs-metaphor",
      type: "ta",
      title: "Metaphor",
    });
    expect(result.structuredContent?.article).toContain("one thing as another");
    expect(result.structuredContent?.candidates).toBeUndefined();
    expect(result.structuredContent?.otherCandidates).toEqual([
      {
        path: "bible/kt/metaphor",
        title: "Metaphor",
        type: "tw",
        next: { tool: "th_get_article", args: { path: "bible/kt/metaphor" } },
      },
      {
        path: "bible/other/metaphor",
        title: "Metaphor (other)",
        type: "tw",
        next: {
          tool: "th_get_article",
          args: { path: "bible/other/metaphor" },
        },
      },
    ]);
  });

  it("keeps one side's candidates when the other side misses", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return {
          available: false,
          code: "RESOURCE_NOT_AVAILABLE",
          message: "Several Translation Words articles match.",
          candidates: [
            { path: "bible/names/paul", title: "Paul" },
            { path: "bible/other/paul", title: "Paul (other)" },
          ],
        };
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "paul", language: "en" },
      env,
      "req",
    );
    expect(result.structuredContent?.available).toBe(false);
    expect(result.structuredContent?.article).toBeUndefined();
    const candidates = result.structuredContent?.candidates as Array<{
      type: string;
      path: string;
    }>;
    expect(candidates.map((item) => `${item.type}:${item.path}`)).toEqual([
      "tw:bible/names/paul",
      "tw:bible/other/paul",
    ]);
  });

  it("says right hand is not available and points at notes", async () => {
    const { env, calls } = apiEnv(() => notFound());
    const result = await getArticleV3Tool.handler(
      { path: "right hand", language: "en" },
      env,
      "req",
    );
    expect(paths(calls).sort()).toEqual([
      "/api/v1/academy/righthand",
      "/api/v1/words/righthand",
    ]);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
    });
    const hints = result.structuredContent?.hints as string[];
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/th_get_passage_index/);
    expect(hints[0]).toMatch(/th_get_notes/);
    expect(hints[0]).not.toMatch(/coming/i);
    expect(result.structuredContent?.candidates ?? []).toEqual([]);
  });

  it("summarizes a Translation Words article to definition and suggestions", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return hit("tw", "bible/kt/covenant", "Covenant", COVENANT, {
          related: [{ path: "bible/kt/promise", title: "Promise" }],
        });
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "bible/kt/covenant", language: "en", detail: "summary" },
      env,
      "req",
    );
    const article = String(result.structuredContent?.article ?? "");
    expect(article).toContain("solemn agreement");
    expect(article).toContain("binding promise");
    expect(article).toContain("Covenant");
    expect(article).not.toContain("Genesis 15:18");
    expect(result.structuredContent?.note).toBeUndefined();
  });

  it("summarizes a Translation Academy article to its question and first section", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/academy/")) {
        return hit("ta", "translate/figs-metaphor", "Metaphor", METAPHOR, {
          subtitle: "What is a metaphor?",
        });
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      {
        path: "translate/figs-metaphor",
        language: "en",
        detail: "summary",
      },
      env,
      "req",
    );
    const article = String(result.structuredContent?.article ?? "");
    expect(article).toContain("What is a metaphor?");
    expect(article).toContain("one thing as another");
    expect(article).not.toContain("Psalm 18:2");
  });

  it("cuts a summary to 1500 characters when the sections are missing", async () => {
    const body = `${"A".repeat(1600)}ENDMARKER`;
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return hit("tw", "bible/kt/covenant", "Covenant", body);
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "bible/kt/covenant", language: "en", detail: "summary" },
      env,
      "req",
    );
    const article = String(result.structuredContent?.article ?? "");
    expect(article).toHaveLength(1500);
    expect(article.startsWith("A")).toBe(true);
    expect(article).not.toContain("ENDMARKER");
    expect(String(result.structuredContent?.note)).toMatch(/cut/i);
  });

  it("cuts an academy summary when the article has no sections and no subtitle", async () => {
    const body = `${"B".repeat(1600)}ENDMARKER`;
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/academy/")) {
        return hit("ta", "translate/figs-plain", "Plain", body);
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "translate/figs-plain", language: "en", detail: "summary" },
      env,
      "req",
    );
    const article = String(result.structuredContent?.article ?? "");
    expect(article).toHaveLength(1500);
    expect(article.startsWith("B")).toBe(true);
    expect(article).not.toContain("ENDMARKER");
    expect(String(result.structuredContent?.note)).toMatch(/cut/i);
  });

  it("rejects traversal and absolute paths before calling the API", async () => {
    const { env, calls } = apiEnv(() => {
      throw new Error("the API must not be called");
    });
    for (const path of ["../secret", "/etc/passwd", "rc://*/tw/dict/../x"]) {
      await expect(
        getArticleV3Tool.handler({ path, language: "en" }, env, "req"),
        path,
      ).rejects.toThrow(/Invalid article path/);
      try {
        await getArticleV3Tool.handler({ path, language: "en" }, env, "req");
      } catch (error) {
        expect((error as { code?: string }).code).toBe(
          ErrorCode.INVALID_PARAMS,
        );
      }
    }
    expect(calls).toEqual([]);
  });

  it("accepts term, word, and article_id as path", () => {
    const cases: Array<{
      raw: Record<string, string>;
      path: string;
      drop: string;
    }> = [
      {
        raw: { term: "covenant", language: "en" },
        path: "covenant",
        drop: "term",
      },
      {
        raw: { word: "covenant", language: "en" },
        path: "covenant",
        drop: "word",
      },
      {
        raw: { article_id: "translate/figs-metaphor", language: "en" },
        path: "translate/figs-metaphor",
        drop: "article_id",
      },
    ];
    for (const item of cases) {
      const normalized = normalizeV3ToolArgs("th_get_article", item.raw);
      expect(normalized[item.drop]).toBeUndefined();
      const parsed = getArticleV3Tool.inputSchema.safeParse(normalized);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.path).toBe(item.path);
    }
  });

  it("carries the requested language on next", async () => {
    const { env } = apiEnv((url) => {
      if (url.pathname.startsWith("/api/v1/words/")) {
        return hit("tw", "bible/kt/covenant", "Pacto", COVENANT, {
          language: "es-419",
          related: [{ path: "bible/kt/promise", title: "Promesa" }],
        });
      }
      return notFound();
    });
    const result = await getArticleV3Tool.handler(
      { path: "bible/kt/covenant", language: "es-419" },
      env,
      "req",
    );
    const related = result.structuredContent?.related as Array<{
      next: { args: { language?: string } };
    }>;
    expect(related[0]?.next.args.language).toBe("es-419");
  });
});

describe("v3 th_search", () => {
  it("sends a named term to th_get_article and keeps search for a concept", () => {
    expect(SEARCH_DESCRIPTION).toMatch(
      /When the user names a term \(covenant, metaphor\), call th_get_article with that term directly/,
    );
    expect(SEARCH_DESCRIPTION).toMatch(
      /use th_search for a concept or a description/,
    );
    expect(SEARCH_DESCRIPTION).toMatch(/figures of speech about the body/);
    expect(SEARCH_DESCRIPTION).not.toMatch(/"metaphor"/);
    expect(SEARCH_DESCRIPTION).not.toMatch(/"covenant"/);
    expect(searchV3Tool.description).toBe(SEARCH_DESCRIPTION);
  });

  it("describes query as a concept or a title, and points each result at next", () => {
    const published = toJsonSchema(
      strictToolSchema(searchV3Tool.inputSchema.shape),
    ) as {
      properties?: { query?: { description?: string } };
    };
    const query = published.properties?.query?.description ?? "";
    expect(query).toMatch(/figures of speech about the body/);
    expect(query.endsWith("Each result has next for th_get_article.")).toBe(
      true,
    );
    expect(query).not.toMatch(/Pass the matching path/);
    expect(query).not.toMatch(/metaphor/);
    expect(query).not.toMatch(/covenant/);
  });

  it("ranks an exact title ahead of a title that only contains the query", async () => {
    const { env, calls } = apiEnv((url) => {
      const types = (url.searchParams.get("types") ?? "ta,tw")
        .split(",")
        .map((item) => item.trim());
      const ranked = rankArticles(
        SEARCH_CATALOG.filter((item) => types.includes(item.resourceType)),
        url.searchParams.get("q") ?? "",
        Number(url.searchParams.get("limit") ?? "10"),
      );
      return { q: url.searchParams.get("q"), language: "en", results: ranked };
    });
    const result = await searchV3Tool.handler(
      { query: "metaphor", language: "en" },
      env,
      "req",
    );
    expect(calls[0]?.pathname).toBe("/api/v1/search");
    expect(calls[0]?.searchParams.get("q")).toBe("metaphor");
    expect(calls[0]?.searchParams.get("limit")).toBe("10");
    const results = result.structuredContent?.results as Array<{
      path: string;
      type: string;
      score: number;
      next: { tool: string; args: { path: string } };
    }>;
    expect(results.map((item) => item.path)).toEqual([
      "translate/figs-metaphor",
      "translate/figs-complexmetaphor",
    ]);
    expect(results[0]).toMatchObject({
      type: "ta",
      title: "Metaphor",
      score: 1,
      next: {
        tool: "th_get_article",
        args: { path: "translate/figs-metaphor" },
      },
    });
  });

  it("passes type and its aliases through to the search route", async () => {
    const seen: string[] = [];
    const { env } = apiEnv((url) => {
      seen.push(url.searchParams.get("types") ?? "");
      return {
        q: url.searchParams.get("q"),
        language: "en",
        results: [
          {
            path: "translate/figs-metaphor",
            title: "Metaphor",
            resourceType: "ta",
            score: 1,
          },
        ],
      };
    });
    const typed = normalizeV3ToolArgs("th_search", {
      query: "metaphor",
      type: "ta",
    });
    expect(typed).toMatchObject({ query: "metaphor", type: "ta" });
    expect(
      normalizeV3ToolArgs("th_search", {
        query: "metaphor",
        resourceType: "tw",
      }),
    ).toMatchObject({ type: "tw" });
    expect(
      normalizeV3ToolArgs("th_search", { query: "metaphor", types: "ta" }),
    ).toMatchObject({ type: "ta" });
    expect(
      normalizeV3ToolArgs("th_search", {
        query: "metaphor",
        types: "ta,tw",
      }).type,
    ).toBeUndefined();
    expect(
      normalizeV3ToolArgs("th_search", { query: "metaphor", type: "TA" }).type,
    ).toBe("ta");

    await searchV3Tool.handler(
      typed as { query: string; type: "ta"; language: string },
      env,
      "req",
    );
    expect(seen).toEqual(["ta"]);
    const aliased = normalizeV3ToolArgs("th_search", {
      query: "covenant",
      resourceType: "tw",
      language: "en",
    });
    await searchV3Tool.handler(
      aliased as { query: string; type: "tw"; language: string },
      env,
      "req-alias",
    );
    expect(seen[1]).toBe("tw");
  });
});

describe("v3 instructions", () => {
  it("is version 2.9.0", () => {
    expect(VERSION).toBe("2.9.0");
  });

  it("names every tool, and puts the language rule on the passage parameter", () => {
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/th_get_passage/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/th_get_passage_index/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/th_get_notes/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/th_get_questions/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/th_get_article/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/th_search/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/th_list_resources/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/JHN 3:16/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/OBS 3:5/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/candidates/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(
      /an article with otherCandidates is the answer; those are similar titles from the other catalog, to offer only if the reader wants more/,
    );
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/available:\s*false/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/memory/i);
    expect(V3_SERVER_INSTRUCTIONS).not.toMatch(/You are /);
    expect(V3_SERVER_INSTRUCTIONS).not.toMatch(/comes later/i);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/isError/);
    expect(V3_SERVER_INSTRUCTIONS).toMatch(/next is the call/);
    expect(getPassageV3Tool.description).not.toMatch(/JHN 3:16/);
    const published = toJsonSchema(
      strictToolSchema(getPassageV3Tool.inputSchema.shape),
    ) as {
      properties?: {
        language?: { description?: string };
        reference?: { description?: string };
      };
    };
    const language = published.properties?.language?.description ?? "";
    expect(language).toMatch(/do not fall back/i);
    expect(language).toMatch(/th_list_resources/);
    expect(published.properties?.reference?.description ?? "").toMatch(
      /JHN 3:16/,
    );
  });
});
