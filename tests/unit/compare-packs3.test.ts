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
    expect(s.isReleaseSkew("en_tn v91", "en_tn v92")).toBe(true);
    expect(s.isReleaseSkew("en_tn v91", "en_ta v92")).toBe(false);
    expect(s.isReleaseSkew("same v91", "same v91")).toBe(false);
    const c = s.classify(
      [
        { path: "$.v", a: "v91", b: "v92" },
        { path: "$.q", a: 1, b: 2 },
      ],
      { tool: "t", args: {} },
      [],
    );
    expect(c.skew).toHaveLength(1);
    expect(c.failing).toHaveLength(1);
  });

  it("detects a fallback answer", () => {
    expect(
      s.isFallback({
        isError: true,
        content: [{ text: "PACKS3_FALLBACK: x" }],
      }),
    ).toBe(true);
    expect(s.isFallback({ content: [{ text: "ok" }] })).toBe(false);
  });

  it("call list is valid, with enough calls and the required ones", () => {
    const calls = JSON.parse(
      readFileSync("tests/contracts/packs3-calls.json", "utf8"),
    );
    const v = s.validateCalls(calls);
    expect(v.errors).toEqual([]);
    expect(v.en).toBeGreaterThanOrEqual(30);
    expect(v.es).toBeGreaterThanOrEqual(20);
    expect(
      calls.filter((c: { expect: string }) => c.expect === "fallback"),
    ).toHaveLength(2);
    expect(new Set(calls.map((c: { tool: string }) => c.tool))).toEqual(
      new Set(s.TOOLS),
    );
    const known = JSON.parse(
      readFileSync("tests/contracts/packs3-known-diffs.json", "utf8"),
    );
    expect(s.validateKnown(known)).toEqual([]);
  });
});
