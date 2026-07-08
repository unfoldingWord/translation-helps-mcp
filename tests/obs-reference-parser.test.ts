/**
 * OBS reference parser (issue #32)
 *
 * Deterministic unit tests for the story:frame reference scheme. This parser
 * is fully isolated from the Bible reference parsers — these tests lock in
 * the OBS grammar from the issue: "1:1", "1:0" (title), "front", ranges
 * ("1:1-8"), whole stories, stories 1-50, and the tolerated "OBS"/"story"
 * prefixes LLMs emit.
 */

import { describe, it, expect } from "vitest";
import {
  parseOBSReference,
  formatOBSReference,
  obsStoryFileName,
  OBS_MAX_STORY,
} from "../src/functions/obs-reference-parser.js";

describe("parseOBSReference", () => {
  it("parses story:frame", () => {
    expect(parseOBSReference("1:1")).toEqual({
      story: 1,
      frame: 1,
      isFront: false,
    });
    expect(parseOBSReference("50:17")).toEqual({
      story: 50,
      frame: 17,
      isFront: false,
    });
  });

  it("parses the story title reference (frame 0)", () => {
    expect(parseOBSReference("1:0")).toEqual({
      story: 1,
      frame: 0,
      isFront: false,
    });
  });

  it("parses a whole-story reference", () => {
    expect(parseOBSReference("12")).toEqual({ story: 12, isFront: false });
  });

  it("parses frame ranges", () => {
    expect(parseOBSReference("1:1-8")).toEqual({
      story: 1,
      frame: 1,
      endFrame: 8,
      isFront: false,
    });
    // Whitespace around the dash is tolerated.
    expect(parseOBSReference("2:3 - 5")).toEqual({
      story: 2,
      frame: 3,
      endFrame: 5,
      isFront: false,
    });
    // Degenerate range collapses to a single frame.
    expect(parseOBSReference("1:4-4")).toEqual({
      story: 1,
      frame: 4,
      isFront: false,
    });
  });

  it("parses front matter forms", () => {
    expect(parseOBSReference("front")).toEqual({ isFront: true });
    expect(parseOBSReference("front:intro")).toEqual({ isFront: true });
    expect(parseOBSReference("intro")).toEqual({ isFront: true });
    expect(parseOBSReference("FRONT")).toEqual({ isFront: true });
  });

  it("tolerates OBS/story prefixes (LLM input)", () => {
    expect(parseOBSReference("OBS 1:1")).toEqual({
      story: 1,
      frame: 1,
      isFront: false,
    });
    expect(parseOBSReference("obs 1:1")).toEqual({
      story: 1,
      frame: 1,
      isFront: false,
    });
    expect(parseOBSReference("obs front")).toEqual({ isFront: true });
    expect(parseOBSReference("story 1 frame 1")).toEqual({
      story: 1,
      frame: 1,
      isFront: false,
    });
    expect(parseOBSReference("OBS story 3:2")).toEqual({
      story: 3,
      frame: 2,
      isFront: false,
    });
  });

  it("rejects out-of-range stories", () => {
    expect(() => parseOBSReference("0:1")).toThrow(/Invalid OBS reference/);
    expect(() => parseOBSReference(`${OBS_MAX_STORY + 1}:1`)).toThrow(
      /out of range/,
    );
  });

  it("rejects inverted ranges", () => {
    expect(() => parseOBSReference("1:8-3")).toThrow(/before start frame/);
  });

  it("rejects non-OBS references with a helpful hint", () => {
    for (const bad of ["John 3:16", "", "  ", "abc", "1:2:3"]) {
      expect(() => parseOBSReference(bad)).toThrow(/story:frame/);
    }
  });
});

describe("formatOBSReference", () => {
  it("round-trips canonical forms", () => {
    for (const ref of ["1:1", "1:0", "1:1-8", "12", "front"]) {
      expect(formatOBSReference(parseOBSReference(ref))).toBe(ref);
    }
  });
});

describe("obsStoryFileName", () => {
  it("zero-pads story filenames", () => {
    expect(obsStoryFileName(1)).toBe("01.md");
    expect(obsStoryFileName(50)).toBe("50.md");
  });
});
