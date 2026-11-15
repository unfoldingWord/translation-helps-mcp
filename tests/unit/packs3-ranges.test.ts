/**
 * Task 16a: passage ranges. The route's range is `extractVerses` over the verses' USFM slices joined by "\n" and then
 * stripped; a single verse is its slice stripped alone. So a range is the join of the single verses with one glue per
 * boundary, and that glue depends only on the raw USFM at the boundary (a blank line, `\ts\*`, a closing marker such
 * as `\qs*`), which format 3 does not keep. The adapter joins its verses with " "; a range is served when its verses
 * are clean and every boundary in it was proven " " by a swept window (`joins`), or the whole chapter range was.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractVerses } from "../../packages/door43/src/parsers/usfm";
import {
  resetPacks3CachesForTests,
  type Packs3Env,
} from "../../src/packs3/catalogs";
import { resetReadersForTests, withReader } from "../../src/packs3/readers";
import { verseText } from "../../src/packs3/adapters/scripture";
import {
  isVerified,
  setVerifiedForTests,
  type VerifiedEntry,
} from "../../src/packs3/verified";
// @ts-expect-error plain .mjs script, no types
import * as s from "../../scripts/sweep-packs3.mjs";

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
      };
    },
  };
  return {
    LANGUAGE_PACKS: bucket as unknown as R2Bucket,
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: STAGING,
  };
}

describe("the route's range is its single verses joined by a boundary glue", () => {
  const single = (usfm: string, v: number) =>
    extractVerses(usfm, "1", String(v), undefined) as string;
  const range = (usfm: string, a: number, b: number) =>
    extractVerses(usfm, "1", String(a), String(b)) as string;

  it("joins with one space across a plain boundary and a paragraph line", () => {
    const usfm =
      '\\c 1\n\\p\n\\v 1 One \\w word|x="1"\\w*.\n\\p\n\\v 2 Two.\n\\q1 \\v 3 Three.\n';
    expect(range(usfm, 1, 3)).toBe(
      [1, 2, 3].map((v) => single(usfm, v)).join(" "),
    );
  });

  it("keeps a blank line, a ts milestone and glues after a closing marker: not a pure join", () => {
    const blank = "\\c 1\n\\v 1 One.\n\n\\p\n\\v 2 Two.\n";
    expect(range(blank, 1, 2)).toBe("1 One.\n 2 Two.");
    const ts = "\\c 1\n\\v 1 One.\n\\ts\\*\n\\v 2 Two.\n";
    expect(range(ts, 1, 2)).not.toBe(`${single(ts, 1)} ${single(ts, 2)}`);
    const selah =
      "\\c 1\n\\q1 \\v 1 One \\qs Selah\\qs*\n\\b\n\\q1 \\v 2 Two.\n";
    expect(single(selah, 1)).toBe("1 One Selah");
    expect(range(selah, 1, 2)).toBe("1 One Selah2 Two.");
  });
});

describe("verseText: a range is the join of its own single verses", () => {
  beforeEach(() => {
    resetPacks3CachesForTests();
    resetReadersForTests();
  });

  it.each(["en", "es-419"])(
    "%s fixture books: every 2-3 verse window it answers equals its verses joined by a space",
    async (lang) => {
      const counts = await withReader(env(), lang, async (reader) => {
        let answered = 0;
        let refused = 0;
        for (const code of ["tit", "rut", "mat"]) {
          if (!reader.listed(`book:${code}`)) continue;
          const data = (await reader.book(code)) as {
            texts?: Array<{ events?: [number, string, string][] }>;
          };
          const orig = (await reader.orig(code)) as {
            events?: [number, string, string][];
          };
          for (const unit of [...(data?.texts ?? []), orig]) {
            if (!unit?.events) continue;
            const verses = s.verseMap([unit.events]) as Record<
              string,
              number[]
            >;
            for (const [c, vs] of Object.entries(verses)) {
              for (let i = 0; i + 1 < vs.length; i++) {
                for (const span of [1, 2]) {
                  const a = vs[i]!;
                  const b = vs[Math.min(i + span, vs.length - 1)]!;
                  const text = verseText(unit as never, c, a, b);
                  if (text === undefined) {
                    refused++;
                    continue;
                  }
                  answered++;
                  const parts: string[] = [];
                  for (let v = a; v <= b; v++) {
                    parts.push(verseText(unit as never, c, v, v) as string);
                  }
                  expect(text).toBe(parts.join(" "));
                }
              }
            }
          }
        }
        return { answered, refused };
      });
      expect(counts!.answered).toBeGreaterThan(0);
    },
  );
});

describe("isVerified: a range on boundary proofs (`joins`)", () => {
  const K = "en|o/en/ult|v1|passage";
  const base = (extra: Partial<VerifiedEntry> = {}): VerifiedEntry => ({
    items: 1,
    exceptions: ["TIT 1:2,1-16"],
    chapters: { TIT: [1, 2] },
    ...extra,
  });
  const ok = (item: string) =>
    isVerified("en", "o/en/ult", "v1", "passage", item);
  afterEach(() => setVerifiedForTests(undefined));

  it("serves a range whose verses are clean and whose boundaries are all proven", () => {
    setVerifiedForTests({
      [K]: base({ exceptions: ["TIT 1:9,1-16"], joins: { TIT: "1:1-4,6" } }),
    });
    expect(ok("TIT 1:1-3")).toBe(true);
    expect(ok("TIT 1:1-5")).toBe(true);
    expect(ok("TIT 1:4-6")).toBe(false); // boundary 5 not proven
    expect(ok("TIT 1:6-7")).toBe(true);
    expect(ok("TIT 1:8-10")).toBe(false); // verse 9 excepted (and no joins)
    expect(ok("TIT 2:1-3")).toBe(true); // chapter 2 has no range exception: the whole-chapter rule
  });

  it("never serves a range over an excepted verse, even with its boundaries proven", () => {
    setVerifiedForTests({ [K]: base({ joins: { TIT: "1:1-4" } }) });
    expect(ok("TIT 1:1-3")).toBe(false);
    expect(ok("TIT 1:3-4")).toBe(true);
  });

  it("keeps the whole-chapter rule: a chapter with no range exception serves its clean ranges", () => {
    setVerifiedForTests({ [K]: base({ exceptions: [] }) });
    expect(ok("TIT 1:1-3")).toBe(true);
  });

  it("fails closed on a joins field it cannot read", () => {
    setVerifiedForTests({ [K]: base({ joins: { TIT: "1:x" } }) });
    expect(ok("TIT 1:3-4")).toBe(false);
    expect(ok("TIT 1:3")).toBe(true);
    setVerifiedForTests({ [K]: base({ joins: ["TIT"] as never }) });
    expect(ok("TIT 1:3")).toBe(false); // a field of the wrong type: the entry is unusable
  });
});

describe("sweep: range windows", () => {
  it("tiles a chapter's verses in 3-verse windows that share their ends, the first N", () => {
    expect(s.rangeWindows([1, 2, 3, 4, 5, 6, 7], 2)).toEqual([
      [1, 3],
      [3, 5],
    ]);
    expect(s.rangeWindows([1, 2, 3, 4], 9)).toEqual([
      [1, 3],
      [3, 4],
    ]);
    expect(s.rangeWindows([1], 3)).toEqual([]);
    expect(s.rangeWindows([1, 2, 3], 0)).toEqual([]);
  });

  it("adds window items only when asked", () => {
    const verses = { 1: [1, 2, 3, 4] };
    expect(s.passageItems("TIT", verses).some((i: any) => i.window)).toBe(
      false,
    );
    const items = s.passageItems("TIT", verses, { windows: 1 });
    expect(items.filter((i: any) => i.window).map((i: any) => i.item)).toEqual([
      "TIT 1:1-3",
    ]);
  });

  it("splits a 3-verse window into its two 2-verse windows", () => {
    expect(
      s
        .splitWindow({
          item: "TIT 1:3-5",
          book: "TIT",
          chapter: 1,
          window: true,
          res: ["r"],
        })
        .map((i: any) => i.item),
    ).toEqual(["TIT 1:3-4", "TIT 1:4-5"]);
    expect(
      s.splitWindow({
        item: "TIT 1:3-4",
        book: "TIT",
        chapter: 1,
        window: true,
      }),
    ).toEqual([]);
  });

  it("records the boundaries of the equal windows, per book: `c:v,a-b`", () => {
    const r = (item: string, status: string) => ({
      item,
      status,
      window: true,
    });
    expect(
      s.windowJoins([
        r("TIT 1:1-3", "equal"),
        r("TIT 1:3-5", "equal"),
        r("TIT 1:5-7", "differs"),
        r("TIT 1:6-7", "equal"),
        r("TIT 2:1-2", "not-in-answer"),
        r("TIT 3:4-5", "equal"),
        { item: "TIT 3:1-6", status: "equal" }, // not a window
      ]),
    ).toEqual({ TIT: "1:1-4,6;3:4" });
    expect(s.windowJoins([])).toEqual({});
  });

  it("keeps joins only for listed chapters that have a range exception", () => {
    const entry = {
      exceptions: ["TIT 1:4,1-16", "TIT 2:3"],
      chapters: { TIT: [1, 2] },
    };
    expect(s.pruneJoins({ TIT: "1:1-4;2:1-2;3:1", RUT: "1:1" }, entry)).toEqual(
      { TIT: "1:1-4" },
    );
  });
});
