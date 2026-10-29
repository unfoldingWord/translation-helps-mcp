import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../../src/mcp/toolRegistry.js";
import { RESOURCES } from "../../web/src/lib/resources.js";
import {
  ANATOMY_PARTS,
  EXCERPT_MAX,
  LEAD_MAX,
  excerptFrom,
  heroCounts,
  heroFacts,
  heroNotes,
  heroSlides,
  highlight,
  noteLead,
  noteTextFrom,
  walkState,
  type HomeSnapshot,
} from "../../web/src/lib/home/anatomy.js";
import {
  decodeTryState,
  encodeTryState,
} from "../../web/src/lib/try/hashState.js";

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

  it("has two to four hero notes, each with its quotes, its text and its Academy topic", () => {
    const { notes } = (snapshot as unknown as HomeSnapshot).hero;
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes.length).toBeLessThanOrEqual(4);
    for (const n of notes) {
      expect(n.id, n.id).toMatch(/^\w+$/);
      expect(n.original.trim(), n.id).not.toBe("");
      expect(n.aligned.trim(), n.id).not.toBe("");
      expect(n.note.trim(), n.id).not.toBe("");
      expect(n.academy === null || n.academy.trim() !== "", n.id).toBe(true);
    }
    expect(new Set(notes.map((n) => n.original)).size).toBe(notes.length);
  });

  it("has the four counts, and every hero quote is in the verse", () => {
    const s = snapshot as unknown as HomeSnapshot;
    const { counts } = s.hero;
    for (const k of ["notes", "keyTerms", "questions", "academy"] as const)
      expect(Number.isInteger(counts[k]) && counts[k] > 0, k).toBe(true);
    expect(counts.notes).toBeGreaterThanOrEqual(s.hero.notes.length);
    for (const n of s.hero.notes) {
      expect(
        highlight(s.verse.original, n.original).some((p) => p.mark),
        n.id,
      ).toBe(true);
      expect(
        highlight(s.verse.translation, n.aligned).some((p) => p.mark),
        n.id,
      ).toBe(true);
    }
  });
});

describe("hero", () => {
  it("picks one note per quote from the index, phrases and Academy topics first", () => {
    const notes = heroNotes(johnIndex);
    // Phrases with an Academy topic, the phrase without one, then a single word.
    expect(notes.map((n) => n.id)).toEqual(["uxc2", "fqk7", "h4ht", "vg6z"]);
    expect(notes[0]).toEqual({
      id: "uxc2",
      original: "τὸν κόσμον",
      aligned: "the world",
      academy: "Metonymy",
    });
    // A note that points to no Academy article.
    expect(notes[2].academy).toBeNull();
    expect(heroNotes(null)).toEqual([]);
  });

  it("reads the note text from a get_note answer", () => {
    expect(
      noteTextFrom({ notes: [{ id: "uxc2", note: " Here, world… " }] }),
    ).toBe("Here, world…");
    expect(noteTextFrom({ notes: [] })).toBe("");
    expect(noteTextFrom("nope")).toBe("");
  });

  it("counts what the map lists and the questions", () => {
    const questions = JSON.parse(
      readFileSync(
        new URL("./fixtures/questions-john-3-16.json", import.meta.url),
        "utf8",
      ),
    ).structured;
    expect(heroCounts(johnIndex, questions)).toEqual({
      notes: 7,
      keyTerms: 8,
      academy: 4,
      questions: 1,
    });
    expect(heroCounts(null, null)).toEqual({
      notes: 0,
      keyTerms: 0,
      academy: 0,
      questions: 0,
    });
  });

  it("shows the start of a note as plain text", () => {
    expect(
      noteLead(
        "Here, **world** refers to the people. Alternate translation: [the people](rc://x) [[rc://*/ta/man/translate/figs-metonymy]]",
      ),
    ).toBe(
      "Here, world refers to the people. Alternate translation: the people",
    );
    const long = `${"A sentence of the note. ".repeat(5)}${"word ".repeat(60)}`;
    const cut = noteLead(long);
    expect(cut.length).toBeLessThanOrEqual(LEAD_MAX);
    expect(cut.endsWith(".")).toBe(true);
    const words = noteLead("word ".repeat(80));
    expect(words.length).toBeLessThanOrEqual(LEAD_MAX);
    expect(words.endsWith("…")).toBe(true);
    expect(words).not.toMatch(/\s…$/);
  });

  it("turns the saved notes into slides, and drops a note without text", () => {
    const slides = heroSlides({
      notes: [
        {
          id: "a",
          original: "τὸν κόσμον",
          aligned: "the world",
          note: "Here, **world** means people.",
          academy: "Metonymy",
        },
        { id: "b", original: "γὰρ", aligned: "For", note: "  ", academy: null },
      ],
      counts: { notes: 2, keyTerms: 0, questions: 0, academy: 1 },
    });
    expect(slides).toEqual([
      {
        id: "a",
        original: "τὸν κόσμον",
        aligned: "the world",
        lead: "Here, world means people.",
        academy: "Metonymy",
      },
    ]);
  });

  it("says the four counts, singular or plural, each with its step of the guided walk", () => {
    const facts = heroFacts({
      notes: 7,
      keyTerms: 1,
      questions: 1,
      academy: 4,
    });
    expect(facts.map((f) => f.text)).toEqual([
      "7 notes",
      "1 key term",
      "1 question",
      "4 Academy topics",
    ]);
    expect(facts.map((f) => f.step)).toEqual(["map", "map", "check", "map"]);
    for (const f of facts) {
      const state = decodeTryState(encodeTryState(walkState(f.step)), []);
      expect(state).toEqual({
        tab: "guided",
        lang: "en",
        ref: "John 3:16",
        step: f.step,
      });
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
