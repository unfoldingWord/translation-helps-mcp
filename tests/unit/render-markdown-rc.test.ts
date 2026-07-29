/**
 * Door43 wiki-link preprocessing for TN markdown (panel rendering).
 */
import { describe, expect, it } from "vitest";
import {
  preprocessDoor43Markdown,
  rcLinkDisplayName,
  rcLinkKind,
  renderMarkdown,
  stripHiddenMarkers,
} from "../../web/src/lib/renderMarkdown.ts";

describe("Door43 markdown / rc:// wiki-links", () => {
  it("turns [[rc://…]] into a labeled markdown link", () => {
    const out = preprocessDoor43Markdown(
      "Ver: [[rc://es-419/ta/man/translate/translate-names]]",
    );
    expect(out).toContain(
      "[Translate Names](rc://es-419/ta/man/translate/translate-names)",
    );
    expect(out).not.toContain("[[rc://");
  });

  it("unescapes literal \\n before parsing", () => {
    const out = preprocessDoor43Markdown("Line1\\n\\n## Heading");
    expect(out).toBe("Line1\n\n## Heading");
  });

  it("renders rc links as styled chips and headings as HTML", () => {
    const html = renderMarkdown(
      "Ver: [[rc://es-419/ta/man/translate/translate-names]]\\n\\n## Parte 2",
    );
    expect(html).toContain('class="rc-link rc-link--ta"');
    expect(html).toContain("Translate Names");
    expect(html).toContain("<h2>");
    expect(html).not.toContain("[[rc://");
  });

  it("labels and kinds", () => {
    expect(rcLinkDisplayName("rc://*/tw/dict/bible/kt/grace")).toBe("Grace");
    expect(rcLinkKind("rc://*/ta/man/translate/figs-metaphor")).toBe("ta");
    expect(rcLinkKind("rc://*/tw/dict/bible/kt/grace")).toBe("tw");
  });
});

describe("stripHiddenMarkers (user chat bubbles)", () => {
  it("removes the CHECKITEM marker from a click message, keeping visible text", () => {
    const msg =
      "Let's check: v.1 and knowledge of the truth\n<!-- CHECKITEM:note:tn97 -->";
    expect(stripHiddenMarkers(msg)).toBe(
      "Let's check: v.1 and knowledge of the truth",
    );
  });

  it("removes multiple hidden comments (CHECKING footer, QUIZ, etc.)", () => {
    const msg =
      "Pedir revisión\n<!-- CHECKING:TIT 1:1-4 -->\n<!-- CHECKITEM:tw:bible/kt/godly -->";
    const out = stripHiddenMarkers(msg);
    expect(out).toBe("Pedir revisión");
    expect(out).not.toContain("<!--");
  });

  it("collapses leftover blank lines from mid-text comments", () => {
    const out = stripHiddenMarkers("Line one\n\n<!-- hidden -->\n\nLine two");
    expect(out).toBe("Line one\n\nLine two");
  });

  it("passes plain text through unchanged and handles empty input", () => {
    expect(stripHiddenMarkers("hola, ¿cómo va la revisión?")).toBe(
      "hola, ¿cómo va la revisión?",
    );
    expect(stripHiddenMarkers("")).toBe("");
  });
});
