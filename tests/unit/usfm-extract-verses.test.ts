/**
 * extractVerses must find a verse wherever its marker sits on the line. In
 * poetry the ULT and UST write "\q1 \v 4 …", and a parser that only looked at
 * the start of a line returned Psalms and the prophets without their verses.
 */
import { describe, expect, it } from "vitest";
import { extractVerses } from "@translation-helps/door43";

const PSALM = [
  "\\c 23",
  "\\d",
  "\\v 1 A psalm of David.",
  "\\q1 Yahweh is my shepherd;",
  "\\q2 I will lack nothing.",
  "\\q1 \\v 2 He makes me lie down in green pastures;",
  "\\q2 he leads me to waters of rest.",
  "\\q1 \\v 3 He restores my soul;",
  "\\q2 he guides me along right paths.",
  "\\c 24",
  "\\q1 \\v 1 The earth is Yahweh's.",
].join("\n");

describe("extractVerses", () => {
  it("finds a verse whose marker follows a poetry marker", () => {
    expect(extractVerses(PSALM, "23", "2")).toBe(
      "2 He makes me lie down in green pastures; he leads me to waters of rest.",
    );
    expect(extractVerses(PSALM, "24", "1")).toBe("1 The earth is Yahweh's.");
  });

  it("ends a verse where the next one begins, wherever that marker is", () => {
    const first = extractVerses(PSALM, "23", "1");
    expect(first).toBe(
      "1 A psalm of David. Yahweh is my shepherd; I will lack nothing.",
    );
    expect(first).not.toContain("green pastures");
  });

  it("returns every verse of a range", () => {
    const range = extractVerses(PSALM, "23", "1", "3");
    expect(range).toContain("1 A psalm of David.");
    expect(range).toContain("2 He makes me lie down");
    expect(range).toContain("3 He restores my soul; he guides me");
  });

  it("stays inside the chapter", () => {
    expect(extractVerses(PSALM, "23", "3")).toBe(
      "3 He restores my soul; he guides me along right paths.",
    );
  });

  it("keeps the markers that open the verse's line in usfm format", () => {
    expect(extractVerses(PSALM, "23", "2", undefined, "usfm")).toBe(
      "\\q1 \\v 2 He makes me lie down in green pastures;\n\\q2 he leads me to waters of rest.",
    );
  });

  it("finds a verse that follows text on its line", () => {
    const prose = "\\c 1\n\\p\n\\v 1 One. \\v 2 Two.\n\\v 3 Three.";
    expect(extractVerses(prose, "1", "1")).toBe("1 One.");
    expect(extractVerses(prose, "1", "2")).toBe("2 Two.");
    expect(extractVerses(prose, "1", "2", "3")).toBe("2 Two. 3 Three.");
  });

  it("finds a verse bridge by either of its verses", () => {
    const bridged = "\\c 1\n\\v 1 One.\n\\v 2-3 Two and three.\n\\v 4 Four.";
    expect(extractVerses(bridged, "1", "2")).toBe("2-3 Two and three.");
    expect(extractVerses(bridged, "1", "3")).toBe("2-3 Two and three.");
    expect(extractVerses(bridged, "1", "3", "4")).toBe(
      "2-3 Two and three. 4 Four.",
    );
    expect(extractVerses(bridged, "1", "4")).toBe("4 Four.");
  });

  it("does not take an alternate verse number for a verse", () => {
    const alternate = "\\c 1\n\\v 1 One \\va 3\\va* still one.\n\\v 2 Two.";
    expect(extractVerses(alternate, "1", "3")).toBeNull();
    expect(extractVerses(alternate, "1", "1")).toContain("still one.");
    expect(extractVerses(alternate, "1", "1")).not.toContain("Two");
  });

  it("returns null for a verse or a chapter that is not there", () => {
    expect(extractVerses(PSALM, "23", "7")).toBeNull();
    expect(extractVerses(PSALM, "25", "1")).toBeNull();
  });

  it("still returns a whole chapter when no verse is asked for", () => {
    const chapter = extractVerses(PSALM, "23");
    expect(chapter).toContain("1 A psalm of David.");
    expect(chapter).toContain("3 He restores my soul;");
    expect(chapter).not.toContain("The earth is Yahweh's");
  });
});
