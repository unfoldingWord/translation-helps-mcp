/**
 * MCP Tools Registry
 * Single source of truth for all MCP tool definitions
 *
 * This module exports the tools array that is used by:
 * 1. The MCP server (src/index.ts) - for stdio transport
 * 2. The HTTP MCP endpoint (ui/src/routes/api/mcp/+server.ts) - for HTTP transport
 *
 * This ensures DRY compliance - tool definitions are maintained in one place.
 */

import { z } from "zod";
import { FetchScriptureArgs } from "../tools/fetchScripture.js";
import { FetchTranslationNotesArgs } from "../tools/fetchTranslationNotes.js";
import { FetchTranslationQuestionsArgs } from "../tools/fetchTranslationQuestions.js";
import { FetchTranslationWordLinksArgs } from "../tools/fetchTranslationWordLinks.js";
import { FetchTranslationAcademyArgs } from "../tools/fetchTranslationAcademy.js";
import { GetTranslationWordArgs } from "../tools/getTranslationWord.js";
import { ListLanguagesArgs } from "../tools/listLanguages.js";
import { ListSubjectsArgs } from "../tools/listSubjects.js";
import { ListResourcesForLanguageArgs } from "../tools/listResourcesForLanguage.js";

/**
 * Explains the `reference` tool argument: models must send a full passage, not a book code alone.
 * Kept in one place so all fetch tools stay consistent in MCP/JSON-Schema.
 */
const REFERENCE_INPUT_DESCRIPTION =
  "REQUIRED. Pass the whole passage as ONE string here — do NOT split it into separate book/chapter/verse fields. " +
  "Format: book + chapter:verse (or verse range, or a whole chapter). The book may be a USFM 3-letter code (JHN), " +
  "a full English title (John, Genesis), or the title in the request language (Juan, Génesis with language: es). " +
  "A bare book code with no chapter/verse (e.g. only 'JHN') is NOT a valid reference. " +
  'Valid examples: "John 3:16", "JHN 3:16", "Juan 3:16" (language: es), "GEN 1:1-3", "MAT 5" (entire chapter), "1 Corinthians 13:4-7". ' +
  'Full/localized book names and multi-digit chapters (e.g. "Mark 10:25") are accepted.';

/**
 * Tolerated-argument fields advertised on the input schemas (issue #24).
 *
 * The server normalizes these to the canonical fields in
 * `UnifiedMCPHandler.normalizeArgs()` before validation. They are advertised
 * here — optional, plus `.passthrough()` on each tool so the generated JSON
 * Schema does NOT set `additionalProperties: false` — so schema-aware MCP
 * clients are not blocked from sending the exact shapes the server accepts.
 * The canonical fields (`reference`, `path`) remain the documented preference.
 */
const intOrString = () => z.union([z.string(), z.number()]);

/**
 * Language synonyms the handler normalizes to `language` for EVERY tool
 * (issue #24 Class D). Advertised on every tool that takes `language`.
 */
const LANGUAGE_ALIAS_FIELDS = {
  language_code: z
    .string()
    .optional()
    .describe("Alias for `language` (BCP-47 tag)."),
  languageCode: z.string().optional().describe("Alias for `language`."),
  lang: z.string().optional().describe("Alias for `language`."),
};

/**
 * Reference tools: `reference` is the canonical (preferred) field. The
 * decomposed book/chapter/verse fields are a FALLBACK kept only so strict
 * schema-aware clients that already split a passage are still accepted — the
 * server reassembles them into a single `reference` (issue #24). New callers
 * should always send `reference`. `reference` is advertised optional only so
 * the decomposed fallback can satisfy the requirement instead.
 */
const FALLBACK_DECOMPOSED_NOTE =
  "Fallback only — prefer sending the whole passage in `reference`. If present, this is reassembled into a single `reference` server-side.";
const REFERENCE_TOLERANCE_FIELDS = {
  reference: z.string().optional().describe(REFERENCE_INPUT_DESCRIPTION),
  book: z
    .string()
    .optional()
    .describe(
      `Book (USFM code or English/localized name). ${FALLBACK_DECOMPOSED_NOTE}`,
    ),
  chapter: intOrString()
    .optional()
    .describe(`Chapter number. ${FALLBACK_DECOMPOSED_NOTE}`),
  verse: intOrString()
    .optional()
    .describe(`Verse number. ${FALLBACK_DECOMPOSED_NOTE}`),
  endVerse: intOrString()
    .optional()
    .describe(`End verse for a range. ${FALLBACK_DECOMPOSED_NOTE}`),
  ...LANGUAGE_ALIAS_FIELDS,
};

/** Word/Academy tools: the `path` synonyms the server accepts and normalizes. */
const PATH_TOLERANCE_FIELDS = {
  term: z
    .string()
    .optional()
    .describe(
      "Alias for `path` — a plain term/module name resolved across categories.",
    ),
  word: z.string().optional().describe("Alias for `path`."),
  name: z.string().optional().describe("Alias for `path`."),
  article: z.string().optional().describe("Alias for `path`."),
  moduleId: z.string().optional().describe("Alias for `path`."),
  module: z.string().optional().describe("Alias for `path`."),
  identifier: z.string().optional().describe("Alias for `path`."),
  id: z.string().optional().describe("Alias for `path`."),
};

/**
 * MCP Tool Definition
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
}

/**
 * Get all MCP tool definitions
 * This is the single source of truth for tool definitions
 */
export function getMCPToolDefinitions(): MCPToolDefinition[] {
  return [
    {
      name: "fetch_scripture",
      description:
        "Fetch Bible text for a passage: one verse, a verse range, or a whole chapter. " +
        "The required argument is `reference` as a full passage string (book + chapter/verse, not a book code alone). " +
        "Book may be USFM (JHN) or a full/localized title that matches the `language` parameter. " +
        "Examples: JHN 3:16, John 3:16, GEN 1:1-3, MAT 5. Door43 catalog owners are discovered automatically (all-org search).",
      inputSchema: FetchScriptureArgs.omit({ reference: true })
        .extend(REFERENCE_TOLERANCE_FIELDS)
        .passthrough(),
    },
    {
      name: "fetch_translation_notes",
      description:
        "Fetch translator notes explaining difficult passages, cultural context, and translation recommendations. " +
        "Returns verseNotes (verse-specific) and contextNotes (book/chapter background) separately. " +
        "Pass `reference` as a full passage (book + chapter/verse or range), not a standalone book code. " +
        "USFM or localized book names are fine when they match `language`. All Door43 organizations are searched automatically.",
      inputSchema: FetchTranslationNotesArgs.omit({ reference: true })
        .extend(REFERENCE_TOLERANCE_FIELDS)
        .passthrough(),
    },
    {
      name: "fetch_translation_questions",
      description:
        "Fetch comprehension questions with answers to verify translation accuracy. " +
        "Pass `reference` as a full passage (book + chapter/verse or range), not a book code by itself. " +
        "All Door43 organizations are searched automatically.",
      inputSchema: FetchTranslationQuestionsArgs.omit({ reference: true })
        .extend(REFERENCE_TOLERANCE_FIELDS)
        .passthrough(),
    },
    {
      name: "fetch_translation_word_links",
      description:
        "Fetch key biblical terms in a passage (e.g. grace, faith) with links to term articles. " +
        "Pass `reference` as a full passage (book + chapter/verse or range), not a book code by itself. " +
        "All Door43 organizations are searched automatically.",
      inputSchema: FetchTranslationWordLinksArgs.omit({ reference: true })
        .extend(REFERENCE_TOLERANCE_FIELDS)
        .passthrough(),
    },
    {
      name: "fetch_translation_word",
      description:
        "Fetch the dictionary article for a biblical term (e.g. grace, love, Abraham, covenant). " +
        'Identify the term with `path` — preferably the value from `externalReference` in a fetch_translation_word_links response (e.g. "bible/kt/love") — ' +
        'but a plain term name also works: send `path: "love"`, or `term`/`word: "love"` and it is resolved across all categories (kt/names/other). ' +
        "`<synonym>_id`/`<synonym>Id` forms (e.g. `word_id`, `wordId`) are also accepted, but `path` is preferred. " +
        "No file extensions.",
      inputSchema: GetTranslationWordArgs.extend({
        ...PATH_TOLERANCE_FIELDS,
        ...LANGUAGE_ALIAS_FIELDS,
      }).passthrough(),
    },
    {
      name: "fetch_translation_academy",
      description:
        "Fetch Translation Academy training articles teaching translation principles, methods, and techniques. " +
        'Identify the article with `path` — preferably the value from `externalReference` in a fetch_translation_notes response (e.g. "translate/figs-metaphor") — ' +
        'but a plain module id also works: send `path: "figs-metaphor"`, or `term`/`moduleId: "figs-metaphor"` and it is resolved across categories. ' +
        "`<synonym>_id`/`<synonym>Id` forms (e.g. `article_id`, `articleId`) are also accepted, but `path` is preferred. " +
        "No file extensions.",
      inputSchema: FetchTranslationAcademyArgs.extend({
        ...PATH_TOLERANCE_FIELDS,
        ...LANGUAGE_ALIAS_FIELDS,
      }).passthrough(),
    },
    {
      name: "list_tools",
      description:
        "List all available MCP tools with their schemas and descriptions. Use this to discover what translation helps tools are available.",
      // passthrough so additionalProperties is not false (the handler tolerates extra args on every tool)
      inputSchema: z
        .object({})
        .passthrough()
        .describe("No parameters required"),
    },
    {
      name: "list_languages",
      description:
        "List available Bible translation languages with codes and names. All Door43 organizations are searched automatically.",
      inputSchema: ListLanguagesArgs.passthrough(),
    },
    {
      name: "list_subjects",
      description:
        "List available resource types (Bibles, notes, questions, terms, training) to discover what translation helps exist.",
      inputSchema: ListSubjectsArgs.extend(LANGUAGE_ALIAS_FIELDS).passthrough(),
    },
    {
      name: "list_resources_for_language",
      description:
        "List all translation resources for a specific language organized by type. Automatically falls back to language variants if base language has no resources (e.g., 'es' → 'es-419'). Recommended workflow: 1) list_languages to find codes, 2) this tool to see available resources, 3) fetch tools to get content.",
      // `language` is required by the handler, but `language_code`/`languageCode`/`lang`
      // are normalized to it first — so advertise it as optional with the aliases.
      inputSchema: ListResourcesForLanguageArgs.partial({ language: true })
        .extend(LANGUAGE_ALIAS_FIELDS)
        .passthrough(),
    },
  ];
}
