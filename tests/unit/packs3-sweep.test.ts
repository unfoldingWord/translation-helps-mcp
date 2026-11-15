import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import * as s from "../../scripts/sweep-packs3.mjs";

describe("sweep-packs3 pure parts", () => {
  it("builds the key from language, resource key, release and kind", () => {
    expect(
      s.sweepKey("es-419", "es-419_gl/es-419/tq", "v38", "questions"),
    ).toBe("es-419|es-419_gl/es-419/tq|v38|questions");
  });

  it("picks the catalog resources a kind covers, with their release", () => {
    const resources = [
      { key: "a/en/ult", subject: "Aligned Bible", release: "v1" },
      { key: "a/en/tq", subject: "TSV Translation Questions", release: "v2" },
      { key: "a/en/tw", subject: "Translation Words", release: "v3" },
      { key: "a/en/ta", subject: "Translation Academy", release: "v4" },
    ];
    expect(
      s.resourcesOfKind("questions", resources).map((r: any) => r.key),
    ).toEqual(["a/en/tq"]);
    expect(
      s.resourcesOfKind("passage", resources).map((r: any) => r.key),
    ).toEqual(["a/en/ult"]);
    // search covers ta and tw (each type set names its resources in its items)
    expect(
      s.resourcesOfKind("search", resources).map((r: any) => r.key),
    ).toEqual(["a/en/ta", "a/en/tw"]);
    expect(
      s.resourcesOfKind("articles", resources).map((r: any) => r.key),
    ).toEqual(["a/en/ta", "a/en/tw"]);
    expect(s.resourcesOfKind("nonsense", resources)).toEqual([]);
  });

  it("lists exceptions: differing items, fallbacks and API errors, sorted and unique", () => {
    const results = [
      { item: "TIT 3", status: "equal" },
      { item: "TIT 2", status: "differs" },
      { item: "TIT 1", status: "fallback", reason: "unverified-book" },
      { item: "RUT 1", status: "api-error" },
      { item: "TIT 2", status: "differs" },
    ];
    expect(s.listExceptions(results)).toEqual(["RUT 1", "TIT 1", "TIT 2"]);
  });

  it("builds an entry with the item count and the date", () => {
    const results = [
      { item: "a", status: "equal" },
      { item: "b", status: "differs" },
    ];
    expect(s.buildEntry(results, "2026-11-14T00:00:00.000Z")).toEqual({
      items: 2,
      exceptions: ["b"],
      swept: "2026-11-14T00:00:00.000Z",
    });
    // the documented shape: deps and the exact coverage ride along
    expect(
      s.buildEntry(results, "d", {
        deps: { "en|x/y/z": "v1" },
        chapters: { TIT: [1] },
        skippedBooks: ["GEN"],
      }),
    ).toEqual({
      items: 2,
      exceptions: ["b"],
      swept: "d",
      deps: { "en|x/y/z": "v1" },
      chapters: { TIT: [1] },
      skippedBooks: ["GEN"],
    });
  });

  it("merges entries by key, keeps the others, and sorts the keys", () => {
    const old = {
      "en|x|v1|notes": { items: 1, exceptions: [], swept: "old" },
      "en|x|v1|links": { items: 1, exceptions: [], swept: "old" },
    };
    const merged = s.mergeVerified(old, {
      "en|x|v1|notes": { items: 5, exceptions: ["TIT 1"], swept: "new" },
      "en|y|v2|notes": { items: 2, exceptions: [], swept: "new" },
    });
    expect(Object.keys(merged)).toEqual([
      "en|x|v1|links",
      "en|x|v1|notes",
      "en|y|v2|notes",
    ]);
    expect(merged["en|x|v1|notes"].items).toBe(5);
    expect(merged["en|x|v1|links"].swept).toBe("old");
    // The inputs are not changed.
    expect(old["en|x|v1|notes"].items).toBe(1);
  });

  it("classifies an item with the comparison's normalizer", () => {
    const api = { requestId: "r", meta: { cache: "hit" }, q: [1] };
    expect(
      s.classifyItem(
        { hit: true, value: { meta: { cache: "pack" }, q: [1] } },
        api,
      ).status,
    ).toBe("equal");
    const d = s.classifyItem({ hit: true, value: { q: [2] } }, api);
    expect(d.status).toBe("differs");
    expect(d.diffs[0].path).toBe("$.q[0]");
    expect(
      s.classifyItem({ hit: false, reason: "adapter-undefined" }, api),
    ).toMatchObject({
      status: "fallback",
      reason: "adapter-undefined",
    });
    expect(s.classifyItem({ hit: true, value: {} }, undefined).status).toBe(
      "api-error",
    );
  });

  it("makes the item list per kind", () => {
    expect(s.chapterItems("TIT", [1, 2, 3], true)).toEqual([
      "TIT",
      "TIT 1",
      "TIT 2",
      "TIT 3",
    ]);
    expect(s.chapterItems("TIT", [1, 2], false)).toEqual(["TIT 1", "TIT 2"]);
    // numbers ascending (0 = intro), then names such as "front"
    expect(
      s.unionChapters([
        ["1", "2"],
        ["2", "10", "front", "0"],
      ]),
    ).toEqual([0, 1, 2, 10, "front"]);
  });

  it("has 40 distinct search queries per language, already normalized", () => {
    for (const lang of ["en", "es-419"]) {
      const q = s.searchQueries(lang);
      expect(q).toHaveLength(40);
      expect(new Set(q).size).toBe(40);
      for (const x of q) expect(x).toBe(x.trim().toLowerCase());
    }
    expect(s.searchQueries("fr")).toEqual([]);
  });

  it("builds the API request of an item", () => {
    expect(s.requestOf("questions", "es-419", "TIT 1")).toEqual({
      path: "/api/v1/questions",
      params: { reference: "TIT 1", language: "es-419" },
    });
    expect(s.requestOf("notes", "en", "TIT").path).toBe("/api/v1/notes");
    expect(s.requestOf("links", "en", "TIT 1").path).toBe("/api/v1/word-links");
    expect(s.requestOf("passage", "en", "TIT 1").path).toBe(
      "/api/v1/scripture",
    );
    expect(s.requestOf("tw", "en", "bible/kt/grace")).toEqual({
      path: "/api/v1/words/bible/kt/grace",
      params: {
        language: "en",
        requestedPath: "bible/kt/grace",
        prepared: "1",
      },
    });
    expect(s.requestOf("ta", "en", "translate/figs-simile").path).toBe(
      "/api/v1/academy/translate/figs-simile",
    );
    expect(s.requestOf("search", "en", "grace")).toEqual({
      path: "/api/v1/search",
      params: { q: "grace", language: "en", types: "tw", limit: "5" },
    });
  });

  it("sweeps search per types set: tw plain, ta and ta,tw prefixed", () => {
    expect(s.SEARCH_TYPES).toEqual(["tw", "ta", "ta,tw"]);
    expect(s.searchItem("tw", "grace")).toBe("grace");
    expect(s.searchItem("ta", "grace")).toBe("ta|grace");
    expect(s.searchItem("ta,tw", "grace")).toBe("ta,tw|grace");
    expect(s.parseSearchItem("ta,tw|grace")).toEqual({
      types: "ta,tw",
      q: "grace",
    });
    expect(s.parseSearchItem("grace")).toEqual({ types: "tw", q: "grace" });
    expect(s.requestOf("search", "en", "ta|grace").params).toEqual({
      q: "grace",
      language: "en",
      types: "ta",
      limit: "5",
    });
    expect(s.requestOf("search", "en", "ta,tw|grace").params.types).toBe(
      "ta,tw",
    );
  });

  it("writes verified.json only for a whole run, never a narrowed one", () => {
    expect(s.shouldWriteVerified({})).toBe(true);
    expect(s.shouldWriteVerified({ books: undefined })).toBe(true);
    expect(s.shouldWriteVerified({ books: [] })).toBe(true);
    expect(s.shouldWriteVerified({ books: ["tit"] })).toBe(false);
  });

  it("finds resources without items", () => {
    const items = [{ item: "a", res: ["r1"] }];
    expect(s.emptyResources(items, [{ key: "r1" }, { key: "r2" }])).toEqual([
      "r2",
    ]);
    expect(s.emptyResources([], [{ key: "r1" }])).toEqual(["r1"]);
  });

  it("trusts a cached answer only for the same catalog key and within the max age", () => {
    const h = 3600 * 1000;
    const c = { fetchedAt: 1000, catalog: "K", body: {} };
    expect(s.cacheFresh(c, "K", 1000 + 23 * h, 24)).toBe(true);
    expect(s.cacheFresh(c, "K", 1000 + 25 * h, 24)).toBe(false);
    expect(s.cacheFresh(c, "K", 1000 + 25 * h, 48)).toBe(true);
    expect(s.cacheFresh(c, "OTHER", 1000, 24)).toBe(false);
    expect(s.cacheFresh({ body: {} }, "K", 1000, 24)).toBe(false);
    expect(s.cacheFresh(undefined, "K", 1000, 24)).toBe(false);
  });

  it("reads the resource keys an answer was made of from its sources", () => {
    expect(
      s.keysFromVersions([
        {
          source: "https://git.door43.org/unfoldingWord/en_ult/archive/v91.zip",
        },
        {
          source: "https://git.door43.org/es-419_gl/es-419_glt/archive/v5.zip",
        },
        {
          source:
            "https://git.door43.org/unfoldingWord/el-x-koine_ugnt/archive/v0.34.zip",
        },
        { source: "nonsense" },
      ]),
    ).toEqual([
      "es-419_gl/es-419/glt",
      "unfoldingWord/el-x-koine/ugnt",
      "unfoldingWord/en/ult",
    ]);
  });

  it("credits a passage item only to resources the answer contained", () => {
    const results = [
      {
        item: "TIT 1:1",
        res: ["a/ult", "a/ust"],
        status: "equal",
        used: ["a/ult", "x/ugnt"],
      },
      { item: "TIT 1:2", res: ["a/ult"], status: "equal", used: ["a/ult"] },
      { item: "TIT 2:1", res: ["a/ust"], status: "equal" },
    ];
    const ult = s.resultsForResource("a/ult", results);
    expect(s.listExceptions(ult)).toEqual([]);
    expect(ult).toHaveLength(2);
    const ust = s.resultsForResource("a/ust", results);
    expect(s.listExceptions(ust)).toEqual(["TIT 1:1"]);
    expect(ust).toHaveLength(2);
  });

  it("records the releases of the resources an answer depended on", () => {
    const cats = [
      {
        name: "en",
        resources: [
          { key: "o/en/tn", subject: "TSV Translation Notes", release: "v1" },
          { key: "o/en/ult", subject: "Aligned Bible", release: "v2" },
          { key: "o/en/ust", subject: "Aligned Bible", release: "v3" },
          { key: "o/en/ta", subject: "Translation Academy", release: "v4" },
          { key: "o/en/tw", subject: "Translation Words", release: "v5" },
        ],
      },
      {
        name: "common",
        resources: [
          { key: "o/el/ugnt", subject: "Greek New Testament", release: "v6" },
          { key: "o/en/ta", subject: "Translation Academy", release: "v4" },
        ],
      },
    ];
    expect(
      s.depsFor("notes", "o/en/tn", cats, { alignedKey: "o/en/ult" }),
    ).toEqual({
      "common|o/el/ugnt": "v6",
      "common|o/en/ta": "v4",
      "en|o/en/ta": "v4",
      "en|o/en/ult": "v2",
    });
    expect(
      s.depsFor("links", "o/en/twl", cats, { alignedKey: "o/en/ult" }),
    ).toEqual({
      "common|o/el/ugnt": "v6",
      "en|o/en/tw": "v5",
      "en|o/en/ult": "v2",
    });
    expect(
      s.depsFor("passage", "o/en/ult", cats, {
        usedKeys: ["o/en/ult", "o/en/ust", "o/el/ugnt"],
      }),
    ).toEqual({ "common|o/el/ugnt": "v6", "en|o/en/ust": "v3" });
    expect(s.depsFor("questions", "o/en/tq", cats)).toEqual({});
    expect(s.depsFor("articles", "o/en/ta", cats)).toEqual({});
  });

  it("says exactly which items an entry covers", () => {
    expect(
      s.coverageOf([
        { item: "TIT", book: "TIT" },
        { item: "TIT 2", book: "TIT", chapter: 2 },
        { item: "TIT 1", book: "TIT", chapter: 1 },
        { item: "TIT front", book: "TIT", chapter: "front" },
        { item: "TIT 0", book: "TIT", chapter: 0 },
      ]),
    ).toEqual({ chapters: { TIT: [0, 1, 2, "front"] }, wholeBooks: ["TIT"] });
    expect(
      s.coverageOf([
        { item: "TIT 1", book: "TIT", chapter: 1 },
        { item: "index:TIT", book: "TIT", index: true },
        { item: "index:TIT 1", book: "TIT", chapter: 1, index: true },
        { item: "index:TIT 0", book: "TIT", chapter: 0, index: true },
      ]),
    ).toEqual({
      chapters: { TIT: [1] },
      indexChapters: { TIT: [0, 1] },
      indexWholeBooks: ["TIT"],
    });
    expect(s.requestOf("notes", "en", "TIT 1", { index: true })).toEqual({
      path: "/api/v1/notes",
      params: { reference: "TIT 1", language: "en", fields: "index" },
    });
    expect(
      s.requestOf("links", "en", "TIT", { index: true }).params.fields,
    ).toBe("index");
    expect(() =>
      s.requestOf("questions", "en", "TIT", { index: true }),
    ).toThrow();
    expect(s.indexItem("TIT 1")).toBe("index:TIT 1");
    expect(
      s.coverageOf([{ item: "b/x" }, { item: "a/y" }, { item: "b/x" }]),
    ).toEqual({ ids: ["a/y", "b/x"] });
  });

  // The public API drops `fields=index`; only a trusted host (localhost) with the internal header answers that shape.
  it("sends index items to --api-index with the internal header, the rest to --api", () => {
    const api = "https://api.example.org";
    const apiIndex = "http://localhost:8788";
    const idx = { item: "index:TIT 1", index: true };
    const plain = { item: "TIT 1" };
    expect(s.apiTarget(idx, { api, apiIndex })).toEqual({
      base: apiIndex,
      headers: { accept: "application/json", "x-th-internal": "index" },
    });
    expect(s.apiTarget(plain, { api, apiIndex })).toEqual({
      base: api,
      headers: { accept: "application/json" },
    });
    // The old behaviour stays the default: no --api-index, everything to --api with no header.
    expect(s.apiTarget(idx, { api })).toEqual({
      base: api,
      headers: { accept: "application/json" },
    });
    // A host the API would not trust would strip the shape: refuse it rather than compare the wrong shape.
    expect(() =>
      s.apiTarget(idx, { api, apiIndex: "https://api.example.org" }),
    ).toThrow(/trusted/);
    expect(
      s.apiTarget(idx, { api, apiIndex: "http://127.0.0.1:8788/" }).base,
    ).toBe("http://127.0.0.1:8788/");
  });

  it("makes passage items: every verse and one range per chapter, from the union of verse events", () => {
    const ev1 = [
      [0, "chapter", "1"],
      [1, "verse", "1"],
      [2, "verse", "2"],
      [3, "chapter", "2"],
      [4, "verse", "1"],
    ];
    const ev2 = [
      [0, "chapter", "1"],
      [1, "verse", "3"],
      [2, "verse", "1"],
    ];
    const verses = s.verseMap([ev1, ev2]);
    expect(verses).toEqual({ 1: [1, 2, 3], 2: [1] });
    expect(s.passageItems("TIT", verses).map((x: any) => x.item)).toEqual([
      "TIT 1:1",
      "TIT 1:2",
      "TIT 1:3",
      "TIT 1:1-3",
      "TIT 2:1",
    ]);
    expect(s.passageItems("TIT", verses)[0]).toMatchObject({
      book: "TIT",
      chapter: 1,
    });
  });

  // verified.json is bundled in the Worker: it stays small, and every passage exception is one verified.ts can read
  // (one it cannot read would make its whole entry unusable).
  it("ships a small verified.json whose passage exceptions are all readable", () => {
    const f = new URL("../../src/packs3/verified.json", import.meta.url);
    const text = readFileSync(f, "utf8");
    expect(text.length).toBeLessThan(150_000);
    const table = JSON.parse(text) as Record<string, { exceptions?: string[] }>;
    for (const [k, e] of Object.entries(table)) {
      expect(k.split("|")).toHaveLength(4);
      if (!k.endsWith("|passage")) continue;
      for (const x of e.exceptions ?? [])
        expect(x, k).toMatch(/^\S+ \d+:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
    }
  });
});

describe("compactArticles", () => {
  it("lists the clean items per directory and counts the exceptions", () => {
    const entry = {
      items: 4,
      exceptions: ["bible/kt/god", "translate/b"],
      swept: "d",
      deps: {},
      ids: [
        "bible/kt/god",
        "bible/kt/grace",
        "bible/other/x",
        "translate/b",
        "translate/a",
      ],
    };
    expect(s.compactArticles(entry)).toEqual({
      items: 4,
      swept: "d",
      deps: {},
      excepted: 2,
      idDirs: { "bible/kt": "grace", "bible/other": "x", translate: "a" },
    });
    expect(s.exceptionCount(s.compactArticles(entry), "articles")).toBe(2);
    expect(entry.ids).toHaveLength(5);
  });
});

describe("compactPassage", () => {
  it("drops a chapter whose every item is an exception, with its exceptions (it is not listed, so never served)", () => {
    const items = [
      { item: "PSA 1:1", book: "PSA", chapter: 1 },
      { item: "PSA 1:2", book: "PSA", chapter: 1 },
      { item: "PSA 1:1-2", book: "PSA", chapter: 1 },
      { item: "PSA 2:1", book: "PSA", chapter: 2 },
      { item: "PSA 2:2", book: "PSA", chapter: 2 },
      { item: "PSA 2:1-2", book: "PSA", chapter: 2 },
      { item: "JON 1:1", book: "JON", chapter: 1 },
    ];
    const entry = {
      items: 7,
      exceptions: ["JON 1:1", "PSA 1:1", "PSA 1:1-2", "PSA 1:2", "PSA 2:2"],
      swept: "x",
      chapters: { JON: [1], PSA: [1, 2] },
    };
    expect(s.compactPassage(entry, items)).toEqual({
      items: 7,
      exceptions: ["PSA 2:2"],
      swept: "x",
      chapters: { PSA: [2] },
    });
    expect(entry.chapters.PSA).toEqual([1, 2]);
  });

  it("groups the exceptions of a chapter in one string: verses ascending, then ranges", () => {
    const items = ["1", "3", "10", "1-16"]
      .map((v) => ({ item: `TIT 1:${v}`, book: "TIT", chapter: 1 }))
      .concat([
        { item: "TIT 2:1", book: "TIT", chapter: 2 },
        { item: "TIT 2:2", book: "TIT", chapter: 2 },
      ]);
    const entry = {
      items: 6,
      exceptions: ["TIT 1:1-16", "TIT 1:10", "TIT 1:3", "TIT 2:1"],
      swept: "x",
      chapters: { TIT: [1, 2] },
    };
    expect(s.compactPassage(entry, items).exceptions).toEqual([
      "TIT 1:3,10,1-16",
      "TIT 2:1",
    ]);
  });
});

describe("exceptionCount", () => {
  it("counts each item of a grouped passage exception, other kinds by entry", () => {
    expect(
      s.exceptionCount(
        { exceptions: ["TIT 1:3,10,1-16", "TIT 2:1"] },
        "passage",
      ),
    ).toBe(4);
    expect(
      s.exceptionCount({ exceptions: ["TIT 1", "index:TIT 2"] }, "notes"),
    ).toBe(2);
    expect(s.exceptionCount({}, "passage")).toBe(0);
  });
});

describe("formatVerified", () => {
  it("writes one line per field, arrays and objects inside a field on that line, and reads back the same", () => {
    const v = {
      "a|b|v1|passage": {
        items: 2,
        exceptions: ["TIT 1:3"],
        chapters: { TIT: [1, 2] },
      },
    };
    const text = s.formatVerified(v);
    expect(JSON.parse(text)).toEqual(v);
    expect(text).toContain('    "chapters": {"TIT":[1,2]}');
    expect(text.endsWith("\n")).toBe(true);
  });
});
