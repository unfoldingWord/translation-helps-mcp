import { describe, expect, it } from "vitest";
import {
  languageOptions,
  loadLanguages,
} from "../../web/src/lib/try/languages.js";
import { toolsState } from "../../web/src/lib/try/guided.js";

type Fake = Parameters<typeof loadLanguages>[1];

const answering = (structured: unknown): Fake =>
  (async () => ({
    result: { structured },
    outcome: { kind: "ok" },
  })) as unknown as Fake;

describe("loadLanguages", () => {
  it("asks list_languages and names each language for people", async () => {
    const asked: unknown[][] = [];
    const call = (async (...args: unknown[]) => {
      asked.push(args);
      return {
        result: {
          structured: {
            languages: [
              { code: "en", englishName: "English", name: "English" },
              { code: "es-419", name: "Español" },
              { code: "xx" },
              { name: "no code" },
            ],
          },
        },
        outcome: { kind: "ok" },
      };
    }) as unknown as Fake;
    const list = await loadLanguages("https://example.test/mcp", call);
    expect(asked).toEqual([
      ["https://example.test/mcp", "list_languages", { limit: 9999 }],
    ]);
    expect(list).toEqual([
      { code: "en", name: "English" },
      { code: "es-419", name: "Español" },
      { code: "xx", name: "xx" },
    ]);
  });

  it("falls back to English when the server gives no list", async () => {
    const none = (async () => ({
      result: null,
      outcome: { kind: "network" },
    })) as unknown as Fake;
    expect(await loadLanguages("x", none)).toEqual([
      { code: "en", name: "English" },
    ]);
    expect(await loadLanguages("x", answering({ languages: "no" }))).toEqual([
      { code: "en", name: "English" },
    ]);
  });

  it("adds English when the list lacks it", async () => {
    const list = await loadLanguages(
      "x",
      answering({ languages: [{ code: "id", name: "Indonesian" }] }),
    );
    expect(list.map((l) => l.code)).toEqual(["en", "id"]);
  });
});

describe("languageOptions", () => {
  const list = [
    { code: "en", name: "English" },
    { code: "id", name: "Indonesian" },
  ];

  it("labels each language with its code", () => {
    expect(languageOptions(list, "id")).toEqual([
      { code: "en", label: "English (en)" },
      { code: "id", label: "Indonesian (id)" },
    ]);
  });

  it("keeps the language in use even when it is not listed", () => {
    expect(languageOptions(list, "zz")[0]).toEqual({
      code: "zz",
      label: "zz",
    });
  });
});

describe("toolsState", () => {
  it("opens a call in the Tools tab with a copy of its arguments", () => {
    const args = { reference: "1", language: "en" };
    const state = toolsState({ tool: "get_obs_story", args });
    expect(state).toEqual({ tab: "tools", tool: "get_obs_story", args });
    expect(state.args).not.toBe(args);
  });
});
