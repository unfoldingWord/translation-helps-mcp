/**
 * Placeholder instructions for /v3/mcp.
 * T-053 replaces this with the finished workflow text.
 * No assistant persona. The language rule and the two reference forms
 * are stated once, here, not repeated inside every tool.
 */

export const V3_SERVER_INSTRUCTIONS = `Translation Helps serves unfoldingWord and Door43 resources used to translate the Bible.

Language: pass the BCP-47 code the user asked for, such as "es" or "es-419". Use "en" only when they did not name a language. Call list_resources with no language to see the codes.

References have two forms.
Bible: a book with a chapter or verse, such as "JHN 3:16", "John 3", "GEN 1" or "JON 1". A book alone, such as "Jonah", is not a passage. Introductions use "JHN front:intro" or "JHN 1:intro".
Open Bible Stories: "OBS 3:5", "OBS 3", "OBS 3:1-3", a bare "3:5" or "3", or "OBS front" for the front matter.

Tools on this server:
get_passage — text of a Bible passage (literal, simplified and original versions) or an OBS frame.
get_questions — comprehension questions. kind is "translation" (the default) or "study". The Bible has translation questions only. OBS study questions are OBS-SQ.
list_resources — the languages, or what one language has.`;
