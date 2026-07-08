/**
 * OBS TSV row filter (issue #32)
 *
 * Fixture rows are taken from live tn_OBS.tsv / sq_OBS.tsv shapes: exact
 * story:frame rows, a 1:0 title row, a `front` row, and frame-RANGE rows
 * (1:1-8, 1:9-10) as they appear in Study Questions. The filter must match
 * by frame-set overlap, not string equality.
 */

import { describe, it, expect } from "vitest";
import { filterOBSTSVRows } from "../src/functions/obs-tsv-filter.js";
import { parseOBSReference } from "../src/functions/obs-reference-parser.js";

const row = (Reference: string, ID: string) => ({ Reference, ID });

const ROWS = [
  row("front", "vj0h"),
  row("1:0", "i6lj"),
  row("1:1", "lm48"),
  row("1:1", "qyk4"),
  row("1:1-8", "toi2"),
  row("1:9-10", "nqcu"),
  row("1:9", "egb5"),
  row("2:1", "abc1"),
  row("", "junk"),
  row("nonsense", "junk2"),
];

const ids = (refString: string) =>
  filterOBSTSVRows(ROWS, parseOBSReference(refString)).map((r) => r.ID);

describe("filterOBSTSVRows", () => {
  it("matches exact story:frame rows", () => {
    expect(ids("1:1")).toEqual(["lm48", "qyk4", "toi2"]);
  });

  it("matches the title row for 1:0", () => {
    expect(ids("1:0")).toEqual(["i6lj"]);
  });

  it("matches front-matter rows for front", () => {
    expect(ids("front")).toEqual(["vj0h"]);
  });

  it("matches range ROWS by overlap (a 1:3 request hits the 1:1-8 row)", () => {
    expect(ids("1:3")).toEqual(["toi2"]);
    expect(ids("1:9")).toEqual(["nqcu", "egb5"]);
  });

  it("matches range REQUESTS by overlap", () => {
    expect(ids("1:8-9")).toEqual(["toi2", "nqcu", "egb5"]);
  });

  it("matches every row of a story for a whole-story request", () => {
    expect(ids("1")).toEqual(["i6lj", "lm48", "qyk4", "toi2", "nqcu", "egb5"]);
  });

  it("never crosses stories", () => {
    expect(ids("2:1")).toEqual(["abc1"]);
    expect(ids("2")).toEqual(["abc1"]);
  });

  it("silently skips rows with blank or malformed references", () => {
    for (const refString of ["1", "1:1", "front"]) {
      expect(ids(refString)).not.toContain("junk");
      expect(ids(refString)).not.toContain("junk2");
    }
  });

  it("tolerates a lowercase `reference` column key", () => {
    const rows = [{ reference: "3:2", ID: "low1" }];
    expect(
      filterOBSTSVRows(rows as any, parseOBSReference("3:2")).map(
        (r: any) => r.ID,
      ),
    ).toEqual(["low1"]);
  });
});
