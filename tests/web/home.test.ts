import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../../src/mcp/toolRegistry.js";
import { RESOURCES } from "../../web/src/lib/resources.js";
import {
  ANATOMY_PARTS,
  EXCERPT_MAX,
  alignmentRows,
  excerptFrom,
  highlight,
} from "../../web/src/lib/home/anatomy.js";

const snapshot = JSON.parse(
  readFileSync(
    new URL("../../web/src/lib/home/snapshot.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const johnIndex = JSON.parse(
  readFileSync(
    new URL("./fixtures/passage-index-john-3-16.json", import.meta.url),
    "utf8",
  ),
) as unknown;

describe("RESOURCES", () => {
  it("lists the eight resources in order", () => {
    expect(RESOURCES.map((r) => r.id)).toEqual([
      "ult",
      "ust",
      "tn",
      "tw",
      "twl",
      "tq",
      "ta",
      "obs",
    ]);
  });

  it("names a real tool for each resource", () => {
    for (const r of RESOURCES)
      expect(TOOL_REGISTRY[r.tool], r.id).toBeDefined();
  });

  it("links each resource to its Door43 repository", () => {
    for (const r of RESOURCES) {
      expect(r.door43).toBe(`https://git.door43.org/unfoldingWord/en_${r.id}`);
      expect(r.name && r.summary && r.forWhom, r.id).toBeTruthy();
    }
  });
});

describe("ANATOMY_PARTS", () => {
  it("has the five parts of the passage", () => {
    expect(ANATOMY_PARTS.map((p) => p.id).sort()).toEqual([
      "academy",
      "notes",
      "questions",
      "text",
      "words",
    ]);
  });

  it("makes calls each tool accepts, for John 3:16 in English", () => {
    for (const p of ANATOMY_PARTS) {
      const tool = TOOL_REGISTRY[p.call.tool];
      expect(tool, p.id).toBeDefined();
      const parsed = tool.inputSchema.safeParse(p.call.args);
      expect(parsed.success, `${p.id}: ${JSON.stringify(parsed.error)}`).toBe(
        true,
      );
      expect(p.call.args.language, p.id).toBe("en");
      if ("reference" in p.call.args)
        expect(p.call.args.reference).toBe("John 3:16");
    }
  });
});

describe("snapshot.json", () => {
  it("has a short excerpt for every part", () => {
    for (const p of ANATOMY_PARTS) {
      const text = snapshot[p.id];
      expect(typeof text, p.id).toBe("string");
      expect((text as string).trim().length, p.id).toBeGreaterThan(0);
      expect((text as string).length, p.id).toBeLessThanOrEqual(700);
    }
  });

  it("has two to four alignment rows", () => {
    const rows = snapshot.alignment as { original: string; aligned: string }[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(4);
    for (const r of rows) {
      expect(r.original.trim()).not.toBe("");
      expect(r.aligned.trim()).not.toBe("");
    }
  });
});

describe("excerptFrom", () => {
  it("keeps a long article under the limit and marks the cut", () => {
    const article = Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i} of the article.`,
    ).join("\n\n");
    const out = excerptFrom("academy", { article });
    expect(out.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not end a cut excerpt on a heading", () => {
    const article = `${"A sentence of the lesson. ".repeat(24)}\n\n#### Next part\n\n${"More. ".repeat(80)}`;
    const out = excerptFrom("academy", { article });
    expect(out).not.toContain("Next part");
    expect(out.endsWith("…")).toBe(true);
  });

  it("gives nothing for an answer it does not know", () => {
    expect(excerptFrom("text", null)).toBe("");
    expect(excerptFrom("notes", { notes: [] })).toBe("");
  });

  it("shows the literal and simplified text without the verse number", () => {
    const out = excerptFrom("text", {
      versions: [
        {
          resourceType: "ult",
          role: "literal",
          text: "16 For God so loved the world",
        },
        {
          resourceType: "ust",
          role: "simplified",
          text: "16 God loved the people",
        },
      ],
    });
    expect(out).toContain("For God so loved the world");
    expect(out).not.toMatch(/\b16 For/);
  });
});

describe("alignmentRows", () => {
  it("takes two to four distinct phrases from the notes", () => {
    const rows = alignmentRows(johnIndex);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(4);
    expect(new Set(rows.map((r) => r.original)).size).toBe(rows.length);
  });
});

describe("highlight", () => {
  it("marks every piece of a quote that skips words", () => {
    const parts = highlight(
      "οὕτως γὰρ ἠγάπησεν ὁ Θεὸς τὸν κόσμον",
      "οὕτως … ἠγάπησεν ὁ Θεὸς τὸν κόσμον",
    );
    expect(parts.filter((p) => p.mark).map((p) => p.text)).toEqual([
      "οὕτως",
      "ἠγάπησεν ὁ Θεὸς τὸν κόσμον",
    ]);
    expect(parts.map((p) => p.text).join("")).toBe(
      "οὕτως γὰρ ἠγάπησεν ὁ Θεὸς τὸν κόσμον",
    );
  });

  it("marks nothing when the quote is not in the text", () => {
    const parts = highlight("For God so loved", "the Son");
    expect(parts).toEqual([{ text: "For God so loved", mark: false }]);
  });
});
