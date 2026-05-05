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
  "Full Bible passage in one string: the book (USFM 3-letter code like JHN, or the book title in English or the request language, e.g. John, Juan, Génesis) plus chapter and verse or verse range, or a whole chapter. " +
  "This is not only a book code — a bare code with no chapter/verse (e.g. only 'JHN') is wrong. " +
  'Valid examples: "JHN 3:16", "John 3:16", "Juan 3:16" (use language: es), "GEN 1:1-3", "MAT 5" (entire chapter).';

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
      inputSchema: FetchScriptureArgs.omit({ reference: true }).extend({
        reference: z.string().describe(REFERENCE_INPUT_DESCRIPTION),
      }),
    },
    {
      name: "fetch_translation_notes",
      description:
        "Fetch translator notes explaining difficult passages, cultural context, and translation recommendations. " +
        "Returns verseNotes (verse-specific) and contextNotes (book/chapter background) separately. " +
        "Pass `reference` as a full passage (book + chapter/verse or range), not a standalone book code. " +
        "USFM or localized book names are fine when they match `language`. All Door43 organizations are searched automatically.",
      inputSchema: FetchTranslationNotesArgs.omit({ reference: true }).extend({
        reference: z.string().describe(REFERENCE_INPUT_DESCRIPTION),
      }),
    },
    {
      name: "fetch_translation_questions",
      description:
        "Fetch comprehension questions with answers to verify translation accuracy. " +
        "Pass `reference` as a full passage (book + chapter/verse or range), not a book code by itself. " +
        "All Door43 organizations are searched automatically.",
      inputSchema: FetchTranslationQuestionsArgs.omit({
        reference: true,
      }).extend({
        reference: z.string().describe(REFERENCE_INPUT_DESCRIPTION),
      }),
    },
    {
      name: "fetch_translation_word_links",
      description:
        "Fetch key biblical terms in a passage (e.g. grace, faith) with links to term articles. " +
        "Pass `reference` as a full passage (book + chapter/verse or range), not a book code by itself. " +
        "All Door43 organizations are searched automatically.",
      inputSchema: FetchTranslationWordLinksArgs.omit({
        reference: true,
      }).extend({
        reference: z.string().describe(REFERENCE_INPUT_DESCRIPTION),
      }),
    },
    {
      name: "fetch_translation_word",
      description:
        "Fetch dictionary entries for biblical terms by name (e.g., 'grace', 'paul', 'covenant'), path, or Bible reference.",
      inputSchema: GetTranslationWordArgs,
    },
    {
      name: "fetch_translation_academy",
      description:
        "Fetch Translation Academy training articles teaching translation principles, methods, and techniques.",
      inputSchema: FetchTranslationAcademyArgs,
    },
    {
      name: "list_tools",
      description:
        "List all available MCP tools with their schemas and descriptions. Use this to discover what translation helps tools are available.",
      inputSchema: z.object({}).describe("No parameters required"),
    },
    {
      name: "list_languages",
      description:
        "List available Bible translation languages with codes and names. All Door43 organizations are searched automatically.",
      inputSchema: ListLanguagesArgs,
    },
    {
      name: "list_subjects",
      description:
        "List available resource types (Bibles, notes, questions, terms, training) to discover what translation helps exist.",
      inputSchema: ListSubjectsArgs,
    },
    {
      name: "list_resources_for_language",
      description:
        "List all translation resources for a specific language organized by type. Automatically falls back to language variants if base language has no resources (e.g., 'es' → 'es-419'). Recommended workflow: 1) list_languages to find codes, 2) this tool to see available resources, 3) fetch tools to get content.",
      inputSchema: ListResourcesForLanguageArgs,
    },
  ];
}
