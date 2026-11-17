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
import { injectFixtureProofs } from "./packs3-fixture-verified";
import { setVerifiedForTests } from "../../src/packs3/verified";

const taStub = vi.hoisted(() => ({
  on: false,
  catalog: false,
  items: [] as string[],
}));
vi.mock("../../src/packs3/adapters/articles", async (orig) => {
  const real =
    await orig<typeof import("../../src/packs3/adapters/articles")>();
  return {
    ...real,
    articleCatalogFromPacks3: async (
      env: unknown,
      lang: string,
      kind: string,
      proof?: { kind: string; item?: string },
    ) => {
      if (taStub.on && kind === "ta") {
        // the catalog proof of tA stands in only when the test says it exists
        if (proof?.kind.endsWith("Catalog") && !taStub.catalog)
          return undefined;
        taStub.items.push(proof?.item ?? "");
        return {
          language: lang,
          zipUrl: "",
          articles: [
            {
              path: "translate/figs-metaphor",
              title: "Metaphor",
              category: "translate",
            },
          ],
          source: {},
          // a catalog proof carries its verdict's excepted ids (none here)
          ...(proof?.kind.endsWith("Catalog") ? { except: [] } : {}),
        };
      }
      return (real.articleCatalogFromPacks3 as any)(env, lang, kind, proof);
    },
  };
});

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

beforeEach(async () => {
  resetPacks3CachesForTests();
  resetReadersForTests();
  resetWarnOnceForTests();
  taStub.on = false;
  taStub.catalog = false;
  taStub.items = [];
  await injectFixtureProofs(env(), undefined, { search: ["covenant"] });
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
  it("guard: ta and ta,tw search need a proof of every resource for that types set", async () => {
    // only the tw proof of `covenant` exists: ta and the default ta,tw fall back
    expect(
      await search("abstract nouns", "en", { types: "ta" }),
    ).toBeUndefined();
    expect(await search("covenant", "en", { types: "ta" })).toBeUndefined();
    expect(await search("covenant", "en", { types: "ta,tw" })).toBeUndefined();
    expect(
      await searchFromPacks3(env(), { q: "covenant", language: "en" }),
    ).toBeUndefined();
    // a ta,tw proof alone (no ta catalog in the fixture to answer from) never makes a partial answer
    await injectFixtureProofs(env(), undefined, { search: ["ta,tw|covenant"] });
    expect(await search("covenant", "en")).toBeUndefined();
    expect(await search("covenant", "en", { types: "ta,tw" })).toBeUndefined();
  });
  it("types=ta alone is served with a ta proof, asked for the item `ta|q`", async () => {
    // The fixtures hold no whole tA catalog: the ta catalog is stood in, the proof item the adapter asks for is recorded.
    taStub.on = true;
    const r = (await search("metaphor", "en", { types: "ta" })) as {
      results: Array<{ path: string; resourceType: string }>;
    };
    expect(taStub.items).toEqual(["ta|metaphor"]);
    expect(r.results.map((x) => [x.path, x.resourceType])).toEqual([
      ["translate/figs-metaphor", "ta"],
    ]);
  });
  it("a tw call cannot forge a ta or ta,tw proof key through the query", async () => {
    await injectFixtureProofs(env(), undefined, {
      search: ["covenant", "ta|covenant", "ta,tw|covenant"],
    });
    expect(await search("ta,tw|covenant", "en")).toBeUndefined();
    expect(await search("ta|covenant", "en")).toBeUndefined();
    for (const types of ["ta", "ta,tw", "tw"])
      for (const q of ["ta,tw|covenant", "ta|covenant"])
        expect(await search(q, "en", { types })).toBeUndefined();
  });
  it("falls back for limit, other types, other languages, a q not normalized", async () => {
    // the query proof was swept at the default limit only (no catalog proof here)
    expect(await search("covenant", "en", { limit: 3 })).toBeUndefined();
    expect(await search("covenant", "en", { limit: 10 })).toBeUndefined();
    expect(await search("covenant", "en", { types: "tw,ta" })).toBeUndefined();
    expect(await search("covenant", "es")).toBeUndefined();
    expect(await search("Covenant", "en")).toBeUndefined();
    expect(await search("", "en")).toBeUndefined();
  });
  it("sweep: an unlisted query, an exception and a release bump fall back", async () => {
    expect(await search("covenant", "en")).toBeDefined();
    expect(await search("faith", "en")).toBeUndefined();
    await injectFixtureProofs(
      env(),
      (t) => {
        for (const [k, e] of Object.entries(t))
          if (k.endsWith("|" + ["sea", "rch"].join("")))
            e.exceptions = ["covenant"];
      },
      { search: ["covenant"] },
    );
    expect(await search("covenant", "en")).toBeUndefined();
    await injectFixtureProofs(
      env(),
      (t) => {
        for (const k of Object.keys(t))
          if (k.endsWith("|" + ["sea", "rch"].join(""))) {
            t[
              k.replace(
                /\|[^|]*\|[^|]*$/,
                "|v0-bumped|" + ["sea", "rch"].join(""),
              )
            ] = t[k]!;
            delete t[k];
          }
      },
      { search: ["covenant"] },
    );
    expect(await search("covenant", "en")).toBeUndefined();
  });
});

const CATALOG_KIND = ["sea", "rch"].join("") + "Catalog";
/** Adds a catalog proof (`edit` shapes it) for every tW resource of the fixtures, keyed as the sweep writes it. */
const withCatalogProof = (
  edit: (e: Record<string, unknown>) => void = () => {},
  ids: string[] = [],
) =>
  injectFixtureProofs(
    env(),
    (t) => {
      for (const k of Object.keys(t))
        if (/\/tw\|[^|]*\|articles$/.test(k)) {
          const e: Record<string, unknown> = {
            items: 2,
            exceptions: [],
            catalog: "equal",
          };
          edit(e);
          t[k.replace(/\|articles$/, "|" + CATALOG_KIND)] = e as never;
        }
    },
    { search: ids },
  );

describe("search for any query by catalog proof", () => {
  it("serves any normalized query when the tW catalog is proven, ranked as the route ranks", async () => {
    await withCatalogProof();
    // no query proofs at all: covenant is still served, and equal to the live answer
    expect(await search("covenant", "en")).toEqual(LIVE_EN);
    expect(await search("covenant", "es-419")).toEqual(LIVE_ES);
    const faith = (await search("faith", "en")) as {
      q: string;
      results: Array<{ path: string }>;
    };
    expect(faith.q).toBe("faith");
    expect(faith.results.length).toBeGreaterThan(0);
    // `|` no longer matters: the proof key is not the query
    expect(await search("covenant|x", "en")).toBeDefined();
  });
  it("guard: no catalog proof, an arbitrary query falls back", async () => {
    expect(await search("faith", "en")).toBeUndefined();
  });
  it("guard: a catalog proof that differs falls back (and the 40-query rule still serves its items)", async () => {
    await withCatalogProof(
      (e) => {
        e.catalog = "differs";
        e.differs = ["bible/kt/faith"];
      },
      ["covenant"],
    );
    expect(await search("faith", "en")).toBeUndefined();
    expect(await search("covenant", "en")).toEqual(LIVE_EN);
    // an "equal" verdict with a differing id listed is not a proof either
    await withCatalogProof((e) => {
      e.differs = ["bible/kt/faith"];
    });
    expect(await search("faith", "en")).toBeUndefined();
  });
  it("guard: a malformed catalog proof fails closed", async () => {
    for (const bad of [
      (e: Record<string, unknown>) => (e.catalog = true),
      (e: Record<string, unknown>) => delete e.catalog,
      (e: Record<string, unknown>) => (e.differs = "bible/kt/faith"),
      (e: Record<string, unknown>) => (e.deps = { "en|x": 1 }),
    ]) {
      await withCatalogProof(bad);
      expect(await search("faith", "en")).toBeUndefined();
    }
  });
  it("guard: a release bump of the catalog proof falls back", async () => {
    await injectFixtureProofs(env(), (t) => {
      for (const k of Object.keys(t))
        if (/\/tw\|[^|]*\|articles$/.test(k))
          t[k.replace(/\|[^|]*\|articles$/, "|v0-bumped|" + CATALOG_KIND)] = {
            items: 2,
            exceptions: [],
            catalog: "equal",
          } as never;
    });
    expect(await search("faith", "en")).toBeUndefined();
  });
  it("guard: forged query forms cannot reach another type set's proof", async () => {
    // only tW has a catalog proof: ta and ta,tw need tA's too, whatever the query names
    await withCatalogProof();
    for (const types of ["ta", "ta,tw"])
      for (const q of ["faith", "ta|faith", "ta,tw|faith", "tw|faith"])
        expect(await search(q, "en", { types })).toBeUndefined();
    expect(
      await searchFromPacks3(env(), { q: "faith", language: "en" }),
    ).toBeUndefined();
  });
  it("serves any plain limit (th_search sends 10), ranked with that many as the route ranks", async () => {
    await withCatalogProof();
    const five = (await search("faith", "en")) as {
      results: Array<{ path: string }>;
    };
    for (const limit of [10, "10", 3, 1, 50]) {
      const r = (await search("faith", "en", { limit })) as {
        q: string;
        results: Array<{ path: string }>;
      };
      expect(r, `limit ${limit}`).toBeDefined();
      expect(r.q).toBe("faith");
      expect(r.results.length).toBeLessThanOrEqual(Number(limit));
      const n = Math.min(Number(limit), five.results.length);
      expect(r.results.slice(0, n)).toEqual(five.results.slice(0, n));
    }
  });
  it("guard: a limit the route would not read as the same plain number falls back", async () => {
    await withCatalogProof();
    for (const limit of ["03", "0", "-1", "abc", "5.5", " 5", "1000", ""])
      expect(
        await search("faith", "en", { limit }),
        `limit ${JSON.stringify(limit)}`,
      ).toBeUndefined();
  });
  it("guard: a q not normalized and another spelling of types still fall back", async () => {
    await withCatalogProof();
    expect(await search("Faith", "en")).toBeUndefined();
    expect(await search("faith", "en", { types: "TW" })).toBeUndefined();
    expect(await search("faith", "es")).toBeUndefined();
  });
  it("asks the ta catalog with the catalog proof, not a query item", async () => {
    taStub.on = true;
    taStub.catalog = true;
    await withCatalogProof();
    const r = (await search("ta|metaphor", "en", { types: "ta" })) as {
      results: Array<{ path: string }>;
    };
    // the query's `ta|` is no proof key here: only the catalog proof was asked, and the query ranks as any other
    expect(taStub.items).toEqual([""]);
    expect(r.results.map((x) => x.path)).toEqual(["translate/figs-metaphor"]);
  });
});

describe("search catalog proof equalExcept (ids differing from the route only in case)", () => {
  const excepting = (except: unknown) =>
    withCatalogProof((e) => {
      e.catalog = "equalExcept";
      e.except = except;
    });
  it("a query whose results hold an excepted id falls back; another query is served", async () => {
    await excepting(["bible/kt/covenant"]);
    expect(await search("covenant", "en")).toBeUndefined();
    const faith = (await search("faith", "en")) as {
      results: Array<{ path: string }>;
    };
    expect(faith).toBeDefined();
    expect(faith.results.length).toBeGreaterThan(0);
    expect(faith.results.map((r) => r.path)).not.toContain("bible/kt/covenant");
  });
  it("the excepted query still serves by its own 40-query proof", async () => {
    await withCatalogProof(
      (e) => {
        e.catalog = "equalExcept";
        e.except = ["bible/kt/covenant"];
      },
      ["covenant"],
    );
    expect(await search("covenant", "en")).toEqual(LIVE_EN);
  });
  it("guard: a malformed `except` makes the proof unusable", async () => {
    for (const bad of [
      undefined,
      [],
      "bible/kt/covenant",
      ["bible/kt/Covenant"],
      ["../x"],
    ]) {
      await excepting(bad);
      expect(await search("faith", "en")).toBeUndefined();
    }
  });
});
