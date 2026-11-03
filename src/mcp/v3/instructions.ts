/**
 * Server instructions for /v3/mcp. Read once, when a client passes them on.
 * No assistant persona. The language rule is also on each tool's language
 * parameter, because many clients never show these instructions to the model.
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

export const V3_SERVER_INSTRUCTIONS = `Translation Helps serves the unfoldingWord translation helps for Bible translators, from Door43, in many gateway languages: Bible text, translation notes and questions, Translation Words and Translation Academy articles, and Open Bible Stories with its helps.

Language: use the language of the resources the user wants, usually the one they write in ("es-419", "hi"). Do not fall back to "en" when they asked for another language.

References: Bible "JHN 3:16", "John 3", a whole book "Jonah", introductions "JHN 1:intro" or "JHN front:intro". Open Bible Stories "OBS 3:5", "OBS 3:1-3", "OBS 3".

Which tool:
th_get_passage — the text of a passage.
th_get_passage_index — what a passage, chapter or book has, without bodies.
th_get_notes — note bodies and introductions.
th_get_questions — comprehension questions.
th_get_article — a term or a translation concept. A term is enough.
th_search — no passage: find an article by concept.
th_list_resources — what a language has, or the language list when language is omitted.

Reading an answer:
- next is the call that fetches the body: the tool and the arguments, to use as given;
- candidates means more than one match: pick one or ask;
- available: false means the resource does not exist for that language or book: say so;
- isError means the call failed: you may try again.

Say which resource an answer comes from (for example ULT, or the translation notes). When the data is not there, say so; do not answer from memory.`;
