import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import * as s from "../../scripts/compare-packs3.mjs";

describe("compare-packs3 pure parts", () => {
  it("normalizes requestId, meta.timings, meta.cache and the [cache] tag", () => {
    const out = s.normalize({
      requestId: "r1",
      meta: { cache: "hit", timings: { a: 1 }, other: 1 },
      structuredContent: { requestId: "r2", meta: { cache: "x" }, n: 1 },
      text: "5 notes [cache: hit]",
    });
    expect(out).toEqual({
      meta: { other: 1 },
      structuredContent: { n: 1 },
      text: "5 notes",
    });
  });

  it("computes diff paths", () => {
    const d = s.diffPaths(
      { a: [1, { b: 2 }], c: 1 },
      { a: [1, { b: 3 }, 4], d: 1 },
    );
    expect(d.map((x: { path: string }) => x.path).sort()).toEqual([
      "$.a[1].b",
      "$.a[2]",
      "$.c",
      "$.d",
    ]);
    expect(s.diffPaths({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("matches known differences by tool, args and path", () => {
    const call = { tool: "th_get_notes", args: { reference: "X" } };
    const known = [
      { tool: "th_get_notes", path: "$.notes[].quote", reason: "r" },
    ];
    expect(s.matchKnown(known, call, "$.notes[3].quote")).toBeTruthy();
    expect(s.matchKnown(known, call, "$.notes[3].body")).toBeFalsy();
    expect(
      s.matchKnown(known, { ...call, tool: "th_search" }, "$.notes[3].quote"),
    ).toBeFalsy();
    expect(
      s.matchKnown(
        [{ ...known[0], args: { reference: "Y" } }],
        call,
        "$.notes[3].quote",
      ),
    ).toBeFalsy();
    expect(
      s.matchKnown(
        [{ tool: "th_get_notes", path: "$.meta*", reason: "r" }],
        call,
        "$.meta.x",
      ),
    ).toBeTruthy();
  });

  it("detects release skew and classifies", () => {
    expect(s.isReleaseSkew("en_tn v91", "en_tn v92", "$.a.release")).toBe(true);
    expect(s.isReleaseSkew("en_tn v91", "en_ta v92", "$.a.release")).toBe(
      false,
    );
    expect(s.isReleaseSkew("same v91", "same v91", "$.a.release")).toBe(false);
    // Not a release field: v3 against v4 elsewhere stays a diff.
    expect(s.isReleaseSkew("format v3", "format v4", "$.notes[0].body")).toBe(
      false,
    );
    expect(s.isReleaseSkew("en_tn v91", "en_tn v92")).toBe(false);
    const c = s.classify(
      [
        { path: "$.resource.release", a: "v91", b: "v92" },
        { path: "$.q", a: 1, b: 2 },
      ],
      { tool: "t", args: {} },
      [],
    );
    expect(c.skew).toHaveLength(1);
    expect(c.failing).toHaveLength(1);
    // One-base mode: a release difference on a served call fails.
    const one = s.classify(
      [{ path: "$.resource.release", a: "v91", b: "v92" }],
      { tool: "t", args: {} },
      [],
      false,
    );
    expect(one.skew).toHaveLength(0);
    expect(one.failing).toHaveLength(1);
  });

  it("strips only the named cache fields", () => {
    expect(
      s.normalize({ cacheStatus: "hit", meta: { cacheStatus: "hit" } }),
    ).toEqual({ cacheStatus: "hit" });
    expect(s.normalize({ text: "a [hit]" })).toEqual({ text: "a [hit]" });
  });

  it("normalizeResult also drops the result's top-level cacheStatus, nothing nested", () => {
    expect(
      s.normalizeResult({
        cacheStatus: "miss",
        meta: { cacheStatus: "hit" },
        sc: { cacheStatus: "hit" },
      }),
    ).toEqual({ sc: { cacheStatus: "hit" } });
  });

  it("strips the meta.cache source tag from the prose summary, which differs by design", () => {
    const head = "3 scripture version(s) for JHN 3:16";
    expect(s.normalize({ text: `${head} [kv]` })).toEqual({ text: head });
    expect(
      s.normalize({
        text: `${head} [pack]
more [kv] inside`,
      }),
    ).toEqual({
      text: `${head}
more [kv] inside`,
    });
    expect(s.normalize({ text: "a [kvx]" })).toEqual({ text: "a [kvx]" });
  });

  it("two errors must be the same error class", () => {
    const e1 = { isError: true, structuredContent: { code: "NOT_FOUND" } };
    const e2 = { isError: true, structuredContent: { code: "INTERNAL" } };
    expect(s.errorMismatch(e1, e1)).toBeNull();
    expect(s.errorMismatch(e1, e2)).toMatch(/mismatch/);
    expect(s.errorMismatch(e1, { content: [{ text: "ok" }] })).toMatch(
      /mismatch/,
    );
    expect(s.errorMismatch({ content: [] }, { content: [] })).toBeNull();
  });

  it("reads the Worker's _meta._packs3 mark, never the answer text", () => {
    const served = {
      content: [{ text: "PACKS3_FALLBACK adapter-undefined" }],
      _meta: { _packs3: { served: true } },
    };
    expect(s.packs3Status(served)).toEqual({ kind: "served" });
    expect(s.fallbackReason(served)).toBeNull();
    expect(s.isFallback(served)).toBe(false);

    const fb = {
      content: [{ text: "ok" }],
      _meta: { _packs3: { fallback: "readers-busy" } },
    };
    expect(s.packs3Status(fb)).toEqual({
      kind: "fallback",
      reason: "readers-busy",
    });
    expect(s.fallbackReason(fb)).toBe("readers-busy");
    expect(s.isFallback(fb)).toBe(true);

    // No mark: unmarked, whatever the text says. Never counted as served, never inferred as a fallback.
    for (const r of [
      { isError: true, content: [{ text: "PACKS3_FALLBACK: x" }] },
      {
        structuredContent: {
          available: false,
          code: "RESOURCE_NOT_AVAILABLE",
          message: "no-adapter",
        },
      },
      {
        structuredContent: {
          notes: [],
          message: 'Translation notes are not available for language "en".',
        },
      },
      { content: [{ text: "ok" }] },
      { content: [{ text: "ok" }], _meta: { _packs3: { other: 1 } } },
      undefined,
    ]) {
      expect(s.packs3Status(r)).toEqual({ kind: "unmarked" });
      expect(s.fallbackReason(r)).toBeNull();
      expect(s.isFallback(r)).toBe(false);
    }
  });

  it("normalize drops the _packs3 mark, keeps the rest of _meta", () => {
    expect(s.normalize({ a: 1, _meta: { _packs3: { served: true } } })).toEqual(
      { a: 1 },
    );
    expect(
      s.normalize({ a: 1, _meta: { _packs3: { fallback: "x" }, k: 2 } }),
    ).toEqual({ a: 1, _meta: { k: 2 } });
  });

  it("drops the text block that mirrors structuredContent differences", () => {
    const diffs = [
      { path: "$.content[1].text", a: '{"x":1}', b: '{"x":2}' },
      { path: "$.structuredContent.x", a: 1, b: 2 },
      { path: "$.content[0].text", a: "1 note(s)", b: "2 note(s)" },
    ];
    expect(
      s.dropMirroredText(diffs).map((d: { path: string }) => d.path),
    ).toEqual(["$.structuredContent.x", "$.content[0].text"]);
  });

  it("call list is valid, with enough calls and the required ones", () => {
    const calls = JSON.parse(
      readFileSync("tests/contracts/packs3-calls.json", "utf8"),
    );
    const v = s.validateCalls(calls);
    expect(v.errors).toEqual([]);
    expect(v.en).toBeGreaterThanOrEqual(30);
    expect(v.es).toBeGreaterThanOrEqual(20);
    type Call = { expect: string; args: Record<string, unknown>; why?: string };
    const fallbacks = calls.filter((c: Call) => c.expect === "fallback");
    // The two planned fallbacks, and every call the local comparison saw fall back, with its reason (Task 10 part B).
    const planned = fallbacks.filter(
      (c: Call) =>
        c.args.language === "fr" ||
        (c.args.language === "es-419" && c.args.reference === "MAT 5:1"),
    );
    expect(planned).toHaveLength(2);
    for (const c of fallbacks) {
      if (!planned.includes(c)) expect(c.why).toBeTruthy();
    }
    expect(
      calls.filter((c: Call) => c.expect === "pack").length,
    ).toBeGreaterThan(0);
    expect(new Set(calls.map((c: { tool: string }) => c.tool))).toEqual(
      new Set(s.TOOLS),
    );
    const known = JSON.parse(
      readFileSync("tests/contracts/packs3-known-diffs.json", "utf8"),
    );
    expect(s.validateKnown(known)).toEqual([]);
  });
});
