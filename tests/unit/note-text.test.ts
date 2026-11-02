import { describe, expect, it } from "vitest";
import { rewriteNoteVerseLinks } from "../../src/core/noteText.js";

describe("rewriteNoteVerseLinks", () => {
  it("rewrites verse links and leaves the alternate translation", () => {
    const note = [
      "See [the animals](../01/29.md) and [the calf](../../exo/32/04.md).",
      "",
      "# Alternate translation",
      "",
      "Keep [this](../01/29.md).",
      "",
      "# After",
      "",
      "See [again](../01/30.md).",
    ].join("\n");
    const rewritten = rewriteNoteVerseLinks(note, "GEN");
    expect(rewritten).toContain("Genesis 1:29");
    expect(rewritten).toContain("Exodus 32:4");
    expect(rewritten).toContain("Keep [this](../01/29.md).");
    expect(rewritten).toContain("Genesis 1:30");
  });
});
