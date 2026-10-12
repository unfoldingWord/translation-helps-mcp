/**
 * Key terms for an Open Bible Stories reference (issue #35).
 *
 * `fetch_translation_word_links` only serves Scripture references, so there was
 * no way to go from an OBS story:frame to the translationWord articles flagged
 * in it, although the data is published (`en_obs-twl`, one `twl_OBS.tsv` with
 * the same story:frame references as the other OBS helps). The lookup is the
 * fifth OBS helps resource, `twl`, served by `fetch_obs_translation_word_links`.
 */

import { describe, expect, it } from "vitest";
import { getToolByMcpName } from "../src/config/tools-registry.js";
import { toOBSWordLink } from "../src/functions/obs-helps-service.js";
import { getMCPToolsList } from "../ui/src/lib/mcp/tools-list.js";
import { formatResponse } from "../ui/src/lib/responseFormatter.js";

/** Rows of twl_OBS.tsv as parseTSV returns them. */
const GOD = {
  Reference: "1:1",
  ID: "aoaa",
  Tags: "keyterm",
  OrigWords: "God",
  Occurrence: "1",
  TWLink: "rc://*/tw/dict/bible/kt/god",
};
const SPIRIT = {
  Reference: "1:1",
  ID: "ugeb",
  Tags: "keyterm",
  OrigWords: "Spirit",
  Occurrence: "1",
  TWLink: "rc://*/tw/dict/bible/kt/holyspirit",
};

describe("an OBS word-link row", () => {
  it("names the words in the story and the article they point to", () => {
    expect(toOBSWordLink(SPIRIT)).toEqual({
      id: "ugeb",
      reference: "1:1",
      tags: "keyterm",
      quote: "Spirit",
      occurrence: 1,
      // What fetch_translation_word takes as `path`.
      externalReference: {
        target: "tw",
        path: "bible/kt/holyspirit",
        category: "kt",
      },
    });
  });

  it("is kept without an article when its link is not a translationWord link", () => {
    const link = toOBSWordLink({
      ...GOD,
      TWLink: "not-a-link",
      Occurrence: "",
    });
    expect(link).toEqual({
      id: "aoaa",
      reference: "1:1",
      tags: "keyterm",
      quote: "God",
      occurrence: 1,
    });
  });
});

describe("fetch_obs_translation_word_links", () => {
  it("is registered beside the other OBS tools, on its own endpoint", () => {
    const tool = getToolByMcpName("fetch_obs_translation_word_links");
    expect(tool).toBeDefined();
    expect(tool?.endpoint).toBe("fetch-obs-translation-word-links");
    expect(tool?.category).toBe("Open Bible Stories");
    expect(tool?.requiredParams).toEqual(["reference"]);
  });

  it("is offered to MCP clients with the OBS reference schema", () => {
    const tool = getMCPToolsList().find(
      (t) => t.name === "fetch_obs_translation_word_links",
    );
    expect(tool).toBeDefined();
    const properties = (tool?.inputSchema as { properties?: object })
      .properties;
    expect(properties).toHaveProperty("reference");
    expect(properties).toHaveProperty("language");
  });
});

describe("OBS word links as markdown", () => {
  const result = {
    reference: "1:1",
    language: "en",
    resourceType: "twl",
    items: [toOBSWordLink(GOD), toOBSWordLink(SPIRIT)],
    metadata: {
      resourceType: "twl",
      language: "en",
      organization: "unfoldingWord",
      license: "CC BY-SA 4.0",
    },
  };

  it("has one entry per key term, titled by the words in the story", () => {
    const markdown = formatResponse(result, { format: "md" }) as string;
    expect(markdown.startsWith("# Translation Twl\n")).toBe(true);
    expect(markdown.match(/^## \d+\. .*$/gm)).toEqual([
      "## 1. God",
      "## 2. Spirit",
    ]);
    expect(markdown).toContain("**Translation Word**: bible/kt/god");
    expect(markdown).toContain("**Translation Word**: bible/kt/holyspirit");
  });

  it("reads the same way as text", () => {
    const text = formatResponse(result, { format: "text" }) as string;
    expect(text).toContain("1. God");
    expect(text).toContain("Translation Word: bible/kt/holyspirit");
  });
});
