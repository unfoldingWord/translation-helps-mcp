import { describe, expect, it } from "vitest";
import type { Env } from "../../src/mcp/agent.js";
import { getPassageIndexTool } from "../../src/mcp/tools/getPassageIndex.js";
import { getNoteTool } from "../../src/mcp/tools/getNote.js";
import { resolveTaArticle } from "../../src/core/articleResolve.js";

function api(routes: Record<string, unknown>): Env {
  return {
    API: {
      async fetch(input: RequestInfo | URL) {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
        );
        const body = routes[url.pathname];
        if (!body) {
          return Response.json(
            { error: { code: "NOT_FOUND", message: url.pathname } },
            { status: 404 },
          );
        }
        return Response.json(body);
      },
    },
  } as Env;
}

describe("passage index feeds get_note and get_academy_article", () => {
  it("uses the caller's book and the path's own category", async () => {
    const note =
      "See [the animals](../01/29.md).\n\n# Alternate translation\n\nKeep [this](../01/29.md).";
    const env = api({
      "/api/v1/notes": {
        book: "",
        notes: [
          {
            id: "n1",
            book: "",
            chapter: "9",
            verse: "9",
            quote: "covenant",
            note,
            supportReference: "rc://*/ta/man/translate/figs-metaphor",
            occurrence: "1",
          },
        ],
      },
      "/api/v1/word-links": {
        book: "",
        wordLinks: [
          {
            book: "",
            chapter: "9",
            verse: "9",
            wordPath: "bible/kt/covenant",
            twTitle: "Covenant",
            origWords: "berith",
            occurrence: "1",
          },
        ],
      },
    });

    const index = await getPassageIndexTool.handler(
      { reference: "Genesis 9:9", language: "en" },
      env,
      "t",
    );
    const indexed = index.structuredContent as {
      notes: Array<{ reference: string; taArticle: { path: string } }>;
      words: Array<{
        reference: string;
        twArticle: { path: string; category: string };
      }>;
      keyTerms: Array<{ path: string; category: string }>;
    };
    expect(indexed.notes[0]?.reference).toBe("Genesis 9:9");
    expect(indexed.words[0]?.reference).toBe("Genesis 9:9");
    expect(indexed.words[0]?.twArticle.category).toBe("kt");
    expect(indexed.keyTerms[0]?.category).toBe("kt");

    const drilled = await getNoteTool.handler(
      { reference: indexed.notes[0]!.reference, language: "en" },
      env,
      "t",
    );
    const noteBody = drilled.structuredContent as {
      notes: Array<{
        book: string;
        note: string;
        taArticle: { path: string };
        supportReference: string;
      }>;
    };
    const row = noteBody.notes[0]!;
    expect(row.book).toBe("GEN");
    expect(row.taArticle.path).toBe("translate/figs-metaphor");
    expect(row.note).toContain("Genesis 1:29");
    expect(row.note).toContain("Keep [this](../01/29.md).");

    const catalog = [
      { path: "translate/figs-metaphor", title: "Metaphor" },
      { path: "translate/figs-complexmetaphor", title: "Complex Metaphor" },
    ];
    expect(resolveTaArticle(row.taArticle.path, catalog).status).toBe("exact");
    expect(resolveTaArticle(row.supportReference, catalog).status).toBe(
      "exact",
    );
  });
});
