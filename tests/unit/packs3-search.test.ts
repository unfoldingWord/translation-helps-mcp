import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  resetPacks3CachesForTests,
  type Packs3Env,
} from "../../src/packs3/catalogs";
import { resetReadersForTests } from "../../src/packs3/readers";
import { resetWarnOnceForTests } from "../../src/packs3/keys";
import { searchFromPacks3 } from "../../src/packs3/adapters/search";
import { answerFromPacks3 } from "../../src/packs3/answer";

const STAGING =
  "78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911";
const DIR = join(__dirname, "..", "fixtures", "packs3");

function env(): Packs3Env {
  const objects: Record<string, Uint8Array> = {};
  for (const d of ["catalog", "seg"]) {
    for (const f of readdirSync(join(DIR, "v3", d))) {
      objects[`v3/${d}/${f}`] = new Uint8Array(
        readFileSync(join(DIR, "v3", d, f)),
      );
    }
  }
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
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      };
    },
  };
  return {
    LANGUAGE_PACKS: bucket as unknown as R2Bucket,
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: STAGING,
  };
}

beforeEach(() => {
  resetPacks3CachesForTests();
  resetReadersForTests();
  resetWarnOnceForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// Live answers of the API Worker (GET /api/v1/search, read 2026-11-12).
const LIVE_EN = {
  q: "covenant",
  language: "en",
  requestedLanguage: "en",
  results: [
    {
      path: "bible/kt/covenant",
      title: "covenant",
      resourceType: "tw",
      score: 1,
    },
    {
      path: "bible/kt/covenantfaith",
      title: "covenant faithfulness, covenant loyalty, covenant love",
      resourceType: "tw",
      score: 0.75,
    },
    {
      path: "bible/kt/arkofthecovenant",
      title:
        "ark of the covenant, ark of Yahweh, box, Box of the Testimony, Box of the Covenant of Yahweh",
      resourceType: "tw",
      score: 0.5,
    },
  ],
};
const LIVE_ES = {
  q: "covenant",
  language: "es-419",
  requestedLanguage: "es-419",
  results: [
    {
      path: "bible/kt/arkofthecovenant",
      title: "Arca del pacto, arca de los decretos del pacto, arca del SEÑOR",
      resourceType: "tw",
      score: 0.5,
    },
    {
      path: "bible/kt/covenant",
      title: "pacto",
      resourceType: "tw",
      score: 0.5,
    },
    {
      path: "bible/kt/covenantfaith",
      title:
        "Fidelidad de pacto, lealtad de pacto, misericordia, amor infalible",
      resourceType: "tw",
      score: 0.5,
    },
    {
      path: "bible/other/newcovenant",
      title: "Nuevo pacto",
      resourceType: "tw",
      score: 0.5,
    },
  ],
};

const search = (q: string, language: string, extra: object = {}) =>
  searchFromPacks3(env(), { q, language, types: "tw", ...extra });

describe("search from format 3", () => {
  it("covenant, tw only, en: same results and order as the route", async () => {
    expect(await search("covenant", "en")).toEqual(LIVE_EN);
  });
  it("covenant, tw only, es-419: same results and order as the route", async () => {
    expect(await search("covenant", "es-419")).toEqual(LIVE_ES);
  });
  it("is registered for /api/v1/search", async () => {
    expect(
      await answerFromPacks3(env(), "/api/v1/search", {
        q: "covenant",
        language: "en",
        types: "tw",
      }),
    ).toEqual(LIVE_EN);
  });
  it("falls back when a tA catalog is needed (not pinned): figures of speech, abstract nouns, metáfora", async () => {
    expect(
      await searchFromPacks3(env(), { q: "figures of speech", language: "en" }),
    ).toBeUndefined();
    expect(
      await search("abstract nouns", "en", { types: "ta" }),
    ).toBeUndefined();
    expect(
      await searchFromPacks3(env(), { q: "metáfora", language: "es-419" }),
    ).toBeUndefined();
  });
  it("falls back for limit, other types, other languages, a q not normalized", async () => {
    expect(await search("covenant", "en", { limit: 3 })).toBeUndefined();
    expect(await search("covenant", "en", { types: "tw,ta" })).toBeUndefined();
    expect(await search("covenant", "es")).toBeUndefined();
    expect(await search("Covenant", "en")).toBeUndefined();
    expect(await search("", "en")).toBeUndefined();
  });
});
