/**
 * Server instructions for /v3/mcp. Read once.
 * No assistant persona. The language rule and the two reference forms
 * are stated here, not repeated inside every tool.
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

Language: pass the BCP-47 code the user asked for, such as "es" or "es-419". Use "en" only when they did not name a language.

References have two forms.
Bible: "JHN 3:16", "John 3", "GEN 1", or a whole book such as "Jonah". A book alone is not a passage. Introductions are "JHN 1:intro" or "JHN front:intro".
Open Bible Stories: "OBS 3:5", "OBS 3", "OBS 3:1-3", a bare "3:5" or "3", or "OBS front".

Which tool:
th_get_passage — the text of a passage.
th_get_passage_index — what a passage, chapter or book has, without bodies.
th_get_notes — note bodies and introductions.
th_get_questions — comprehension questions.
th_get_article — a term or a translation concept. A term is enough.
th_search — no passage: find an article by concept. Notes search across books comes later.
th_list_resources — what a language has, or the language list when language is omitted.

How to read an answer: follow next. candidates means more than one match, so pick one or ask. available: false means the resource does not exist, and that is not an error.

When the data is not there, say so. Do not answer from memory.`;
