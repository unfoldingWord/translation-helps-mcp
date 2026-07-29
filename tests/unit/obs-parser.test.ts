/**
 * Unit tests for OBS reference parser and story markdown parser.
 */

import { describe, it, expect } from "vitest";
import {
  parseObsReference,
  parseObsStoryMarkdown,
  parseObsNotesTsv,
  parseObsQuestionsTsv,
} from "@translation-helps/door43";

// ---------------------------------------------------------------------------
// parseObsReference
// ---------------------------------------------------------------------------
describe("parseObsReference", () => {
  it("parses standard story:frame reference", () => {
    const ref = parseObsReference("1:1");
    expect(ref).not.toBeNull();
    expect(ref!.story).toBe(1);
    expect(ref!.frame).toBe(1);
    expect(ref!.isFront).toBe(false);
    expect(ref!.canonical).toBe("1:1");
  });

  it("parses story title frame (frame 0)", () => {
    const ref = parseObsReference("1:0");
    expect(ref!.story).toBe(1);
    expect(ref!.frame).toBe(0);
  });

  it("parses front matter", () => {
    const ref = parseObsReference("front");
    expect(ref).not.toBeNull();
    expect(ref!.isFront).toBe(true);
    expect(ref!.story).toBeNull();
  });

  it("parses front:intro", () => {
    const ref = parseObsReference("front:intro");
    expect(ref!.isFront).toBe(true);
  });

  it("strips 'obs ' prefix (case-insensitive)", () => {
    const ref = parseObsReference("OBS 2:3");
    expect(ref!.story).toBe(2);
    expect(ref!.frame).toBe(3);
  });

  it("parses story 50 (boundary)", () => {
    const ref = parseObsReference("50:1");
    expect(ref!.story).toBe(50);
  });

  it("rejects story 0", () => {
    expect(parseObsReference("0:1")).toBeNull();
  });

  it("rejects story 51", () => {
    expect(parseObsReference("51:1")).toBeNull();
  });

  it("rejects bare 'obs'", () => {
    expect(parseObsReference("obs")).toBeNull();
  });

  it("rejects non-OBS references", () => {
    expect(parseObsReference("JHN 3:16")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(parseObsReference("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseObsStoryMarkdown
// ---------------------------------------------------------------------------
const SAMPLE_OBS_MARKDOWN = `# Creation

![Image: obs-01-01](https://cdn.unfoldingword.org/obs/jpg/obs-en-01-01.jpg)

In the beginning, God created the heavens and the earth.

![Image: obs-01-02](https://cdn.unfoldingword.org/obs/jpg/obs-en-01-02.jpg)

The earth was without form and void, and darkness was over the face of the deep.

_A Bible story from: Genesis 1–2_
`;

describe("parseObsStoryMarkdown", () => {
  it("parses story title from first heading", () => {
    const story = parseObsStoryMarkdown(1, SAMPLE_OBS_MARKDOWN);
    expect(story.title).toBe("Creation");
    expect(story.story).toBe(1);
  });

  it("extracts two frames (plus synthetic title frame at index 0)", () => {
    const story = parseObsStoryMarkdown(1, SAMPLE_OBS_MARKDOWN);
    // frames[0] is the synthetic title frame (index 0, no imageUrl)
    // frames[1] and frames[2] are the real content frames
    expect(story.frames).toHaveLength(3);
    expect(story.frames[0].index).toBe(0); // synthetic title frame
    expect(story.frames[1].index).toBe(1);
    expect(story.frames[2].index).toBe(2);
  });

  it("extracts image URLs", () => {
    const story = parseObsStoryMarkdown(1, SAMPLE_OBS_MARKDOWN);
    // Real frames start at index 1 in the array (after synthetic title frame)
    expect(story.frames[1].imageUrl).toContain("obs-en-01-01.jpg");
    // Synthetic title frame has no imageUrl
    expect(story.frames[0].imageUrl).toBeNull();
  });

  it("extracts frame text", () => {
    const story = parseObsStoryMarkdown(1, SAMPLE_OBS_MARKDOWN);
    // frames[1] is first real frame, frames[2] is second real frame
    expect(story.frames[1].text).toContain("God created the heavens");
    expect(story.frames[2].text).toContain("without form and void");
  });

  it("extracts attribution line", () => {
    const story = parseObsStoryMarkdown(1, SAMPLE_OBS_MARKDOWN);
    expect(story.attribution).toContain("Genesis 1");
  });
});

// ---------------------------------------------------------------------------
// parseObsNotesTsv
// ---------------------------------------------------------------------------
const SAMPLE_TN_TSV = `Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote
1:1\tml8v\t\ttranslate/writing-background\tIn the beginning\t1\tSome translators make this paragraph separate.
1:1\tabc1\t\ttranslate/figs-metaphor\tdarkness\t1\tDarkness here refers to chaos.
2:3\tdef2\t\t\t\t\tNote for story 2 frame 3.
front:intro\tghi3\t\t\t\t\tFront matter note.
`;

describe("parseObsNotesTsv", () => {
  it("returns notes matching story:frame", () => {
    const ref = parseObsReference("1:1")!;
    const notes = parseObsNotesTsv(SAMPLE_TN_TSV, ref);
    expect(notes).toHaveLength(2);
    expect(notes[0].id).toBe("ml8v");
    expect(notes[1].quote).toBe("darkness");
  });

  it("returns empty array for non-matching reference", () => {
    const ref = parseObsReference("3:1")!;
    const notes = parseObsNotesTsv(SAMPLE_TN_TSV, ref);
    expect(notes).toHaveLength(0);
  });

  it("returns front matter notes", () => {
    const ref = parseObsReference("front")!;
    const notes = parseObsNotesTsv(SAMPLE_TN_TSV, ref);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe("ghi3");
  });
});

// ---------------------------------------------------------------------------
// parseObsQuestionsTsv
// ---------------------------------------------------------------------------
const SAMPLE_TQ_TSV = `Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse
1:1\tq001\t\t\t\tWhat did God create first?\tThe heavens and the earth.
1:2\tq002\t\t\t\tWhat covered the earth?\tDarkness.
`;

describe("parseObsQuestionsTsv", () => {
  it("returns questions for matching frame", () => {
    const ref = parseObsReference("1:1")!;
    const questions = parseObsQuestionsTsv(SAMPLE_TQ_TSV, ref);
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toContain("God create");
    expect(questions[0].response).toContain("heavens");
  });

  it("returns empty for non-matching frame", () => {
    const ref = parseObsReference("1:3")!;
    const questions = parseObsQuestionsTsv(SAMPLE_TQ_TSV, ref);
    expect(questions).toHaveLength(0);
  });
});
