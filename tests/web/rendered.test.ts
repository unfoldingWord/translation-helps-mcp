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
