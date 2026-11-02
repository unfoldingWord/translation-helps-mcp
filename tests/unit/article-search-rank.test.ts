import { describe, expect, it } from "vitest";
import { rankArticles } from "@translation-helps/door43";

describe("rankArticles", () => {
  it("ranks an exact title ahead of a title that only contains the query", () => {
    const ranked = rankArticles(
      [
        {
          path: "translate/figs-complexmetaphor",
          title: "Complex Metaphor",
          category: "translate",
          resourceType: "ta",
        },
        {
          path: "translate/figs-metaphor",
          title: "Metaphor",
          category: "translate",
          resourceType: "ta",
        },
        {
          path: "translate/figs-metonymy",
          title: "Metonymy",
          category: "translate",
          resourceType: "ta",
        },
        {
          path: "bible/kt/hades",
          title: "Hades, Sheol",
          category: "kt",
          resourceType: "tw",
        },
      ],
      "metaphor",
      10,
    );
    expect(ranked.map((item) => item.path)).toEqual([
      "translate/figs-metaphor",
      "translate/figs-complexmetaphor",
    ]);
    expect(ranked[0]?.score).toBe(1);
    expect(ranked[1]?.score).toBeLessThan(ranked[0]?.score ?? 0);
  });

  it("treats a comma-separated alternate name as an exact title", () => {
    const ranked = rankArticles(
      [
        {
          path: "bible/kt/hades",
          title: "Hades, Sheol",
          category: "kt",
          resourceType: "tw",
        },
      ],
      "sheol",
      5,
    );
    expect(ranked[0]).toMatchObject({ path: "bible/kt/hades", score: 1 });
  });
});
