/**
 * One reference reader for Bible and OBS. The table is the contract:
 * codes, names, ranges, intros, a book alone, OBS forms, and decomposed args.
 */
import { describe, expect, it } from "vitest";
import {
  readReference,
  type ReferenceRead,
} from "../../src/mcp/v3/readReference.js";

type Ok = { ok: true; value: ReferenceRead };

function bible(
  book: string,
  reference: string,
  extra: Partial<Extract<ReferenceRead, { kind: "bible" }>> = {},
): Ok {
  return {
    ok: true,
    value: { kind: "bible", book, reference, ...extra },
  };
}

function obs(
  story: number | null,
  reference: string,
  extra: Partial<Extract<ReferenceRead, { kind: "obs" }>> = {},
): Ok {
  return {
    ok: true,
    value: { kind: "obs", story, reference, ...extra },
  };
}

function book(code: string): Ok {
  return { ok: true, value: { kind: "book", book: code, reference: code } };
}

describe("readReference", () => {
  it.each([
    ["JHN 3:16", bible("JHN", "JHN 3:16", { chapter: "3", verse: "16" })],
    ["John 3:16", bible("JHN", "JHN 3:16", { chapter: "3", verse: "16" })],
    ["jhn 3:16", bible("JHN", "JHN 3:16", { chapter: "3", verse: "16" })],
    ["  JHN 3:16  ", bible("JHN", "JHN 3:16", { chapter: "3", verse: "16" })],
    ["Juan 3:16", bible("JHN", "JHN 3:16", { chapter: "3", verse: "16" })],
    [
      "GEN 1:1-3",
      bible("GEN", "GEN 1:1-3", { chapter: "1", verse: "1", endVerse: "3" }),
    ],
    [
      "John 3:16-18",
      bible("JHN", "JHN 3:16-18", {
        chapter: "3",
        verse: "16",
        endVerse: "18",
      }),
    ],
    [
      "Luke 23:50-24:12",
      bible("LUK", "LUK 23:50-24:12", {
        chapter: "23",
        verse: "50",
        endChapter: "24",
        endVerse: "12",
      }),
    ],
    ["MAT 5", bible("MAT", "MAT 5", { chapter: "5" })],
    ["GEN 1-3", bible("GEN", "GEN 1-3", { chapter: "1", endChapter: "3" })],
    ["Jude 3", bible("JUD", "JUD 1:3", { chapter: "1", verse: "3" })],
    [
      "Jude 3-5",
      bible("JUD", "JUD 1:3-5", { chapter: "1", verse: "3", endVerse: "5" }),
    ],
    ["Jude 1", bible("JUD", "JUD 1", { chapter: "1" })],
    ["Filemon 6", bible("PHM", "PHM 1:6", { chapter: "1", verse: "6" })],
    ["2KGS 12:8", bible("2KI", "2KI 12:8", { chapter: "12", verse: "8" })],
    ["MAR 1:1", bible("MRK", "MRK 1:1", { chapter: "1", verse: "1" })],
    [
      "JHN front:intro",
      bible("JHN", "JHN front:intro", { chapter: "front", verse: "intro" }),
    ],
    [
      "Jonah front:intro",
      bible("JON", "JON front:intro", { chapter: "front", verse: "intro" }),
    ],
    [
      "front:intro",
      bible("", "front:intro", { chapter: "front", verse: "intro" }),
    ],
    [
      "JHN 1:intro",
      bible("JHN", "JHN 1:intro", { chapter: "1", verse: "intro" }),
    ],
    ["1:intro", bible("", "1:intro", { chapter: "1", verse: "intro" })],
    [
      { book: "JHN", chapter: 3, verse: 16 },
      bible("JHN", "JHN 3:16", { chapter: "3", verse: "16" }),
    ],
    [
      { book: "Jonah", chapter: "1", verse: "1" },
      bible("JON", "JON 1:1", { chapter: "1", verse: "1" }),
    ],
    [
      { book: "GEN", chapter: 1, verse: 1, endVerse: 3 },
      bible("GEN", "GEN 1:1-3", { chapter: "1", verse: "1", endVerse: "3" }),
    ],
    [
      {
        book: "Luke",
        chapter: 23,
        verse: 50,
        endChapter: 24,
        endVerse: 12,
      },
      bible("LUK", "LUK 23:50-24:12", {
        chapter: "23",
        verse: "50",
        endChapter: "24",
        endVerse: "12",
      }),
    ],
    [
      { book: "JHN", chapter: "front", verse: "intro" },
      bible("JHN", "JHN front:intro", { chapter: "front", verse: "intro" }),
    ],
    ["JON", book("JON")],
    ["Jonah", book("JON")],
    ["1 John", book("1JN")],
    [{ book: "Jonah" }, book("JON")],
    ["OBS 3:5", obs(3, "OBS 3:5", { frame: 5 })],
    ["obs 3:5", obs(3, "OBS 3:5", { frame: 5 })],
    ["OBS 3:1-3", obs(3, "OBS 3:1-3", { frame: 1, endFrame: 3 })],
    ["OBS 3", obs(3, "OBS 3")],
    ["3:5", obs(3, "OBS 3:5", { frame: 5 })],
    ["3:1-3", obs(3, "OBS 3:1-3", { frame: 1, endFrame: 3 })],
    ["3", obs(3, "OBS 3")],
    [{ story: 3, frame: 5 }, obs(3, "OBS 3:5", { frame: 5 })],
    [{ story_number: 3, frame_number: 5 }, obs(3, "OBS 3:5", { frame: 5 })],
    [
      { story: 3, frame: 1, endFrame: 3 },
      obs(3, "OBS 3:1-3", { frame: 1, endFrame: 3 }),
    ],
    [{ story: 3 }, obs(3, "OBS 3")],
    [{ story_number: "3" }, obs(3, "OBS 3")],
    ["front", obs(null, "OBS front")],
    ["OBS front", obs(null, "OBS front")],
  ])("accepts %j", (input, expected) => {
    expect(readReference(input)).toEqual(expected);
  });

  it("uses the language argument for a localized name", () => {
    expect(readReference("Juan 3:16", "es")).toEqual(
      bible("JHN", "JHN 3:16", { chapter: "3", verse: "16" }),
    );
    expect(readReference({ reference: "Jonas" }, "es")).toEqual(book("JON"));
  });

  it.each([
    "",
    "   ",
    "not-a-book",
    "OBS",
    "3:5-2",
    "99:1",
    "0:1",
    { book: "JHN", story: 3, frame: 5 },
    { frame: 5 },
    { endFrame: 3 },
    null,
    3,
  ])("rejects %j with the accepted forms and an example", (input) => {
    const result = readReference(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/JHN 3:16/);
    expect(result.message).toMatch(/OBS 3:5/);
  });

  it("names the clash when Bible and OBS parts are both present", () => {
    const result = readReference({
      book: "JHN",
      chapter: 3,
      story: 3,
      frame: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/Bible/);
    expect(result.message).toMatch(/OBS/);
    expect(result.message).toMatch(/JHN 3:16/);
  });
});
