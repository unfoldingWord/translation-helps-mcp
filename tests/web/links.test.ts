import { describe, expect, it } from "vitest";
import {
  linkFromAnswer,
  linkTarget,
  type LinkFrom,
} from "../../web/src/lib/try/links.js";

const word: LinkFrom = { kind: "word", path: "bible/kt/love.md" };
const academy: LinkFrom = {
  kind: "academy",
  path: "translate/figs-metonymy/01.md",
};

describe("linkTarget: rc:// links", () => {
  it("opens the Academy article an rc link names, in any language", () => {
    expect(linkTarget("rc://*/ta/man/translate/figs-metonymy")).toEqual({
      kind: "academy",
      key: "translate/figs-metonymy",
    });
    expect(linkTarget("rc://en/ta/man/checking/acceptable/01.md")).toEqual({
      kind: "academy",
      key: "checking/acceptable",
    });
  });

  it("opens the Words article an rc link names", () => {
    expect(linkTarget("rc://*/tw/dict/bible/kt/sin")).toEqual({
      kind: "word",
      key: "bible/kt/sin",
    });
    expect(linkTarget("rc://*/tw/dict/bible/names/abraham.md")).toEqual({
      kind: "word",
      key: "bible/names/abraham",
    });
  });

  it("opens nothing for other rc kinds and odd paths", () => {
    // A verse's notes, as word articles link their Bible references.
    expect(linkTarget("rc://en/tn/help/jhn/03/16", word)).toBeNull();
    expect(linkTarget("rc://*/ta/dict/translate/x")).toBeNull();
    expect(linkTarget("rc://*/ta/man/translate")).toBeNull();
    expect(linkTarget("rc://*/tw/dict/bible/kt")).toBeNull();
    expect(linkTarget("rc://*/tw/dict/bible/kt/<script>")).toBeNull();
    expect(linkTarget("rc://*/ta/man/translate/../../etc")).toBeNull();
  });
});

describe("linkTarget: relative links", () => {
  it("resolves a word article's See also links to other word articles", () => {
    expect(linkTarget("../kt/covenant.md", word)).toEqual({
      kind: "word",
      key: "bible/kt/covenant",
    });
    expect(linkTarget("../other/death.md", word)).toEqual({
      kind: "word",
      key: "bible/other/death",
    });
  });

  it("resolves an Academy article's links to other Academy articles", () => {
    expect(linkTarget("../bita-part2/01.md", academy)).toEqual({
      kind: "academy",
      key: "translate/bita-part2",
    });
    expect(linkTarget("../../checking/acceptable/01.md", academy)).toEqual({
      kind: "academy",
      key: "checking/acceptable",
    });
  });

  it("opens nothing when the article it sits in is not known", () => {
    // Notes link other notes of the book this way (../01/01.md).
    expect(linkTarget("../01/01.md")).toBeNull();
    expect(linkTarget("../kt/covenant.md", null)).toBeNull();
  });

  it("opens nothing for links that leave the resource or are not article files", () => {
    expect(linkTarget("../../../x.md", word)).toBeNull();
    expect(linkTarget("../kt/covenant", word)).toBeNull();
    expect(linkTarget("#", word)).toBeNull();
    expect(linkTarget("/v2/try", word)).toBeNull();
    expect(linkTarget("javascript:alert(1)", word)).toBeNull();
    expect(linkTarget("https://door43.org/x.md", word)).toBeNull();
  });
});

describe("linkFromAnswer", () => {
  it("names the article of a word or Academy answer by its path", () => {
    expect(
      linkFromAnswer("get_word_article", { path: "bible/kt/love.md" }),
    ).toEqual(word);
    expect(
      linkFromAnswer("get_academy_article", {
        path: "translate/figs-metonymy/01.md",
      }),
    ).toEqual(academy);
  });

  it("is null for other answers", () => {
    expect(linkFromAnswer("get_note", { path: "x" })).toBeNull();
    expect(linkFromAnswer("get_word_article", {})).toBeNull();
    expect(linkFromAnswer("get_word_article", null)).toBeNull();
  });
});
