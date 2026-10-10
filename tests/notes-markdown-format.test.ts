/**
 * Scripture translation notes asked for as markdown or text (issue #54).
 *
 * `/api/fetch-translation-notes` returns its notes as `verseNotes` and
 * `contextNotes`, not as one `items` array. The response formatter only
 * recognized translation helps by `items`, so a notes result fell through to
 * the generic branch and came back as its JSON inside a code block, while the
 * questions and the OBS notes (which carry `items`) came back as markdown.
 */

import { describe, expect, it } from "vitest";
import { formatResponse } from "../ui/src/lib/responseFormatter.js";

/** The shape `/api/fetch-translation-notes` returns, cut down to two verse notes and two context notes. */
const NOTES = {
  reference: "TIT 1:1",
  citations: [{ resource: "en_tn", organization: "unfoldingWord" }],
  verseNotes: [
    {
      Reference: "1:1",
      ID: "rtc9",
      Note: "The word **faith** is an abstract noun.",
      Quote: "κατὰ πίστιν",
      Occurrence: "1",
      externalReference: { target: "ta", path: "translate/figs-abstractnouns" },
    },
    {
      Reference: "1:1",
      ID: "xrtm",
      Note: "You can state this in active form.",
      Quote: "ἐκλεκτῶν Θεοῦ",
      Occurrence: "1",
      externalReference: { target: "ta", path: "translate/figs-activepassive" },
    },
  ],
  contextNotes: [
    {
      Reference: "front:intro",
      ID: "m2jl",
      Note: "# Introduction to Titus",
      Quote: "",
      Occurrence: "0",
      contextType: "book",
    },
    {
      Reference: "1:intro",
      ID: "c7me",
      Note: "# Titus 1 General Notes",
      Quote: "",
      Occurrence: "0",
      contextType: "chapter",
    },
  ],
  counts: { totalCount: 4, verseNotesCount: 2, contextNotesCount: 2 },
  metadata: {
    resourceType: "tn",
    language: "en",
    organization: "all",
    license: "CC BY-SA 4.0",
  },
};

describe("Scripture translation notes as markdown", () => {
  const markdown = formatResponse(NOTES, { format: "md" }) as string;

  it("is markdown like the other helps, not the JSON in a code block", () => {
    expect(typeof markdown).toBe("string");
    expect(markdown.startsWith("# Translation Tn\n")).toBe(true);
    expect(markdown).not.toContain("```json");
    expect(markdown).not.toContain("# Response");
  });

  it("has one entry per note: verse notes first, then the context notes", () => {
    const headings = markdown.match(/^## \d+\. .*$/gm);
    expect(headings).toEqual([
      "## 1. κατὰ πίστιν",
      "## 2. ἐκλεκτῶν Θεοῦ",
      "## 3. Book introduction",
      "## 4. Chapter introduction",
    ]);
    expect(markdown).toContain("The word **faith** is an abstract noun.");
    expect(markdown).toContain("# Introduction to Titus");
  });

  it("keeps each note's Translation Academy article, so a caller can follow it", () => {
    expect(markdown).toContain(
      "**Translation Academy**: translate/figs-abstractnouns",
    );
    expect(markdown).toContain(
      "**Translation Academy**: translate/figs-activepassive",
    );
  });
});

describe("Scripture translation notes as text", () => {
  const text = formatResponse(NOTES, { format: "text" }) as string;

  it("is the plain-text helps layout, not a JSON dump", () => {
    expect(text.startsWith("TRANSLATION TN\n")).toBe(true);
    expect(text).toContain("1. κατὰ πίστιν");
    expect(text).toContain("3. Book introduction");
    expect(text).toContain("Translation Academy: translate/figs-abstractnouns");
    expect(text).not.toContain('"verseNotes"');
  });
});

describe("what the change leaves alone", () => {
  it("formats an items result exactly as before", () => {
    const obsNotes = {
      reference: "1:1",
      items: [
        {
          Reference: "1:1",
          ID: "lm48",
          Quote: "the beginning",
          Note: "Before anything existed.",
        },
      ],
      metadata: {
        resourceType: "tn",
        language: "en",
        organization: "unfoldingWord",
      },
    };
    const markdown = formatResponse(obsNotes, { format: "md" }) as string;
    expect(markdown).toContain(
      "## 1. the beginning\n\nBefore anything existed.",
    );
    expect(markdown).not.toContain("Translation Academy");
  });

  it("still prints an unknown shape as JSON", () => {
    const markdown = formatResponse(
      { anything: 1 },
      { format: "md" },
    ) as string;
    expect(markdown.startsWith("# Response\n\n```json")).toBe(true);
  });
});
