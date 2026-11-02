/**
 * Near-miss TW/TA paths resolve to the article in the zip.
 * Exact paths win first. Unsafe paths stay rejected.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode } from "../../src/core/errors.js";
import {
  prepareArticlePath,
  resolveTaArticle,
  resolveTwArticle,
} from "../../src/core/articleResolve.js";

const TW = [
  { path: "bible/kt/hades", title: "Hades, Sheol" },
  { path: "bible/kt/covenant", title: "Covenant" },
  { path: "bible/kt/sonofgod", title: "Son of God" },
  { path: "bible/kt/promise", title: "Promise" },
  { path: "bible/names/paul", title: "Paul" },
  { path: "bible/other/paul", title: "Paul (other)" },
  { path: "bible/other/king", title: "King" },
];

const TW_ES = [{ path: "bible/kt/covenant", title: "Pacto, alianza" }];

const TA = [
  { path: "translate/figs-metaphor", title: "Metaphor" },
  { path: "translate/figs-simile", title: "Simile" },
  { path: "translate/figs-complexmetaphor", title: "Complex Metaphor" },
  { path: "translate/figs-metonymy", title: "Metonymy" },
  { path: "checking/vol1-things", title: "Things to Check" },
];

describe("prepareArticlePath", () => {
  it("strips known rc and folder prefixes, then keeps a safe path", () => {
    expect(prepareArticlePath("rc://*/tw/dict/bible/kt/covenant")).toBe(
      "bible/kt/covenant",
    );
    expect(prepareArticlePath("rc://en/tw/dict/bible/kt/covenant")).toBe(
      "bible/kt/covenant",
    );
    expect(prepareArticlePath("tw/dict/bible/other/hades")).toBe(
      "bible/other/hades",
    );
    expect(prepareArticlePath("rc://*/ta/man/translate/figs-metaphor")).toBe(
      "translate/figs-metaphor",
    );
    expect(
      prepareArticlePath("rc://es/ta/man/translate/figs-metaphor/01.md"),
    ).toBe("translate/figs-metaphor/01.md");
    expect(prepareArticlePath("ta/man/translate/figs-metaphor")).toBe(
      "translate/figs-metaphor",
    );
    expect(prepareArticlePath("  Dict/bible/kt/covenant  ")).toBe(
      "bible/kt/covenant",
    );
  });

  it("rejects traversal, absolute paths, and control characters after the prefix strip", () => {
    for (const raw of [
      "../kt/hades",
      "bible/../kt/hades",
      "/bible/kt/hades",
      "rc://*/tw/dict/../secret",
      "bible/kt/ha\ndes",
      "C:/windows/tw",
    ]) {
      expect(() => prepareArticlePath(raw), raw).toThrow(
        /Invalid article path/,
      );
      try {
        prepareArticlePath(raw);
      } catch (error) {
        expect((error as { code?: string }).code).toBe(
          ErrorCode.INVALID_PARAMS,
        );
      }
    }
  });
});

describe("resolveTwArticle", () => {
  it("keeps an exact path and tries it before any other step", () => {
    const exact = resolveTwArticle("bible/names/paul", TW);
    expect(exact).toEqual({
      status: "exact",
      path: "bible/names/paul",
      title: "Paul",
    });
    expect(resolveTwArticle("bible/kt/Covenant.md", TW)).toMatchObject({
      status: "exact",
      path: "bible/kt/covenant",
    });
    expect(
      resolveTwArticle("rc://*/tw/dict/bible/kt/covenant", TW),
    ).toMatchObject({ status: "exact", path: "bible/kt/covenant" });
  });

  it("finds a file name in the wrong or missing category", () => {
    expect(resolveTwArticle("bible/other/hades", TW)).toEqual({
      status: "resolved",
      path: "bible/kt/hades",
      title: "Hades, Sheol",
      resolvedFrom: "category",
    });
    expect(resolveTwArticle("other/hades", TW)).toMatchObject({
      path: "bible/kt/hades",
      resolvedFrom: "category",
    });
    expect(resolveTwArticle("hades", TW)).toMatchObject({
      path: "bible/kt/hades",
      resolvedFrom: "category",
    });
    expect(resolveTwArticle("Covenant", TW)).toMatchObject({
      path: "bible/kt/covenant",
      resolvedFrom: "category",
    });
    expect(resolveTwArticle("son-of-god", TW)).toMatchObject({
      path: "bible/kt/sonofgod",
      resolvedFrom: "category",
    });
  });

  it("matches an alternate name in the title", () => {
    expect(resolveTwArticle("sheol", TW)).toEqual({
      status: "resolved",
      path: "bible/kt/hades",
      title: "Hades, Sheol",
      resolvedFrom: "title",
    });
    expect(resolveTwArticle("bible/other/sheol", TW)).toMatchObject({
      path: "bible/kt/hades",
      resolvedFrom: "title",
    });
  });

  it("matches a Spanish title from that language's catalog", () => {
    expect(resolveTwArticle("pacto", TW_ES)).toMatchObject({
      path: "bible/kt/covenant",
      title: "Pacto, alianza",
      resolvedFrom: "title",
    });
  });

  it("uses a simple plural only after name and title miss", () => {
    expect(resolveTwArticle("covenants", TW)).toEqual({
      status: "resolved",
      path: "bible/kt/covenant",
      title: "Covenant",
      resolvedFrom: "plural",
    });
  });

  it("does not guess when the same file name is in two categories", () => {
    const result = resolveTwArticle("paul", TW);
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.resolvedFrom).toBe("category");
    expect(result.candidates).toEqual([
      { path: "bible/names/paul", title: "Paul" },
      { path: "bible/other/paul", title: "Paul (other)" },
    ]);
    expect(result.candidates.length).toBeLessThanOrEqual(5);
  });

  it("misses a term that matches nothing", () => {
    expect(resolveTwArticle("not-a-term", TW)).toEqual({ status: "miss" });
  });
});

describe("resolveTaArticle", () => {
  it("keeps an exact manual/slug path", () => {
    expect(resolveTaArticle("translate/figs-metaphor", TA)).toEqual({
      status: "exact",
      path: "translate/figs-metaphor",
      title: "Metaphor",
    });
    expect(
      resolveTaArticle("ta/man/translate/figs-metaphor/01.md", TA),
    ).toMatchObject({ status: "exact", path: "translate/figs-metaphor" });
    expect(
      resolveTaArticle("rc://*/ta/man/translate/figs-metaphor", TA),
    ).toMatchObject({ status: "exact", path: "translate/figs-metaphor" });
  });

  it("adds the manual when the slug is unique", () => {
    expect(resolveTaArticle("figs-metaphor", TA)).toEqual({
      status: "resolved",
      path: "translate/figs-metaphor",
      title: "Metaphor",
      resolvedFrom: "manual",
    });
  });

  it("prefers an exact title over a partial one", () => {
    expect(resolveTaArticle("metaphor", TA)).toEqual({
      status: "resolved",
      path: "translate/figs-metaphor",
      title: "Metaphor",
      resolvedFrom: "title",
    });
    expect(resolveTaArticle("Metaphor", TA)).toMatchObject({
      path: "translate/figs-metaphor",
      resolvedFrom: "title",
    });
  });

  it("does not guess when a title fragment matches several articles", () => {
    const result = resolveTaArticle("met", TA);
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.resolvedFrom).toBe("title");
    expect(result.candidates.map((c) => c.path).sort()).toEqual([
      "translate/figs-complexmetaphor",
      "translate/figs-metaphor",
      "translate/figs-metonymy",
    ]);
  });

  it("misses an unknown concept", () => {
    expect(resolveTaArticle("not-a-concept", TA)).toEqual({ status: "miss" });
  });
});
