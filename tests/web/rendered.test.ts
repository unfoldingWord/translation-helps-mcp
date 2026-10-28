import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderedView } from "../../web/src/lib/try/rendered.js";
import type { CallResult } from "../../web/src/lib/mcp/client.js";

const exchange = { request: {}, response: {}, status: 200, bytes: 1, ms: 1 };
const result = (
  text: string,
  structured: Record<string, unknown> | null,
  isError = false,
): CallResult => ({ text, structured, isError, exchange });

describe("rendered view of a result", () => {
  it("renders get_note as markdown: the words, then the note", () => {
    const view = renderedView(
      result("1 note(s) for TIT 1:1", {
        notes: [
          {
            id: "abcd",
            quote: "δοῦλος",
            supportReferenceTitle: "Metaphor",
            note: "Paul calls himself a **servant**.",
          },
        ],
      }),
    );
    expect(view.kind).toBe("markdown");
    if (view.kind !== "markdown") return;
    expect(view.text).toContain("δοῦλος");
    expect(view.text).toContain("Paul calls himself a **servant**.");
  });

  it("renders an article as markdown", () => {
    const view = renderedView(
      result("Word article: god", {
        path: "bible/kt/god",
        article: "# God\n\nText",
      }),
    );
    expect(view).toEqual({ kind: "markdown", text: "# God\n\nText" });
  });

  it("renders the versions of get_passage as markdown", () => {
    const view = renderedView(
      result("x", {
        versions: [
          {
            resourceType: "ult",
            role: "literal",
            text: "For God so loved",
            source: "s",
          },
          {
            resourceType: "ust",
            role: "simplified",
            text: "God loved",
            source: "s",
          },
        ],
      }),
    );
    expect(view.kind).toBe("markdown");
    if (view.kind !== "markdown") return;
    expect(view.text).toContain("ULT");
    expect(view.text).toContain("For God so loved");
    expect(view.text).toContain("UST");
  });

  it("does not treat the passage index (notes without bodies) as notes to read", () => {
    const view = renderedView(
      result("index", {
        notes: [{ id: "a", taArticle: { path: "translate/x", title: "X" } }],
      }),
    );
    expect(view.kind).toBe("json");
  });

  it("shows the summary line and formatted JSON for list_languages", () => {
    const view = renderedView(
      result('120 languages\n\n{"total_count":120}', { total_count: 120 }),
    );
    expect(view).toEqual({
      kind: "json",
      summary: "120 languages",
      json: '{\n  "total_count": 120\n}',
    });
  });

  it("shows no summary when the first block is itself JSON", () => {
    const view = renderedView(result('{"a":1}', { a: 1 }));
    expect(view).toEqual({ kind: "json", summary: "", json: '{\n  "a": 1\n}' });
  });

  it("shows plain text when there is no structured data", () => {
    const view = renderedView(result("Error: nope", null, true));
    expect(view).toEqual({ kind: "text", text: "Error: nope" });
  });
});

/** A trimmed live answer from tests/web/fixtures: its text and structuredContent. */
const live = (name: string): CallResult => {
  const f = JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as { text: string; structured: Record<string, unknown> };
  return result(f.text, f.structured);
};
const markdownOf = (r: CallResult): string => {
  const view = renderedView(r);
  expect(view.kind).toBe("markdown");
  return view.kind === "markdown" ? view.text : "";
};

describe("rendered view of the live answer shapes", () => {
  it("get_passage_context: the book and chapter introductions", () => {
    const md = markdownOf(live("context-john-3-16.json"));
    expect(md).toContain("# Introduction to John");
    expect(md).toContain("# John 3 Chapter Introduction");
    expect(md).toContain("\n\n---\n\n");
    expect(md).not.toContain("availability");
  });

  it("get_questions: each question in bold, then its answer", () => {
    const md = markdownOf(live("questions-john-3-16.json"));
    expect(
      md.startsWith(
        "**How did God show he loved the world?**\n\nHe showed his love",
      ),
    ).toBe(true);
  });

  it("get_obs_story: the title, each frame after its number, then the source", () => {
    const md = markdownOf(live("obs-story-1.json"));
    expect(
      md.startsWith("### 1. The Creation\n\n**1** This is how God made"),
    ).toBe(true);
    expect(md).toContain("\n\n**2** Then God said");
    expect(md).toContain("\n\n**3** ");
    expect(md.endsWith("*A Bible story from: Genesis 1-2*")).toBe(true);
    expect(md).not.toContain("imageUrl");
  });

  it("get_obs_questions: each question says its frame", () => {
    const md = markdownOf(live("obs-questions-1.json"));
    expect(
      md.startsWith(
        "**1:1 · Where did everything in the universe come from?**\n\nGod created everything.",
      ),
    ).toBe(true);
  });

  it("get_obs_notes: each note under its frame and words", () => {
    const md = markdownOf(live("obs-notes-1-1.json"));
    expect(md.startsWith("### 1:1 · “the beginning”\n\nThis could mean")).toBe(
      true,
    );
  });

  it("get_word_article and get_academy_article: the article itself", () => {
    expect(markdownOf(live("word-article-love.json"))).toMatch(
      /^# love, beloved/,
    );
    expect(markdownOf(live("academy-article-metonymy.json"))).toMatch(
      /^### Description/,
    );
  });

  it("passage questions get no reference before the question", () => {
    const md = markdownOf(
      result("q", {
        reference: "John 3:16",
        questions: [{ reference: "3:16", question: "Q?", response: "A." }],
      }),
    );
    expect(md).toBe("**Q?**\n\nA.");
  });
});
