/**
 * Placeholder instructions for /v3/mcp.
 * T-053 replaces this with the finished workflow text.
 * No assistant persona. The language rule and the two reference forms
 * are stated once, here, not repeated inside every tool.
 */

/** Told to the model when a v3 resource is missing. Names the v3 tool, not v2's. */
export const V3_LIST_RESOURCES_HINT =
  "Run th_list_resources to see what is available for this language.";

/**
 * The reference is the one the caller sent, after the reader normalizes the
 * book, so "Jonah 1:intro" is quoted as "JON 1:intro".
 */
export function introductionNotesMessage(reference: string): string {
  return `introductions are notes: use th_get_notes with reference '${reference}'`;
}

export const V3_SERVER_INSTRUCTIONS = `Translation Helps serves unfoldingWord and Door43 resources used to translate the Bible.

Language: pass the BCP-47 code the user asked for, such as "es" or "es-419". Use "en" only when they did not name a language. Call th_list_resources with no language to see the codes.

References have two forms.
Bible: a book with a chapter or verse, such as "JHN 3:16", "John 3", "GEN 1" or "JON 1". A book alone, such as "Jonah", is not a passage: th_get_passage_index takes a whole book, and th_get_notes returns its introduction. Introductions are notes: pass that reference to th_get_notes, for example "JHN 1:intro" or "JHN front:intro". Optional Bible format is "text" (default) or "usfm".
Open Bible Stories: "OBS 3:5", "OBS 3", "OBS 3:1-3", a bare "3:5" or "3", or "OBS front" for the front matter.

Tools on this server:
th_get_passage — text of a Bible passage (literal, simplified and original versions) or an OBS frame.
th_get_passage_index — what a passage, chapter or whole book has, without bodies. Each row names the call that fetches it. A whole book pages notes and words (default 50) and key terms (100 at a time).
th_get_notes — note bodies for a passage, an introduction or a book. kind is "translation" (the default) or "study".
th_get_questions — comprehension questions. kind is "translation" (the default) or "study". The Bible has translation questions only. OBS study questions are OBS-SQ.
th_list_resources — the languages, or what one language has.`;
