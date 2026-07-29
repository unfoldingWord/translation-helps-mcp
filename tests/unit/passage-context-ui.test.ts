/**
 * passage_context UI component — emit shape + panel retention across drills.
 */

import { describe, it, expect } from "vitest";
import {
  bookCodeFromReference,
  inferPassageContextScope,
  mergeNewestWins,
  mergePassageContextComponents,
  retainContextForPanel,
  type UIComponent,
} from "../../src/core/harness/uiComponents.js";
import { buildPassageContextComponent } from "../../src/core/harness/ContextHarness.js";

const bookCtx: Extract<UIComponent, { type: "passage_context" }> = {
  type: "passage_context",
  reference: "TIT",
  scope: "book",
  notes: [
    {
      id: "front-intro",
      scope: "book",
      title: "Titus overview",
      noteText: "Paul wrote Titus to instruct church leaders.",
    },
  ],
};

const chapterCtx: Extract<UIComponent, { type: "passage_context" }> = {
  type: "passage_context",
  reference: "TIT 1",
  scope: "chapter",
  notes: [
    {
      id: "c1-intro",
      scope: "chapter",
      noteText: "Chapter 1 opens with qualifications for elders.",
    },
  ],
};

const rangeNotes: Extract<UIComponent, { type: "translation_notes" }> = {
  type: "translation_notes",
  reference: "TIT 1:1-4",
  notes: [
    {
      id: "tn-1",
      noteText: "Verse-level note about 'servant'.",
      quote: "servant",
    },
  ],
};

describe("inferPassageContextScope / bookCodeFromReference", () => {
  it("classifies book / chapter / range", () => {
    expect(inferPassageContextScope("TIT")).toBe("book");
    expect(inferPassageContextScope("TIT 1")).toBe("chapter");
    expect(inferPassageContextScope("TIT 1:1-4")).toBe("range");
  });

  it("extracts book codes across progression", () => {
    expect(bookCodeFromReference("TIT")).toBe("TIT");
    expect(bookCodeFromReference("TIT 1")).toBe("TIT");
    expect(bookCodeFromReference("TIT 1:1-4")).toBe("TIT");
  });
});

describe("buildPassageContextComponent", () => {
  it("emits passage_context from a successful get_passage_context payload", () => {
    const raw = {
      reference: "TIT 1",
      context: [
        {
          id: "front",
          chapter: "front",
          verse: "intro",
          scope: "book",
          note: "Book background for Titus.",
        },
        {
          id: "ch1",
          chapter: "1",
          verse: "intro",
          scope: "chapter",
          note: "Chapter 1 intro.",
        },
      ],
      availability: [
        {
          type: "tn",
          abbreviation: "TN",
          subject: "TSV Translation Notes",
          role: "notes",
        },
      ],
    };

    const component = buildPassageContextComponent("TIT 1", raw);
    expect(component).not.toBeNull();
    expect(component!.type).toBe("passage_context");
    expect(component!.scope).toBe("chapter");
    expect(component!.notes).toHaveLength(2);
    expect(component!.notes.map((n) => n.scope)).toEqual(["book", "chapter"]);
    expect(component!.notes[0].noteText).toContain("Book background");
    expect(component!.availability?.[0].abbreviation).toBe("TN");
  });

  it("returns null when context notes are empty", () => {
    expect(buildPassageContextComponent("TIT", { context: [] })).toBeNull();
  });

  it("unwraps MCP content[] payloads", () => {
    const wrapped = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            reference: "TIT",
            context: [
              {
                id: "1",
                scope: "book",
                note: "Intro text",
                chapter: "front",
                verse: "intro",
              },
            ],
          }),
        },
      ],
    };
    const component = buildPassageContextComponent("TIT", wrapped);
    expect(component?.notes[0].noteText).toBe("Intro text");
    expect(component?.scope).toBe("book");
  });
});

describe("mergeNewestWins — retain passage_context beside verse TN", () => {
  it("keeps book context when a later turn only emits verse-range TN", () => {
    const merged = mergeNewestWins([[bookCtx], [rangeNotes]]);
    const ctx = merged.find((c) => c.type === "passage_context") as
      | Extract<UIComponent, { type: "passage_context" }>
      | undefined;
    const tn = merged.find((c) => c.type === "translation_notes") as
      | Extract<UIComponent, { type: "translation_notes" }>
      | undefined;
    expect(ctx?.notes.some((n) => n.scope === "book")).toBe(true);
    expect(tn?.notes[0].id).toBe("tn-1");
  });

  it("merges book + chapter notes instead of replacing the whole component", () => {
    const merged = mergePassageContextComponents(bookCtx, chapterCtx);
    expect(merged?.notes).toHaveLength(2);
    expect(merged?.notes.find((n) => n.scope === "book")?.id).toBe(
      "front-intro",
    );
    expect(merged?.notes.find((n) => n.scope === "chapter")?.id).toBe(
      "c1-intro",
    );
    expect(merged?.reference).toBe("TIT 1");
  });
});

describe("retainContextForPanel — TIT → TIT 1 → TIT 1:1-4", () => {
  it("retains book+chapter context on a range-only latest block", () => {
    const blocks: UIComponent[][] = [[bookCtx], [chapterCtx], [rangeNotes]];
    const panel = retainContextForPanel(blocks, [rangeNotes]);
    const ctx = panel.find((c) => c.type === "passage_context") as
      | Extract<UIComponent, { type: "passage_context" }>
      | undefined;
    expect(ctx).toBeDefined();
    expect(ctx!.notes.map((n) => n.scope).sort()).toEqual(["book", "chapter"]);
    expect(panel.some((c) => c.type === "translation_notes")).toBe(true);
  });
});
