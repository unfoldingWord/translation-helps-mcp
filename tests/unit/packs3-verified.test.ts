import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import * as sweep from "../../scripts/sweep-packs3.mjs";
import {
  isVerified,
  isVerifiedRange,
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

  it("a range needs its exact item and each verse clean", () => {
    use(
      KEY,
      entry({
        chapters: { TIT: [1] },
        exceptions: ["TIT 1:3", "TIT 1:1-16"],
      }),
    );
    expect(p("TIT 1:1-2")).toBe(true); // composed from clean verses
    expect(p("TIT 1:2-4")).toBe(false); // contains an exception
    expect(p("TIT 1:1-16")).toBe(false); // the exact item itself differs
    expect(isVerifiedRange("en", "u/en/ult", "v1", "TIT", 1, 1, 2)).toBe(true);
    expect(isVerifiedRange("en", "u/en/ult", "v1", "TIT", 1, 3, 3)).toBe(false);
    expect(isVerifiedRange("en", "u/en/ult", "v1", "TIT", 1, 2, 5)).toBe(false);
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
});
