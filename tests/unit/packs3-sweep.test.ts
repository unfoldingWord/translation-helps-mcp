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
    expect(
      s.resourcesOfKind("search", resources).map((r: any) => r.key),
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
    expect(
      s.unionChapters([
        ["1", "2"],
        ["2", "10", "x"],
      ]),
    ).toEqual([1, 2, 10]);
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

  it("ships an empty verified.json", () => {
    const f = new URL("../../src/packs3/verified.json", import.meta.url);
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({});
  });
});
