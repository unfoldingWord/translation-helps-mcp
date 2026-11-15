import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  resetPacks3CachesForTests,
  type Packs3Env,
} from "../../src/packs3/catalogs";
import { resetReadersForTests } from "../../src/packs3/readers";

const mismatch = vi.hoisted(() => ({ on: false }));
vi.mock("../../src/packs3/readers", async (orig) => {
  const m = await orig<typeof import("../../src/packs3/readers")>();
  return {
    ...m,
    withReader: (env: any, lang: string, fn: any) =>
      m.withReader(env, lang, (reader: any, c: any) =>
        fn(
          mismatch.on
            ? {
                ...reader,
                listed: (u: string) => reader.listed(u),
                articles: async (g: string) => {
                  const rs = (await reader.articles(g)) as any[];
                  return g === "tw:kt"
                    ? rs?.map((r, i) =>
                        i === 0
                          ? { ...r, id: r.id.replace("tw:kt/", "tw:other/") }
                          : r,
                      )
                    : rs;
                },
              }
            : reader,
          c,
        ),
      ),
  };
});
import { resetWarnOnceForTests } from "../../src/packs3/keys";
import {
  articleCatalogFromPacks3,
  wordsPathFromPacks3,
  academyPathFromPacks3,
  bodyOf,
  resetArticleGroupsForTests,
} from "../../src/packs3/adapters/articles";
import { answerFromPacks3, attemptPacks3 } from "../../src/packs3/answer";
import { jsonArticleMatch } from "../../src/api/routes/articleResponse";
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

  it("a group whose ids sit in another directory is unusable: falls back", async () => {
    expect((await words("bible/kt/call-speakloudly"))?.path).toBe(
      "bible/kt/call-speakloudly",
    );
    mismatch.on = true;
    try {
      resetPacks3CachesForTests();
      resetReadersForTests();
      resetArticleGroupsForTests();
      expect(await words("bible/kt/call-speakloudly")).toBeUndefined();
    } finally {
      mismatch.on = false;
    }
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

/** The fixture proofs plus `terms` on the articles entry of one language and kind (`edit` changes that entry more). */
const withTerms = (
  lang: string,
  kind: "tw" | "ta",
  terms: unknown,
  edit: (e: Record<string, unknown>) => void = () => {},
) =>
  injectFixtureProofs(
    env(),
    (t) => {
      for (const [k, e] of Object.entries(t))
        if (
          k.startsWith(`${lang}|`) &&
          k.endsWith("|articles") &&
          k.includes(`/${kind}|`)
        ) {
          (e as Record<string, unknown>).terms = terms;
          edit(e as Record<string, unknown>);
        }
    },
    { articles: SWEPT },
  );

describe("articles by term and title (sweep `terms`)", () => {
  it("serves a swept term that resolves to its recorded, clean article", async () => {
    await withTerms("en", "tw", {
      "bible/kt": "call-speakloudly:callspeakloudly",
    });
    const a = await words("callspeakloudly");
    expect(a?.path).toBe("bible/kt/call-speakloudly");
    expect(a?.resolvedFrom).toBe("category");
    expect(a?.requestedPath).toBe("callspeakloudly");
    expect(a?.title).toBe(CALL.title);
    expect(sha(a?.article)).toBe(CALL_SHA);
    // The term key is case-folded (the resolvers fold case); the route's echo is the caller's own.
    const b = await words("CallSpeakLoudly", "en", "CallSpeakLoudly");
    expect(b?.path).toBe("bible/kt/call-speakloudly");
    expect(b?.requestedPath).toBe("CallSpeakLoudly");
  });

  it("`=` stands for the article's own name; es-419 has its own proof", async () => {
    await withTerms("es-419", "tw", { "bible/kt": "pastor:=" });
    const t = await words("pastor", "es-419");
    expect(t?.path).toBe("bible/kt/pastor");
    expect(t?.resolvedFrom).toBe("category");
    expect(sha(t?.article)).toBe("89829d59d41f2284fc4092e4c9236c371f30cc25");
  });

  it("an unswept term falls back", async () => {
    await withTerms("en", "tw", {
      "bible/kt": "call-speakloudly:callspeakloudly",
    });
    expect(await words("circumcise")).toBeUndefined();
    expect(await words("pastor")).toBeUndefined();
  });

  it("a term listed under another article than it resolves to falls back", async () => {
    await withTerms("en", "tw", { "bible/kt": "pastor:callspeakloudly" });
    expect(await words("callspeakloudly")).toBeUndefined();
  });

  it("a term whose article is an exception (or not a clean item) falls back", async () => {
    await withTerms(
      "en",
      "tw",
      { "bible/kt": "call-speakloudly:callspeakloudly,pray:=" },
      (e) => {
        e.exceptions = ["bible/kt/call-speakloudly"];
      },
    );
    expect(await words("callspeakloudly")).toBeUndefined();
    // bible/kt/pray is not a swept item
    expect(await words("pray")).toBeUndefined();
  });

  it("the proof of one language or resource cannot serve another", async () => {
    await withTerms("en", "tw", { "bible/kt": "pastor:=" });
    expect(await words("pastor", "es-419")).toBeUndefined();
    await withTerms("es-419", "tw", {
      "bible/kt": "call-speakloudly:callspeakloudly",
    });
    expect(await words("callspeakloudly")).toBeUndefined();
    // tW terms recorded on the tA entry
    await withTerms("en", "ta", {
      "bible/kt": "call-speakloudly:callspeakloudly",
    });
    expect(await words("callspeakloudly")).toBeUndefined();
  });

  it("a tA term needs the whole manual catalog (the fixtures hold only ta:translate): falls back", async () => {
    await withTerms("en", "ta", { translate: "figs-metaphor:metaphor" });
    expect(await academy("metaphor")).toBeUndefined();
  });

  it("a path with a slash is never a term item", async () => {
    await withTerms("en", "tw", {
      "bible/kt": "call-speakloudly:callspeakloudly",
    });
    expect(await words("kt/callspeakloudly")).toBeUndefined();
  });

  it("malformed `terms` makes the whole entry unusable (fails closed)", async () => {
    for (const bad of [
      { "bible/kt": "call-speakloudly" },
      { "bible/kt": "call-speakloudly:" },
      { "bible/kt": ["call-speakloudly:callspeakloudly"] },
      { "bible/kt": "call-speakloudly:a||b" },
      "bible/kt",
    ]) {
      await withTerms("en", "tw", bad);
      expect(await words("callspeakloudly")).toBeUndefined();
      expect(await words("bible/kt/call-speakloudly")).toBeUndefined();
    }
  }, 20_000); // each loop pass re-injects the 182 KB proof table and rebuilds the catalogs: slow under a full run
});

/**
 * The fixture proofs plus `misses` on the articles entry of one language and kind and, unless `catalog` is false, an
 * equal search catalog proof of the same resource release.
 */
const withMisses = (
  lang: string,
  kind: "tw" | "ta",
  misses: unknown,
  {
    catalog = true,
    edit = () => {},
  }: {
    catalog?: boolean;
    edit?: (e: Record<string, unknown>) => void;
  } = {},
) =>
  injectFixtureProofs(
    env(),
    (t) => {
      for (const [k, e] of Object.entries(t))
        if (
          k.startsWith(`${lang}|`) &&
          k.endsWith("|articles") &&
          k.includes(`/${kind}|`)
        ) {
          (e as Record<string, unknown>).misses = misses;
          edit(e as Record<string, unknown>);
          if (catalog)
            t[k.replace(/\|articles$/, "|searchCatalog")] = {
              items: 0,
              exceptions: [],
              deps: {},
              catalog: "equal",
            };
        }
    },
    { articles: SWEPT },
  );

const miss = (
  kind: "tw" | "ta",
  term: string,
  language = "en",
  requestedPath = term,
) =>
  attemptPacks3(
    env(),
    `/api/v1/${kind === "tw" ? "words" : "academy"}/${term}`,
    {
      language,
      requestedPath,
      prepared: "1",
    },
  );

/** The route's own miss answer (articleResponse.ts), as the API Worker sends it. */
const routeMiss = async (kind: "tw" | "ta", requestedPath: string) => {
  const r = jsonArticleMatch({
    kind,
    language: "en",
    requestedLanguage: "en",
    requestedPath,
    match: { status: "miss" } as never,
    article: null,
    titleOf: () => undefined,
  });
  return { status: r.status, body: await r.json() };
};

describe("the miss side of a term lookup (sweep `misses`)", () => {
  it("answerFromPacks3 does not hand a proven miss back as an answer", async () => {
    await withMisses("en", "tw", "zzznoword");
    expect((await miss("tw", "zzznoword")).hit).toBe(true);
    expect(
      await answerFromPacks3(env(), "/api/v1/words/zzznoword", {
        language: "en",
        requestedPath: "zzznoword",
        prepared: "1",
      }),
    ).toBeUndefined();
  });

  it("a swept miss with an equal search catalog proof answers the route's own 404", async () => {
    await withMisses("en", "tw", "zzznoword,qqq");
    const a = await miss("tw", "zzznoword");
    const want = await routeMiss("tw", "zzznoword");
    expect(want.status).toBe(404);
    expect(a).toEqual({ hit: true, status: 404, value: want.body });
    expect(want.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: 'Translation Word not found at path: "zzznoword"',
        retryable: false,
      },
    });
    // the echo is the caller's requestedPath, as the route's
    const b = await miss("tw", "ZZZNoWord", "en", "ZZZNoWord");
    expect(b).toEqual({
      hit: true,
      status: 404,
      value: (await routeMiss("tw", "ZZZNoWord")).body,
    });
  });

  it("an unswept term falls back", async () => {
    await withMisses("en", "tw", "qqq");
    expect((await miss("tw", "zzznoword")).hit).toBe(false);
  });

  it("a swept miss without the search catalog proof falls back", async () => {
    await withMisses("en", "tw", "zzznoword", { catalog: false });
    expect((await miss("tw", "zzznoword")).hit).toBe(false);
  });

  it("a search catalog proof that is not equal falls back", async () => {
    await injectFixtureProofs(
      env(),
      (t) => {
        for (const [k, e] of Object.entries(t))
          if (
            k.startsWith("en|") &&
            k.endsWith("|articles") &&
            k.includes("/tw|")
          ) {
            (e as Record<string, unknown>).misses = "zzznoword";
            t[k.replace(/\|articles$/, "|searchCatalog")] = {
              items: 0,
              exceptions: [],
              deps: {},
              catalog: "differs",
              differs: ["bible/kt/god"],
            };
          }
      },
      { articles: SWEPT },
    );
    expect((await miss("tw", "zzznoword")).hit).toBe(false);
  });

  it("a miss listed but that resolves here is not a miss: the term path still needs its own proof", async () => {
    await withMisses("en", "tw", "callspeakloudly");
    expect((await miss("tw", "callspeakloudly")).hit).toBe(false);
  });

  it("the proof of another language or resource cannot serve a miss", async () => {
    await withMisses("es-419", "tw", "zzznoword");
    expect((await miss("tw", "zzznoword")).hit).toBe(false);
    await withMisses("en", "tw", "zzznoword");
    expect((await miss("tw", "zzznoword", "es-419")).hit).toBe(false);
    // a tW miss is not a tA miss
    await withMisses("en", "tw", "zzznoword");
    expect((await miss("ta", "zzznoword")).hit).toBe(false);
  });

  it("an exception or a slash path never serves a miss", async () => {
    await withMisses("en", "tw", "zzznoword", {
      edit: (e) => {
        e.exceptions = ["miss:zzznoword"];
      },
    });
    expect((await miss("tw", "zzznoword")).hit).toBe(false);
    await withMisses("en", "tw", "zzznoword");
    expect((await miss("tw", "kt/zzznoword")).hit).toBe(false);
  });

  it("malformed `misses` makes the whole entry unusable (fails closed)", async () => {
    for (const bad of [
      ["zzznoword"],
      "",
      "zzznoword,",
      "ZZZNoWord",
      "a/b",
      "a:b",
      "a|b",
      42,
    ]) {
      await withMisses("en", "tw", bad);
      expect((await miss("tw", "zzznoword")).hit).toBe(false);
      expect(await words("bible/kt/call-speakloudly")).toBeUndefined();
    }
  }, 20_000); // each loop pass re-injects the 182 KB proof table and rebuilds the catalogs: slow under a full run
});

describe("bodyOf: Bible links", () => {
  const art = (md: string) => ({
    id: "tw:kt/x",
    res: "r",
    title: "X",
    sections: [{ level: 2, title: "Facts", md }],
  });
  it("rebuilds the link as the route publishes it", () => {
    const body = bodyOf(
      "tw",
      art("See [Ezra 9:1-2](ref:ezr 9:1) and [Psalm 3:7](ref:psa 3:7)."),
      "en",
    );
    expect(body).toContain("](rc://en/tn/help/ezr/09/01)");
    expect(body).toContain("](rc://en/tn/help/psa/003/07)");
  });
  it("still gives undefined for a link it cannot rebuild", () => {
    expect(bodyOf("tw", art("see [[ta:translate/x]]"), "en")).toBeUndefined();
  });
});
