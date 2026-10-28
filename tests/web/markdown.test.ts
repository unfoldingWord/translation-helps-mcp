import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../web/src/lib/markdown.js";

describe("renderMarkdown", () => {
  it("removes scripts and event handlers", () => {
    expect(renderMarkdown("<img src=x onerror=alert(1)>")).not.toMatch(
      /onerror/i,
    );
    expect(renderMarkdown("<script>x</script> hi")).not.toMatch(/<script/i);
    expect(renderMarkdown("[a](javascript:alert(1))")).not.toMatch(
      /javascript:/i,
    );
  });

  it("keeps the structure of a note or article", () => {
    const html = renderMarkdown("#### 01-05\n\n- **Q:** a");
    expect(html).toMatch(/<h4[^>]*>01-05<\/h4>/);
    expect(html).toMatch(/<li>.*<strong>Q:<\/strong> a.*<\/li>/s);
  });

  it("opens links in a new tab", () => {
    expect(renderMarkdown("[Door43](https://door43.org)")).toMatch(
      /target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/,
    );
  });

  it("turns Door43 rc:// links the page can open into labelled buttons", () => {
    const html = renderMarkdown(
      "See [[rc://*/ta/man/translate/figs-metaphor]]",
      () => true,
    );
    expect(html).toMatch(
      /<button[^>]*class="rc-link rc-link--ta"[^>]*data-rc="rc:\/\/\*\/ta\/man\/translate\/figs-metaphor"[^>]*>Figs Metaphor<\/button>/,
    );
    expect(html).not.toContain('href="rc://');
  });

  it("shows Door43 links the page cannot open as plain text, never a dead link", () => {
    const md =
      "See [[rc://*/ta/man/translate/figs-metaphor]], [love](../kt/love.md), [x](#) and [y](rc://en/tn/help/jhn/03/16).";
    for (const html of [renderMarkdown(md), renderMarkdown(md, () => false)]) {
      expect(html).toContain("Figs Metaphor");
      expect(html).toContain("love");
      expect(html).not.toMatch(/<button|<a |href=|data-rc/);
    }
  });

  it("asks which relative links to follow, and only makes those buttons", () => {
    const html = renderMarkdown(
      "[love](../kt/love.md) and [note](../01/01.md)",
      (href) => href === "../kt/love.md",
    );
    expect(html).toMatch(
      /<button[^>]*data-rc="\.\.\/kt\/love\.md"[^>]*>love<\/button>/,
    );
    expect(html).not.toContain('data-rc="../01/01.md"');
    expect(html).toContain("note");
  });
});

describe("renderMarkdown sanitizer", () => {
  it("keeps the structure of a GFM table", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toMatch(/<table>/);
    expect(html).toMatch(/<th[^>]*>a<\/th>/);
    expect(html).toMatch(/<td[^>]*>2<\/td>/);
  });

  it("drops classes Door43 content brings, and keeps the renderer's own rc-link classes", () => {
    const html = renderMarkdown(
      '<span class="fixed inset-0 rc-link--x">over</span> [[rc://*/tw/dict/bible/kt/sin]]',
      () => true,
    );
    expect(html).not.toMatch(/fixed|inset-0|rc-link--x/);
    expect(html).toContain("over");
    expect(html).toContain('class="rc-link rc-link--tw"');
  });
});
