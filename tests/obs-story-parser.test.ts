/**
 * OBS story markdown parser (issue #32)
 *
 * Fixture is an abbreviated copy of live en_obs content/01.md structure:
 * a numbered `#` title, implicit frames as image+paragraph pairs (no frame
 * headings), and a trailing italic source-reference line.
 */

import { describe, it, expect } from "vitest";
import {
  parseOBSStoryMarkdown,
  selectOBSFrames,
} from "../src/functions/obs-story-parser.js";
import { parseOBSReference } from "../src/functions/obs-reference-parser.js";

const STORY_1_FIXTURE = `# 1. The Creation

![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)

This is how God made everything in the beginning. He created the universe and everything in it in six days.

![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg)

Then God said, "Let there be light!" And there was light.

![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-03.jpg)

On the second day of creation, God said, "Let there be an expanse above the waters."

_A Bible story from: Genesis 1-2_
`;

describe("parseOBSStoryMarkdown", () => {
  const story = parseOBSStoryMarkdown(STORY_1_FIXTURE, 1);

  it("extracts the title with the numbering stripped", () => {
    expect(story.title).toBe("The Creation");
    expect(story.story).toBe(1);
  });

  it("walks implicit image+paragraph frames", () => {
    expect(story.frames).toHaveLength(3);
    expect(story.frames[0]).toEqual({
      frame: 1,
      imageUrl: "https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg",
      text: "This is how God made everything in the beginning. He created the universe and everything in it in six days.",
    });
    expect(story.frames[2].frame).toBe(3);
    expect(story.frames[2].text).toContain("second day of creation");
  });

  it("captures the trailing source line as bibleReference", () => {
    expect(story.bibleReference).toBe("A Bible story from: Genesis 1-2");
    // …and does NOT append it to the last frame's text.
    expect(story.frames[2].text).not.toContain("A Bible story from");
  });

  it("joins multi-paragraph frame text", () => {
    const multi = parseOBSStoryMarkdown(
      "# 2. Title\n\n![img](https://x/1.jpg)\n\nFirst paragraph.\n\nSecond paragraph.\n",
      2,
    );
    expect(multi.frames[0].text).toBe("First paragraph.\nSecond paragraph.");
  });
});

describe("selectOBSFrames", () => {
  const story = parseOBSStoryMarkdown(STORY_1_FIXTURE, 1);

  it("returns all frames for a whole-story reference", () => {
    expect(selectOBSFrames(story, parseOBSReference("1"))).toHaveLength(3);
  });

  it("returns one frame for story:frame", () => {
    const frames = selectOBSFrames(story, parseOBSReference("1:2"));
    expect(frames).toHaveLength(1);
    expect(frames[0].frame).toBe(2);
  });

  it("returns no frames for the title reference (1:0)", () => {
    expect(selectOBSFrames(story, parseOBSReference("1:0"))).toHaveLength(0);
  });

  it("returns the frames covered by a range", () => {
    const frames = selectOBSFrames(story, parseOBSReference("1:2-3"));
    expect(frames.map((f) => f.frame)).toEqual([2, 3]);
  });

  it("returns an empty set for frames past the end of the story", () => {
    expect(selectOBSFrames(story, parseOBSReference("1:9"))).toHaveLength(0);
  });
});
