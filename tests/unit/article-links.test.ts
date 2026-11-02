import { describe, expect, it } from "vitest";
import { rewriteHelpsLinks } from "../../src/core/articleLinks.js";

describe("rewriteHelpsLinks", () => {
  it("rewrites a TW relative link and leaves a note link", () => {
    const source = [
      "See [the promise](../kt/promise.md).",
      "A note: [Genesis 37:35](rc://en/tn/help/gen/37/35)",
      "[[rc://en/tw/dict/bible/kt/covenant]]",
    ].join("\n");
    const { article, related } = rewriteHelpsLinks(
      source,
      { kind: "tw", path: "bible/kt/hades" },
      (path) => (path === "bible/kt/promise" ? "Promise" : undefined),
    );
    expect(article).toContain("[the promise](bible/kt/promise)");
    expect(article).toContain("rc://en/tn/help/gen/37/35");
    expect(article).toContain("[[bible/kt/covenant]]");
    expect(article).not.toContain("../kt/promise.md");
    expect(related).toEqual([
      { path: "bible/kt/promise", title: "Promise" },
      { path: "bible/kt/covenant", title: "Covenant" },
    ]);
  });

  it("rewrites a TA relative link to the article path", () => {
    const { article, related } = rewriteHelpsLinks(
      "Like a [simile](../figs-simile/01.md).",
      { kind: "ta", path: "translate/figs-metaphor" },
      () => "Simile",
    );
    expect(article).toContain("(translate/figs-simile)");
    expect(article).not.toContain("../figs-simile/01.md");
    expect(related).toEqual([
      { path: "translate/figs-simile", title: "Simile" },
    ]);
  });
});
