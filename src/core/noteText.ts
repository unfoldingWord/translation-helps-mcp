/**
 * Note-body cleanup for MCP output.
 *
 * Verse links like `../01/29.md` become a reference get_note / get_passage
 * accept. Text under an "Alternate translation" heading is left unchanged.
 */

import { usfmToBookName } from "@translation-helps/door43";

const HEADING = /^(#+)\s+(.*)$/;
const ALT_HEADING = /^alternate translation\b/i;
const MARKDOWN_LINK =
  /\[([^\]]*)\]\((\.\.\/(?:\.\.\/[A-Za-z0-9]{3}\/)?\d{1,3}\/\d{1,3}\.md)\)/gi;
const BARE_LINK = /\.\.\/(?:\.\.\/[A-Za-z0-9]{3}\/)?\d{1,3}\/\d{1,3}\.md/gi;

function verseReference(href: string, bookUsfm: string): string | null {
  const other =
    /^\.\.\/\.\.\/([A-Za-z0-9]{3})\/(\d{1,3})\/(\d{1,3})\.md$/i.exec(href);
  const same = /^\.\.\/(\d{1,3})\/(\d{1,3})\.md$/i.exec(href);
  const match = other ?? same;
  if (!match) return null;
  const bookCode = other ? (other[1] ?? bookUsfm) : bookUsfm;
  const chapter = other ? other[2] : same?.[1];
  const verse = other ? other[3] : same?.[2];
  if (!chapter || !verse) return null;
  const name = usfmToBookName(bookCode);
  return `${name} ${parseInt(chapter, 10)}:${parseInt(verse, 10)}`;
}

function rewriteLine(line: string, bookUsfm: string): string {
  const linked = line.replace(
    MARKDOWN_LINK,
    (whole, _label: string, href: string) => {
      return verseReference(href, bookUsfm) ?? whole;
    },
  );
  return linked.replace(
    BARE_LINK,
    (href) => verseReference(href, bookUsfm) ?? href,
  );
}

/** Rewrite verse links outside the alternate-translation section. */
export function rewriteNoteVerseLinks(note: string, bookUsfm: string): string {
  let skipping = false;
  let skipLevel = 0;
  return note
    .split("\n")
    .map((line) => {
      const heading = HEADING.exec(line);
      if (heading) {
        const level = heading[1]?.length ?? 1;
        const title = (heading[2] ?? "").trim();
        if (skipping && level <= skipLevel) skipping = false;
        if (!skipping && ALT_HEADING.test(title)) {
          skipping = true;
          skipLevel = level;
        }
      }
      if (skipping) return line;
      return rewriteLine(line, bookUsfm);
    })
    .join("\n");
}
