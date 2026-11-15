import { describe, it, expect, beforeEach, vi } from "vitest";

const seen: Array<{
  lang: string;
  need?: (r: { unitOf: unknown; size: unknown }) => number;
}> = [];

vi.mock("../../src/packs3/readers", async (orig) => {
  const m = await orig<typeof import("../../src/packs3/readers")>();
  return {
    ...m,
    withReader: (
      env: unknown,
      lang: string,
      use: unknown,
      opts?: { need?: never },
    ) => {
      seen.push({ lang, need: opts?.need });
      return m.withReader(env as never, lang, use as never, opts as never);
    },
  };
});

import { scriptureFromPacks3 } from "../../src/packs3/adapters/scripture";
import { READER_BYTE_BUDGET } from "../../src/packs3/readers";
import { resetPacks3CachesForTests } from "../../src/packs3/catalogs";
import { resetReadersForTests } from "../../src/packs3/readers";
import { injectFixtureProofs } from "./packs3-fixture-verified";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STAGING =
  "78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911";
const DIR = join(__dirname, "..", "fixtures", "packs3");
function env() {
  const objects: Record<string, Uint8Array> = {};
  for (const d of ["catalog", "seg"])
    for (const f of readdirSync(join(DIR, "v3", d)))
      objects[`v3/${d}/${f}`] = new Uint8Array(
        readFileSync(join(DIR, "v3", d, f)),
      );
  const bucket = {
    async get(key: string) {
      const bytes = objects[key];
      if (!bytes) return null;
      return {
        key,
        etag: `e-${key}`,
        size: bytes.length,
        body: new Response(bytes).body,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
  };
  return {
    LANGUAGE_PACKS: bucket as unknown as R2Bucket,
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: STAGING,
  };
}

beforeEach(async () => {
  seen.length = 0;
  resetPacks3CachesForTests();
  resetReadersForTests();
  await injectFixtureProofs(env() as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("scriptureFromPacks3 on a big en book", () => {
  it.each([
    ["Psalms 1:1", "psa", { "book:psa": 1097745, "orig:psa": 418898 }],
    ["Genesis 1:1", "gen", { "book:gen": 757575, "orig:gen": 374287 }],
  ])(
    "%s asks withReader for an exclusive reader through `need`",
    async (reference, code, sizes: Record<string, number>) => {
      await scriptureFromPacks3(env() as never, { reference, language: "en" });
      const call = seen.find((s) => s.lang === "en");
      expect(call?.need).toBeTypeOf("function");
      const probe = {
        unitOf: (cls: string, key: string) =>
          key === code ? `${cls}:${key}` : undefined,
        size: (u: string) => sizes[u] ?? 0,
      };
      expect(call!.need!(probe)).toBeGreaterThan(READER_BYTE_BUDGET);
    },
  );
});
