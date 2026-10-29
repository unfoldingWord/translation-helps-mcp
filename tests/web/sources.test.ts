import { describe, expect, it } from "vitest";
import { sourceLine } from "../../web/src/lib/try/sources.js";
import { LICENCE, RESOURCES } from "../../web/src/lib/resources.js";

const repo = (id: string) => RESOURCES.find((r) => r.id === id)!.door43;
const hrefs = (tool: string, structured?: Record<string, unknown>) =>
  sourceLine(tool, structured)?.sources.map((s) => s.href);

describe("sourceLine: where an answer comes from", () => {
  it("gives every answer with content the CC BY-SA 4.0 licence", () => {
    expect(sourceLine("get_note")?.licence).toEqual(LICENCE);
    expect(LICENCE.href).toBe(
      "https://creativecommons.org/licenses/by-sa/4.0/",
    );
  });

  it("links the one resource a tool returns, from RESOURCES", () => {
    expect(hrefs("get_note")).toEqual([repo("tn")]);
    expect(hrefs("get_word_article")).toEqual([repo("tw")]);
    expect(hrefs("get_academy_article")).toEqual([repo("ta")]);
    expect(hrefs("get_questions")).toEqual([repo("tq")]);
    expect(hrefs("get_obs_story")).toEqual([repo("obs")]);
    expect(sourceLine("get_note")?.sources[0].label).toBe("unfoldingWord® TN");
  });

  it("links the OBS notes and questions and the passage context to their own repositories", () => {
    expect(hrefs("get_obs_notes")).toEqual([
      "https://git.door43.org/unfoldingWord/en_obs-tn",
    ]);
    expect(hrefs("get_obs_questions")).toEqual([
      "https://git.door43.org/unfoldingWord/en_obs-tq",
    ]);
    expect(hrefs("get_obs_study_notes")).toEqual([
      "https://git.door43.org/unfoldingWord/en_obs-sn",
    ]);
    expect(hrefs("get_obs_study_questions")).toEqual([
      "https://git.door43.org/unfoldingWord/en_obs-sq",
    ]);
    expect(hrefs("get_passage_context")).toEqual([repo("tn")]);
  });

  it("links each version get_passage names, from the answer", () => {
    const line = sourceLine("get_passage", {
      language: "en",
      versions: [
        {
          resourceType: "ult",
          source: "https://git.door43.org/unfoldingWord/en_ult/archive/v91.zip",
        },
        {
          resourceType: "ust",
          source: "https://git.door43.org/unfoldingWord/en_ust/archive/v91.zip",
        },
        {
          resourceType: "ugnt",
          source:
            "https://git.door43.org/unfoldingWord/el-x-koine_ugnt/archive/v0.34.zip",
        },
      ],
    });
    expect(line?.sources).toEqual([
      { label: "unfoldingWord® ULT", href: repo("ult") },
      { label: "unfoldingWord® UST", href: repo("ust") },
      {
        label: "unfoldingWord® UGNT",
        href: "https://git.door43.org/unfoldingWord/el-x-koine_ugnt",
      },
    ]);
  });

  it("falls back to ULT and UST when get_passage names no source", () => {
    expect(hrefs("get_passage", { versions: [] })).toEqual([
      repo("ult"),
      repo("ust"),
    ]);
  });

  it("links the unfoldingWord helps for a tool that spans several resources", () => {
    expect(hrefs("get_passage_index")).toEqual([
      "https://git.door43.org/unfoldingWord",
    ]);
    expect(sourceLine("get_passage_index")?.sources[0].label).toBe(
      "unfoldingWord translation helps",
    );
  });

  it("links the Door43 catalog for another language", () => {
    expect(hrefs("get_note", { language: "es-419" })).toEqual([
      "https://git.door43.org/catalog",
    ]);
  });

  it("gives no line for the discovery tools", () => {
    expect(sourceLine("list_languages")).toBeNull();
    expect(sourceLine("list_resources")).toBeNull();
    expect(sourceLine("")).toBeNull();
  });
});
