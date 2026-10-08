/**
 * list_languages must let a caller find a language by its English name, not
 * only by its code or its native-script name (issue #49).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { listLanguagesTool } from "../../src/mcp/tools/listLanguages.js";

const LANGUAGES = [
  {
    code: "bn",
    name: "বাংলা",
    englishName: "Bengali, Bangla",
    direction: "ltr",
  },
  { code: "bns", name: "Bundeli", englishName: "Bundeli", direction: "ltr" },
  { code: "hi", name: "हिन्दी, हिंदी", englishName: "Hindi", direction: "ltr" },
  { code: "xx", name: "Example", direction: "ltr" },
];

/** Stands for the REST Data API behind the service binding. */
const env = {
  API: {
    fetch: async () => Response.json({ languages: LANGUAGES }),
  },
} as never;

async function list(filter?: string) {
  const result = await listLanguagesTool.handler(
    { filter, limit: 50, offset: 0 },
    env,
    "req_test",
  );
  return result.structuredContent as {
    total_count: number;
    languages: Array<{ code: string; name?: string; englishName?: string }>;
  };
}

describe("list_languages filter", () => {
  it.each([
    ["Bengali", ["bn"]],
    ["bangla", ["bn"]],
    ["Hindi", ["hi"]],
  ])("finds a language by its English name: %s", async (filter, codes) => {
    const found = await list(filter);
    expect(found.languages.map((l) => l.code)).toEqual(codes);
  });

  it("still matches the code and the native name", async () => {
    expect((await list("bn")).languages.map((l) => l.code)).toEqual([
      "bn",
      "bns",
    ]);
    expect((await list("বাংলা")).languages.map((l) => l.code)).toEqual(["bn"]);
  });

  it("returns the English name beside the native one, and omits it when unknown", async () => {
    const all = await list();
    expect(all.total_count).toBe(4);
    expect(all.languages[0]).toEqual({
      code: "bn",
      name: "বাংলা",
      englishName: "Bengali, Bangla",
    });
    expect(all.languages[3]).toEqual({ code: "xx", name: "Example" });
  });

  it("produces structuredContent that validates against the declared outputSchema", async () => {
    const schema = z.object(listLanguagesTool.outputSchema!);
    expect(schema.safeParse(await list("Hindi")).success).toBe(true);
  });
});
