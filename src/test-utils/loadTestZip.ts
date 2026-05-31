/**
 * loadTestZip — creates an in-memory ZIP archive for indexer unit tests.
 *
 * Builds a minimal Door43 ZIP with:
 *   manifest.yaml  — specifies license and language
 *   {filePath}     — the content file to index
 *
 * Returns a Uint8Array suitable for passing to ZipResourceFetcher2 methods.
 */

import { zipSync, strToU8 } from "fflate";

export interface TestZipOptions {
  /** Path inside the ZIP, e.g. "en_tn/57-TIT.tsv" */
  filePath: string;
  /** Content of the file */
  content: string;
  /** License string for manifest.yaml (default: CC BY-SA 4.0) */
  license?: string;
  /** BCP 47 language code (default: en) */
  language?: string;
  /** Project name (default: test_project) */
  project?: string;
}

export function loadTestZip(options: TestZipOptions): Uint8Array {
  const {
    filePath,
    content,
    license = "CC BY-SA 4.0",
    language = "en",
    project = "test_project",
  } = options;

  const manifest = [
    "---",
    `dublin_core:`,
    `  language:`,
    `    identifier: ${language}`,
    `  subject: Translation Notes`,
    `license: ${license}`,
    `  identifier: ${project}`,
    "ingredients:",
    `  - path: ./${filePath}`,
    "...",
  ].join("\n");

  const files: Record<string, Uint8Array> = {
    "manifest.yaml": strToU8(manifest),
    [filePath]: strToU8(content),
  };

  return zipSync(files);
}

/**
 * Create a minimal TSV content for testing (Translation Notes format).
 */
export function sampleTsvContent(): string {
  return [
    "Book\tChapter\tVerse\tID\tSupportReference\tOrigWords\tOccurrence\tNote",
    "JHN\t3\t16\tabc1\trc://en/tw/dict/bible/kt/love\tἠγάπησεν\t1\tThe Greek word here means to love unconditionally.",
    "JHN\t3\t16\tabc2\trc://en/ta/man/translate/figs-metaphor\tμονογενῆ\t1\tThis refers to the only-born Son of God.",
    "JHN\t3\t17\tabc3\t\tκρίνῃ\t1\tThe word translated judge means to condemn in this context.",
  ].join("\n");
}

/**
 * Create a minimal USFM content for testing.
 */
export function sampleUsfmContent(): string {
  return `\\id JHN - unfoldingWord® Literal Text
\\usfm 3.0
\\h John
\\toc1 The Gospel of John
\\mt John
\\c 3
\\p
\\v 16 For God so loved the world, that he gave his only Son,
that whoever believes in him should not perish but have eternal life.
\\v 17 For God did not send his Son into the world to condemn the world,
but in order that the world might be saved through him.
`;
}

/**
 * Create a minimal TW Markdown article for testing.
 */
export function sampleMarkdownContent(): string {
  return `---
title: love
rc-link: rc://en/tw/dict/bible/kt/love
---

# love

## Definition

The word "love" in the Bible refers to God's unconditional love for humanity.

## Translation Suggestions

* "Show deep affection toward"
* "Care deeply about"
* "Treat with great kindness"

See also: [grace](rc://en/tw/dict/bible/kt/grace), [mercy](rc://en/tw/dict/bible/kt/mercy)
`;
}
