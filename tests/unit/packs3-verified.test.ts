import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import * as sweep from "../../scripts/sweep-packs3.mjs";
import {
  isVerified,
  isVerifiedMiss,
  isVerifiedTerm,
  parseCountsForTests,
  isVerifiedRange,
  searchCatalogExcept,
  releaseOfCatalogs,
  setVerifiedForTests,
  setSweepOpen,
  type VerifiedEntry,
} from "../../src/packs3/verified";

afterEach(() => {
  setVerifiedForTests(undefined);
  setSweepOpen(false);
});

const releaseOf = (k: string) => ({ "common|u/el/ugnt": "v1" })[k];
const entry = (extra: VerifiedEntry = {}): VerifiedEntry => ({
  items: 3,
  exceptions: [],
  chapters: { TIT: [0, 1, 2, "front"] },
  wholeBooks: ["TIT"],
  ...extra,
});
const use = (key: string, e: VerifiedEntry) =>
  setVerifiedForTests({ [key]: e });
const NOTES = "en|u/en/tn|v9|notes";
const notes = (item?: string, opts?: Parameters<typeof isVerified>[5]) =>
  isVerified("en", "u/en/tn", "v9", "notes", item, opts);

describe("isVerified", () => {
  it("is false with the real, empty table", () => {
    expect(notes("TIT 1")).toBe(false);
  });

  it("serves a listed item of an entry for this release", () => {
    use(NOTES, entry());
    expect(notes("TIT 1")).toBe(true);
    expect(notes("TIT front")).toBe(true);
    expect(notes("TIT 0")).toBe(true);
    expect(notes("TIT")).toBe(true);
    expect(notes()).toBe(true);
  });

  it("a release bump has no entry", () => {
    use(NOTES, entry());
    expect(isVerified("en", "u/en/tn", "v10", "notes", "TIT 1")).toBe(false);
    expect(isVerified("es", "u/en/tn", "v9", "notes", "TIT 1")).toBe(false);
    expect(isVerified("en", "u/en/tn", "v9", "links", "TIT 1")).toBe(false);
  });

  it("an exception, an unlisted chapter or book is not served", () => {
    use(NOTES, entry({ exceptions: ["TIT 2"] }));
    expect(notes("TIT 2")).toBe(false);
    expect(notes("TIT 3")).toBe(false);
    expect(notes("RUT 1")).toBe(false);
    expect(notes("RUT")).toBe(false);
  });

  it("every dep must have the release it was swept with", () => {
    use(NOTES, entry({ deps: { "common|u/el/ugnt": "v1" } }));
    expect(notes("TIT 1", { releaseOf })).toBe(true);
    expect(notes("TIT 1", { releaseOf: () => "v2" })).toBe(false);
    expect(notes("TIT 1", { releaseOf: () => undefined })).toBe(false);
    expect(notes("TIT 1")).toBe(false);
  });

  it("a skipped book is not served", () => {
    use("en|u/en/ult|v1|passage", {
      ...entry({ chapters: { TIT: [1], GEN: [1] } }),
      skippedBooks: ["GEN"],
    });
    expect(isVerified("en", "u/en/ult", "v1", "passage", "GEN 1:1")).toBe(
      false,
    );
    expect(isVerified("en", "u/en/ult", "v1", "passage", "TIT 1:1")).toBe(true);
  });

  it("an unknown kind is never served", () => {
    use("en|u/en/x|v1|bogus", entry());
    expect(isVerified("en", "u/en/x", "v1", "bogus", "TIT 1")).toBe(false);
  });

  it("articles and search are served by exact id", () => {
    use("en|u/en/tw|v1|articles", {
      items: 2,
      exceptions: ["bible/kt/god"],
      ids: ["bible/kt/grace", "bible/kt/god"],
    });
    const a = (id: string) => isVerified("en", "u/en/tw", "v1", "articles", id);
    expect(a("bible/kt/grace")).toBe(true);
    expect(a("bible/kt/god")).toBe(false);
    expect(a("bible/kt/other")).toBe(false);
    use("en|u/en/tw|v1|search", { items: 1, exceptions: [], ids: ["grace"] });
    expect(isVerified("en", "u/en/tw", "v1", "search", "grace")).toBe(true);
    expect(isVerified("en", "u/en/tw", "v1", "search", "faith")).toBe(false);
  });

  it("the catalog verdict needs no exceptions and no item lists; an id kind needs an item", () => {
    const k = "en|u/en/tw|v1|" + ["sea", "rch"].join("") + "Catalog";
    const cat = () =>
      isVerified("en", "u/en/tw", "v1", ["sea", "rch"].join("") + "Catalog");
    use(k, { items: 1, exceptions: [], catalog: "equal" });
    expect(cat()).toBe(true);
    use(k, { items: 1, catalog: "equal" });
    expect(cat()).toBe(true);
    use(k, { items: 1, exceptions: ["bible/kt/x"], catalog: "equal" });
    expect(cat()).toBe(false);
    use(k, { items: 1, exceptions: [], catalog: "equal", ids: ["a"] });
    expect(cat()).toBe(false);
    use(k, { items: 1, catalog: "equal", idDirs: { "bible/kt": "a" } });
    expect(cat()).toBe(false);
    use("en|u/en/tw|v1|articles", { items: 1, ids: ["bible/kt/grace"] });
    expect(isVerified("en", "u/en/tw", "v1", "articles")).toBe(false);
    expect(
      isVerified("en", "u/en/tw", "v1", "articles", "bible/kt/grace"),
    ).toBe(true);
  });

  it("articles in the compact form: only the listed clean items are served", () => {
    use("en|u/en/tw|v1|articles", {
      items: 3,
      excepted: 1,
      idDirs: { "bible/kt": "grace,god", "bible/other": "x" },
    });
    const a = (id: string) => isVerified("en", "u/en/tw", "v1", "articles", id);
    expect(a("bible/kt/grace")).toBe(true);
    expect(a("bible/kt/god")).toBe(true);
    expect(a("bible/other/x")).toBe(true);
    // Not listed: excepted, not swept, another directory, a prefix of a name, no name.
    expect(a("bible/kt/faith")).toBe(false);
    expect(a("bible/kt/gra")).toBe(false);
    expect(a("bible/names/grace")).toBe(false);
    expect(a("bible/kt/")).toBe(false);
    expect(a("grace")).toBe(false);
    expect(a("__proto__/x")).toBe(false);
    // A malformed list makes the entry unusable.
    use("en|u/en/tw|v1|articles", {
      idDirs: { "bible/kt": ["grace"] },
    } as never);
    expect(a("bible/kt/grace")).toBe(false);
    use("en|u/en/tw|v1|articles", { idDirs: [] } as never);
    expect(a("bible/kt/grace")).toBe(false);
  });

  it("the sweep may open it", () => {
    setSweepOpen(true);
    expect(notes("TIT 1")).toBe(true);
  });

  it("releaseOfCatalogs finds a resource by catalog name and key", () => {
    const f = releaseOfCatalogs([
      {
        name: "en",
        catalog: { resources: [{ key: "a/en/x", release: "v3" }] },
      },
      {
        name: "common",
        catalog: { resources: [{ key: "a/x/y", release: "v4" }] },
      },
    ]);
    expect(f("en|a/en/x")).toBe("v3");
    expect(f("common|a/x/y")).toBe("v4");
    expect(f("common|a/en/x")).toBeUndefined();
  });
});

describe("passage rules", () => {
  const KEY = "en|u/en/ult|v1|passage";
  const p = (item: string) =>
    isVerified("en", "u/en/ult", "v1", "passage", item);

  it("a verse is served when its chapter is listed and it is no exception", () => {
    use(KEY, entry({ chapters: { TIT: [1] }, exceptions: ["TIT 1:3"] }));
    expect(p("TIT 1:2")).toBe(true);
    expect(p("TIT 1:3")).toBe(false);
    expect(p("TIT 2:1")).toBe(false);
  });

  // The sweep compares only the whole chapter `C:1-N` as a range. A range exception there means the joined verses
  // differ from the route (es-419 TIT 1:4-5: the route keeps a newline and a space at a paragraph break), so no range in that
  // chapter is proven, even one whose verses are each clean. A single verse stays on its own proof.
  it("a range is served only when its chapter has no range exception", () => {
    use(
      KEY,
      entry({
        chapters: { TIT: [1, 2] },
        exceptions: ["TIT 1:3", "TIT 1:1-16"],
      }),
    );
    expect(p("TIT 1:1-2")).toBe(false); // clean verses, but the chapter's range differs
    expect(p("TIT 1:2-4")).toBe(false); // contains an exception
    expect(p("TIT 1:1-16")).toBe(false); // the exact item itself differs
    expect(p("TIT 1:1")).toBe(true); // a single verse rests on its own proof
    expect(p("TIT 2:1-3")).toBe(true); // chapter 2's whole range was proven
    expect(isVerifiedRange("en", "u/en/ult", "v1", "TIT", 1, 1, 2)).toBe(false);
    expect(isVerifiedRange("en", "u/en/ult", "v1", "TIT", 1, 3, 3)).toBe(false);
    expect(isVerifiedRange("en", "u/en/ult", "v1", "TIT", 1, 2, 5)).toBe(false);
    expect(isVerifiedRange("en", "u/en/ult", "v1", "TIT", 2, 1, 2)).toBe(true);
  });

  it("a range exception alone closes every range of its chapter, not its verses", () => {
    use(KEY, entry({ chapters: { TIT: [1] }, exceptions: ["TIT 1:1-16"] }));
    expect(p("TIT 1:4-5")).toBe(false);
    expect(p("TIT 1:4")).toBe(true);
    expect(p("TIT 1:5")).toBe(true);
  });

  // The sweep groups a chapter's exceptions in one string (verified.json is bundled in the Worker): same meaning.
  it("reads a chapter's exceptions grouped in one string (BOOK C:v,v,a-b)", () => {
    use(
      KEY,
      entry({ chapters: { TIT: [1, 2] }, exceptions: ["TIT 1:3,10,1-16"] }),
    );
    expect(p("TIT 1:2")).toBe(true);
    expect(p("TIT 1:3")).toBe(false);
    expect(p("TIT 1:10")).toBe(false);
    expect(p("TIT 1:1-16")).toBe(false);
    expect(p("TIT 1:1-2")).toBe(false); // the chapter's range is an exception
    expect(p("TIT 1:2-4")).toBe(false);
    expect(p("TIT 2:3")).toBe(true);
    expect(p("TIT 2:3-4")).toBe(true);
  });

  it("a range with a huge, zero or reversed bound is refused fast (no walk over the verses)", () => {
    use(KEY, entry({ chapters: { TIT: [1] }, exceptions: [] }));
    const t0 = Date.now();
    expect(p("TIT 1:1-99999999999999999999")).toBe(false);
    expect(p("TIT 1:1-9007199254740993")).toBe(false);
    expect(p("TIT 1:0-3")).toBe(false);
    expect(p("TIT 1:5-3")).toBe(false);
    expect(p("TIT 1:1-201")).toBe(false);
    expect(p("TIT 1:1-200")).toBe(true);
    expect(p("TIT 1:1-176")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a passage exception it cannot read makes the whole entry unusable", () => {
    for (const bad of [
      "TIT 1:x",
      "TIT 1:",
      "TIT 1:3,,4",
      "TIT 1",
      "TIT 1:4-",
    ]) {
      use(KEY, entry({ chapters: { TIT: [1, 2] }, exceptions: [bad] }));
      expect(p("TIT 2:1"), bad).toBe(false);
    }
  });

  it("is not an item it cannot parse", () => {
    use(KEY, entry({ chapters: { TIT: [1] } }));
    expect(p("TIT 1")).toBe(false);
  });
});

describe("matches what the sweep writes", () => {
  it("passage and notes entries built by the sweep's own pure builders are read back", () => {
    const verses = sweep.verseMap([
      [
        [0, "chapter", "1"],
        [0, "verse", "1"],
        [1, "verse", "2"],
        [2, "chapter", "2"],
        [2, "verse", "1"],
      ],
    ]);
    const items = sweep.passageItems("TIT", verses);
    const results = items.map((i: { item: string }) => ({
      ...i,
      status: i.item === "TIT 1:2" ? "differs" : "equal",
    }));
    const e = sweep.buildEntry(results, "2026-11-14T00:00:00Z", {
      deps: sweep.depsFor(
        "passage",
        "u/en/ult",
        [
          {
            name: "common",
            resources: [
              {
                key: "u/el/ugnt",
                release: "v1",
                subject: "Greek New Testament",
              },
            ],
          },
        ],
        { usedKeys: ["u/el/ugnt"] },
      ),
      ...sweep.coverageOf(items),
      skippedBooks: ["GEN"],
    });
    use("en|u/en/ult|v1|passage", e);
    const q = (item: string) =>
      isVerified("en", "u/en/ult", "v1", "passage", item, { releaseOf });
    expect(q("TIT 1:1")).toBe(true);
    expect(q("TIT 1:2")).toBe(false);
    expect(q("TIT 2:1")).toBe(true);
    expect(q("TIT 3:1")).toBe(false);
    expect(q("GEN 1:1")).toBe(false);
    expect(q("TIT 1:1-2")).toBe(false);

    const note = sweep.coverageOf([
      { item: "TIT", book: "TIT" },
      { item: "TIT 1", book: "TIT", chapter: "1" },
      { item: "TIT front", book: "TIT", chapter: "front" },
    ]);
    use(NOTES, {
      ...sweep.buildEntry([{ item: "TIT", status: "equal" }], "d"),
      ...note,
    });
    expect(notes("TIT")).toBe(true);
    expect(notes("TIT 1")).toBe(true);
    expect(notes("TIT front")).toBe(true);
    expect(notes("TIT 2")).toBe(false);
  });

  it("the index shape is served only from its own lists and index: exceptions", () => {
    const idx = (item?: string) => notes(item, { index: true });
    use(
      NOTES,
      entry({
        indexChapters: { TIT: [1, 2] },
        indexWholeBooks: ["TIT"],
        exceptions: ["index:TIT 2", "TIT 1"],
      }),
    );
    expect(idx("TIT 1")).toBe(true);
    expect(idx("TIT 2")).toBe(false);
    expect(idx("TIT")).toBe(true);
    expect(idx("TIT 0")).toBe(false);
    // the default shape never reads the index lists or index exceptions
    expect(notes("TIT 2")).toBe(true);
    expect(notes("TIT 1")).toBe(false);
    // an entry without index lists proves no index item
    use(NOTES, entry());
    expect(idx("TIT 1")).toBe(false);
    expect(idx("TIT")).toBe(false);
  });

  it("fails closed, without throwing, on prototype keys and malformed entries", () => {
    use(NOTES, entry());
    expect(notes("constructor 1")).toBe(false);
    expect(notes("__proto__ 1")).toBe(false);
    expect(notes("toString")).toBe(false);
    const bad = (e: unknown) => {
      setVerifiedForTests({ [NOTES]: e as VerifiedEntry });
      return [notes("TIT 1"), notes("TIT 1", { index: true }), notes()];
    };
    for (const e of [
      { chapters: [1], exceptions: "TIT 1", skippedBooks: 3 },
      { chapters: { TIT: 1 }, indexChapters: { TIT: "1" } },
      { chapters: { TIT: [1] }, exceptions: {}, deps: 5 },
      { chapters: null, indexChapters: null, wholeBooks: "TIT" },
      null,
      "x",
    ]) {
      expect(() => bad(e)).not.toThrow();
    }
    expect(bad({ chapters: { TIT: 1 } })[0]).toBe(false);
    expect(bad({ chapters: [1] })[0]).toBe(false);
    for (const extra of [
      { exceptions: "TIT 1" },
      { exceptions: {} },
      { skippedBooks: "TIT" },
      { deps: 5 },
      { exceptions: [1] },
      { skippedBooks: [1] },
      { deps: [] },
      { wholeBooks: "TIT" },
      { ids: {} },
      { indexWholeBooks: [2] },
      { indexChapters: { TIT: "1" } },
    ]) {
      expect(bad({ chapters: { TIT: [1] }, ...extra })).toEqual([
        false,
        false,
        false,
      ]);
    }
    setVerifiedForTests({});
    expect(notes("TIT 1")).toBe(false);
    use("constructor", entry());
    expect(isVerified("x", "y", "z", "notes", "TIT 1")).toBe(false);
  });
});

describe("exceptionsSameAs (one shared exceptions list)", () => {
  const ULT = "en|u/en/ult|v9|passage";
  const UST = "en|u/en/ust|v9|passage";
  const T4T = "en|u/en/t4t|v9|passage";
  const pass = (extra: VerifiedEntry = {}): VerifiedEntry => ({
    items: 3,
    chapters: { TIT: [1] },
    ...extra,
  });
  const ust = (item: string) =>
    isVerified("en", "u/en/ust", "v9", "passage", item);
  const ult = (item: string) =>
    isVerified("en", "u/en/ult", "v9", "passage", item);

  it("reads the target's exceptions", () => {
    setVerifiedForTests({
      [ULT]: pass({ exceptions: ["TIT 1:3"] }),
      [UST]: pass({ exceptionsSameAs: ULT }),
    });
    expect(ust("TIT 1:2")).toBe(true);
    expect(ust("TIT 1:3")).toBe(false);
    expect(ult("TIT 1:3")).toBe(false);
    expect(ult("TIT 1:2")).toBe(true);
  });

  it("is unusable when the target is missing", () => {
    setVerifiedForTests({ [UST]: pass({ exceptionsSameAs: ULT }) });
    expect(ust("TIT 1:2")).toBe(false);
  });

  it("is unusable when the target has no exceptions list or a bad one", () => {
    setVerifiedForTests({
      [ULT]: pass(),
      [UST]: pass({ exceptionsSameAs: ULT }),
    });
    expect(ust("TIT 1:2")).toBe(false);
    setVerifiedForTests({
      [ULT]: pass({ exceptions: "TIT 1:3" as unknown as string[] }),
      [UST]: pass({ exceptionsSameAs: ULT }),
    });
    expect(ust("TIT 1:2")).toBe(false);
  });

  it("is unusable on a cycle, a self reference or a chain", () => {
    setVerifiedForTests({
      [ULT]: pass({ exceptionsSameAs: UST }),
      [UST]: pass({ exceptionsSameAs: ULT }),
    });
    expect(ust("TIT 1:2")).toBe(false);
    expect(ult("TIT 1:2")).toBe(false);
    setVerifiedForTests({ [UST]: pass({ exceptionsSameAs: UST }) });
    expect(ust("TIT 1:2")).toBe(false);
    setVerifiedForTests({
      [T4T]: pass({ exceptions: [] }),
      [ULT]: pass({ exceptionsSameAs: T4T }),
      [UST]: pass({ exceptionsSameAs: ULT }),
    });
    expect(ult("TIT 1:2")).toBe(true);
    expect(ust("TIT 1:2")).toBe(false);
  });

  it("is unusable beside its own exceptions, with a non-string value, or across lang, release or kind", () => {
    setVerifiedForTests({
      [ULT]: pass({ exceptions: [] }),
      [UST]: pass({ exceptions: [], exceptionsSameAs: ULT }),
    });
    expect(ust("TIT 1:2")).toBe(false);
    setVerifiedForTests({
      [ULT]: pass({ exceptions: [] }),
      [UST]: pass({ exceptionsSameAs: 3 as unknown as string }),
    });
    expect(ust("TIT 1:2")).toBe(false);
    for (const other of [
      "es|u/en/ult|v9|passage",
      "en|u/en/ult|v8|passage",
      "en|u/en/ult|v9|notes",
    ]) {
      setVerifiedForTests({
        [other]: pass({ exceptions: [] }),
        [UST]: pass({ exceptionsSameAs: other }),
      });
      expect(ust("TIT 1:2")).toBe(false);
    }
  });

  it("is unusable when the target entry itself is malformed", () => {
    setVerifiedForTests({
      [ULT]: pass({
        exceptions: [],
        chapters: "TIT" as unknown as Record<string, number[]>,
      }),
      [UST]: pass({ exceptionsSameAs: ULT }),
    });
    expect(ust("TIT 1:2")).toBe(false);
  });
});

describe("search catalog verdict equalExcept (case-only id differences)", () => {
  const CAT = "en|u/en/ta|v9|searchCatalog";
  const ART = "en|u/en/ta|v9|articles";
  const except = ["translate/figs-ordergrk", "translate/figs-orderheb"];
  const verdict = (extra: Record<string, unknown> = {}) =>
    ({
      items: 2,
      exceptions: [],
      catalog: "equalExcept",
      except,
      ...extra,
    }) as VerifiedEntry;
  const cat = () => searchCatalogExcept("en", "u/en/ta", "v9", {});

  it("an equal verdict excepts nothing; equalExcept gives its ids; differs is no proof", () => {
    use(CAT, { items: 2, exceptions: [], catalog: "equal" });
    expect(cat()).toEqual([]);
    use(CAT, verdict());
    expect(cat()).toEqual(except);
    use(CAT, { items: 2, exceptions: [], catalog: "differs", differs: ["x"] });
    expect(cat()).toBeUndefined();
    // the plain isVerified gate stays strict: only "equal" passes it
    use(CAT, verdict());
    expect(isVerified("en", "u/en/ta", "v9", "searchCatalog")).toBe(false);
  });

  it("a malformed `except` makes the whole entry unusable", () => {
    for (const bad of [
      { except: undefined },
      { except: [] },
      { except: "translate/figs-ordergrk" },
      { except: ["translate/figs-orderGrk"] },
      { except: ["../etc"] },
      { except: [3] },
      { differs: ["translate/figs-ordergrk"] },
    ]) {
      use(CAT, verdict(bad));
      expect(cat()).toBeUndefined();
    }
    use(CAT, { items: 2, exceptions: [], catalog: "equal", except });
    expect(cat()).toBeUndefined();
  });

  it("a miss is served under equalExcept, except a term naming an excepted id", () => {
    setVerifiedForTests({
      [CAT]: verdict(),
      [ART]: { items: 1, misses: "figs-ordergrk,nothing,translate" },
    });
    expect(isVerifiedMiss("en", "u/en/ta", "v9", "nothing", {})).toBe(true);
    expect(isVerifiedMiss("en", "u/en/ta", "v9", "figs-ordergrk", {})).toBe(
      false,
    );
    setVerifiedForTests({
      [CAT]: verdict({ except: ["translate/figs-ordergrk"] }),
      [ART]: { items: 1, misses: "figs-orderheb" },
    });
    expect(isVerifiedMiss("en", "u/en/ta", "v9", "figs-orderheb", {})).toBe(
      true,
    );
    setVerifiedForTests({
      [CAT]: verdict({ except: [] }),
      [ART]: { items: 1, misses: "nothing" },
    });
    expect(isVerifiedMiss("en", "u/en/ta", "v9", "nothing", {})).toBe(false);
  });
});

describe("each proof entry is parsed once (per raw entry object)", () => {
  const ULT = "en|u/en/ult|v9|passage";
  const UST = "en|u/en/ust|v9|passage";
  const ART = "en|u/en/tw|v9|articles";
  const pass = (extra: VerifiedEntry = {}): VerifiedEntry => ({
    items: 3,
    chapters: { TIT: [1, 2, 3] },
    ...extra,
  });
  const ult = (item: string) =>
    isVerified("en", "u/en/ult", "v9", "passage", item);
  const ust = (item: string) =>
    isVerified("en", "u/en/ust", "v9", "passage", item);
  // a long list, as en ult/ust have: every second verse of chapters 2 and 3, and a range in chapter 1
  const long = [
    "TIT 1:5-6",
    `TIT 2:${Array.from({ length: 200 }, (_, i) => 2 * i + 1).join(",")}`,
    `TIT 3:${Array.from({ length: 200 }, (_, i) => 2 * i + 1).join(",")}`,
  ];
  const queries = [
    "TIT 1:1",
    "TIT 1:5",
    "TIT 1:1-3",
    "TIT 1:3-5",
    "TIT 1:6-8",
    "TIT 2:1",
    "TIT 2:2",
    "TIT 3:4",
    "TIT 3:4-5",
    "TIT 1:7-9",
  ];

  it("gives the same answers across repeated calls", () => {
    setVerifiedForTests({
      [ULT]: pass({ exceptions: long, joins: { TIT: "1:1-2,7-8" } }),
    });
    const first = queries.map(ult);
    expect(first).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
    ]);
    for (let i = 0; i < 5; i++) expect(queries.map(ult)).toEqual(first);
  });

  it("answers anew when setVerifiedForTests swaps the entry", () => {
    setVerifiedForTests({ [ULT]: pass({ exceptions: ["TIT 1:3"] }) });
    expect(ult("TIT 1:3")).toBe(false);
    expect(ult("TIT 1:3")).toBe(false);
    setVerifiedForTests({ [ULT]: pass({ exceptions: [] }) });
    expect(ult("TIT 1:3")).toBe(true);
    setVerifiedForTests({ [ULT]: pass({ exceptions: 3 as never }) });
    expect(ult("TIT 1:1")).toBe(false);
  });

  it("a pointer target swap invalidates the pointing entry", () => {
    const ustRaw = pass({ exceptionsSameAs: ULT });
    const t: Record<string, VerifiedEntry> = {
      [ULT]: pass({ exceptions: ["TIT 1:3"] }),
      [UST]: ustRaw,
    };
    setVerifiedForTests(t);
    expect(ust("TIT 1:3")).toBe(false);
    // the same table and the same pointing object, a new target object (no setVerifiedForTests)
    t[ULT] = pass({ exceptions: [] });
    expect(ust("TIT 1:3")).toBe(true);
    // a target that can no longer be followed makes the pointing entry unusable
    t[ULT] = pass({ exceptionsSameAs: UST });
    expect(ust("TIT 1:1")).toBe(false);
    delete t[ULT];
    expect(ust("TIT 1:1")).toBe(false);
    t[ULT] = pass({ exceptions: ["TIT 1:1"] });
    expect(ust("TIT 1:1")).toBe(false);
    expect(ust("TIT 1:2")).toBe(true);
    // via setVerifiedForTests, the same pointing object
    setVerifiedForTests({ [ULT]: pass({ exceptions: [] }), [UST]: ustRaw });
    expect(ust("TIT 1:1")).toBe(true);
  });

  it("the same raw object under another key is checked for that key", () => {
    const shared = pass({ exceptionsSameAs: ULT });
    setVerifiedForTests({
      [ULT]: pass({ exceptions: [] }),
      [UST]: shared,
      "en|u/en/t4t|v9|passage": shared,
    });
    expect(ust("TIT 1:1")).toBe(true);
    // under the t4t key the pointer is still in the group, so it reads ULT too
    expect(isVerified("en", "u/en/t4t", "v9", "passage", "TIT 1:1")).toBe(true);
    // under ULT's own key it would point at itself: unusable
    setVerifiedForTests({ [ULT]: shared });
    expect(ult("TIT 1:1")).toBe(false);
  });

  it("parses a long exceptions list once for N calls, shared by its pointer", () => {
    setVerifiedForTests({
      [ULT]: pass({ exceptions: long, joins: { TIT: "1:1-2,7-8" } }),
      [UST]: pass({ exceptionsSameAs: ULT }),
    });
    const before = parseCountsForTests();
    for (let i = 0; i < 50; i++) {
      queries.map(ult);
      queries.map(ust);
    }
    const after = parseCountsForTests();
    expect(after.entries - before.entries).toBe(2);
    expect(after.exceptions - before.exceptions).toBe(1);
  });

  it("parses terms and misses once for N calls", () => {
    setVerifiedForTests({
      [ART]: {
        items: 2,
        exceptions: ["miss:gone"],
        idDirs: { "bible/kt": "grace,covenant" },
        terms: { "bible/kt": "covenant:=|pact,grace:=" },
        misses: "nothing,gone",
      },
    });
    const before = parseCountsForTests();
    for (let i = 0; i < 20; i++) {
      expect(
        isVerifiedTerm("en", "u/en/tw", "v9", "pact", "bible/kt/covenant"),
      ).toBe(true);
      expect(
        isVerifiedTerm("en", "u/en/tw", "v9", "pact", "bible/kt/grace"),
      ).toBe(false);
      expect(isVerifiedMiss("en", "u/en/tw", "v9", "gone")).toBe(false);
    }
    const after = parseCountsForTests();
    expect(after.entries - before.entries).toBe(1);
    expect(after.exceptions - before.exceptions).toBe(1);
  });
});
