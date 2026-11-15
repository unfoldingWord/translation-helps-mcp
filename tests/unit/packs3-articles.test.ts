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
import {
  articleCatalogFromPacks3,
  wordsPathFromPacks3,
  academyPathFromPacks3,
} from "../../src/packs3/adapters/articles";
import { answerFromPacks3 } from "../../src/packs3/answer";
import { injectFixtureProofs } from "./packs3-fixture-verified";

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

type Answer = Record<string, any>;
const sha = (t: unknown) => createHash("sha1").update(String(t)).digest("hex");
const words = (path: string, language = "en", requestedPath = path) =>
  wordsPathFromPacks3(env(), {
    pathParam: path,
    language,
    requestedPath,
    prepared: "1",
  }) as Promise<Answer | undefined>;
const academy = (path: string, language = "en", requestedPath = path) =>
  academyPathFromPacks3(env(), {
    pathParam: path,
    language,
    requestedPath,
    prepared: "1",
  }) as Promise<Answer | undefined>;

const SWEPT = [
  "bible/kt/call-speakloudly",
  "bible/kt/circumcise",
  "bible/kt/pastor",
  "translate/figs-metaphor",
];
beforeEach(async () => {
  resetPacks3CachesForTests();
  resetReadersForTests();
  resetWarnOnceForTests();
  await injectFixtureProofs(env(), undefined, {
    articles: SWEPT,
    search: ["covenant"],
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// Today's answers of the API Worker (GET /api/v1/words|academy/..., read 2026-11-12), as fields and the SHA-1 of the
// article text. The pack equals the live answer of 1,045 articles (en 221, es-419 824); the others differ in blank lines,
// trailing spaces or links that format 3 does not keep, and fall back.
const CALL = {
  language: "en",
  requestedLanguage: "en",
  path: "bible/kt/call-speakloudly",
  title: "call, called, call out, called out",
  related: [
    { path: "bible/kt/pray", title: "pray, prayer" },
    { path: "bible/other/cry", title: "cry, cry out, outcry" },
    { path: "bible/kt/call-tosummon", title: "call, called" },
    { path: "bible/kt/call-toname", title: "call, called" },
  ],
  source: {
    owner: "unfoldingWord",
    repo: "en_tw",
    version: "v91",
    language: "en",
  },
};
const CALL_SHA = "35917b7e9674a326eb0b2a65673de317cc4bd72e";

describe("articles", () => {
  it("en tW exact path: every field, related with titles, source", async () => {
    const a = await words("bible/kt/call-speakloudly");
    expect(a).toBeDefined();
    const { article, requestedPath, ...rest } = a!;
    expect(rest).toEqual(CALL);
    expect(requestedPath).toBe("bible/kt/call-speakloudly");
    expect(sha(article)).toBe(CALL_SHA);
    expect(Object.keys(a!)).toEqual([
      "language",
      "requestedLanguage",
      "path",
      "requestedPath",
      "title",
      "article",
      "related",
      "source",
    ]);
  });

  it("en tW term: the sweep records no term item, so it falls back", async () => {
    expect(await words("callspeakloudly")).toBeUndefined();
  });

  it("en tW rc link: the route echoes the rc form as requestedPath", async () => {
    const a = await words(
      "bible/kt/call-speakloudly",
      "en",
      "rc://*/tw/dict/bible/kt/call-speakloudly",
    );
    expect(a?.requestedPath).toBe("rc://*/tw/dict/bible/kt/call-speakloudly");
    expect(a?.resolvedFrom).toBeUndefined();
    expect(sha(a?.article)).toBe(CALL_SHA);
  });

  it("es-419 tW exact path and a term", async () => {
    const a = await words("bible/kt/circumcise", "es-419");
    expect(a?.title).toBe(
      "circuncidar, circuncidado, circuncisión, incircunciso, incircuncisión",
    );
    expect(sha(a?.article)).toBe("c1524bdcfb737eecaa9dd3a792ebda46a9716dc9");
    expect(a?.source).toEqual({
      owner: "es-419_gl",
      repo: "es-419_tw",
      version: "v37",
      language: "es-419",
    });
    expect(a?.related).toEqual([
      {
        path: "translate/translate-unknown",
        title: "Cómo traducir palabras desconocidas",
      },
      { path: "bible/names/abraham", title: "Abraham, Abram" },
      { path: "bible/kt/covenant", title: "pacto" },
    ]);
    const t = await words("bible/kt/pastor", "es-419");
    expect(t?.path).toBe("bible/kt/pastor");
    expect(t?.resolvedFrom).toBeUndefined();
    expect(sha(t?.article)).toBe("89829d59d41f2284fc4092e4c9236c371f30cc25");
    expect(await words("pastor", "es-419")).toBeUndefined();
  });

  it("en tA translate/figs-metaphor: subtitle, related from the body links, source", async () => {
    const a = await academy("translate/figs-metaphor");
    expect(a?.title).toBe("Metaphor");
    expect(a?.subtitle).toBe(
      "What is a metaphor and how can I translate a Bible passage that has one?",
    );
    expect(sha(a?.article)).toBe("78b67fb7088ff8eb2bb2a93e962865714431f220");
    expect(a?.related).toEqual([
      {
        path: "translate/bita-part1",
        title: "Biblical Imagery — Common Patterns",
      },
      { path: "translate/figs-simile", title: "Simile" },
      { path: "translate/translate-unknown", title: "Translate Unknowns" },
    ]);
    expect(a?.source).toEqual({
      owner: "unfoldingWord",
      repo: "en_ta",
      version: "v91",
      language: "en",
    });
  });

  it("falls back where equality is not proven", async () => {
    // Not in the sweep's list (en grace has ref: links, es-419 grace differs in its last newline).
    expect(await words("bible/kt/grace")).toBeUndefined();
    expect(await words("bible/kt/grace", "es-419")).toBeUndefined();
    // A tA term needs the whole manual catalog (no sweep item): the route decides.
    expect(await academy("metaphor")).toBeUndefined();
    // Not found: format 3 never says so, the route decides.
    expect(await words("bible/kt/zzzzqq")).toBeUndefined();
    expect(await academy("translate/zzzzqq")).toBeUndefined();
    // Not prepared, another language, requested "es" (the route resolves the variant).
    expect(
      await wordsPathFromPacks3(env(), {
        pathParam: "bible/kt/call-speakloudly",
        language: "en",
      }),
    ).toBeUndefined();
    expect(await words("bible/kt/grace", "fr")).toBeUndefined();
    expect(await words("bible/kt/circumcise", "es")).toBeUndefined();
  });

  it("sweep: a release bump, an exception and an unlisted id fall back", async () => {
    expect(await words("bible/kt/call-speakloudly")).toBeDefined();
    expect(await words("bible/kt/pray")).toBeUndefined();
    await injectFixtureProofs(
      env(),
      (t) => {
        for (const [k, e] of Object.entries(t))
          if (k.endsWith("|articles"))
            e.exceptions = ["bible/kt/call-speakloudly"];
      },
      { articles: SWEPT },
    );
    expect(await words("bible/kt/call-speakloudly")).toBeUndefined();
    expect(await academy("translate/figs-metaphor")).toBeDefined();
    await injectFixtureProofs(
      env(),
      (t) => {
        for (const k of Object.keys(t))
          if (k.endsWith("|articles")) {
            t[k.replace(/\|[^|]*\|articles$/, "|v0-bumped|articles")] = t[k]!;
            delete t[k];
          }
      },
      { articles: SWEPT },
    );
    expect(await words("bible/kt/call-speakloudly")).toBeUndefined();
    expect(await academy("translate/figs-metaphor")).toBeUndefined();
  });

  it("catalog: the tW catalog equals the route's list (953 en, 1055 es-419), only for a swept query", async () => {
    const proof = { kind: ["sea", "rch"].join(""), item: "covenant" };
    const en = await articleCatalogFromPacks3(env(), "en", "tw", proof);
    expect(en?.articles).toHaveLength(953);
    expect(en?.language).toBe("en");
    expect(en?.source.repo).toBe("en_tw");
    const es = await articleCatalogFromPacks3(env(), "es-419", "tw", proof);
    expect(es?.articles).toHaveLength(1055);
    // The fixtures hold only ta:translate: the whole tA catalog cannot be built.
    expect(
      await articleCatalogFromPacks3(env(), "en", "ta", proof),
    ).toBeUndefined();
    // Without a swept item the catalog is not served.
    expect(await articleCatalogFromPacks3(env(), "en", "tw")).toBeUndefined();
  });

  it("registered for both paths through answerFromPacks3", async () => {
    const w = await answerFromPacks3(
      env(),
      "/api/v1/words/bible/kt/call-speakloudly",
      {
        language: "en",
        requestedPath: "bible/kt/call-speakloudly",
        prepared: "1",
      },
    );
    expect((w as Answer)?.path).toBe("bible/kt/call-speakloudly");
    const a = await answerFromPacks3(
      env(),
      "/api/v1/academy/translate/figs-metaphor",
      {
        language: "en",
        requestedPath: "translate/figs-metaphor",
        prepared: "1",
      },
    );
    expect((a as Answer)?.path).toBe("translate/figs-metaphor");
  });
});
