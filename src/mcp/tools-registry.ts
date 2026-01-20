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
      description: "Fetch Bible scripture text for a specific reference",
      inputSchema: FetchScriptureArgs.omit({ reference: true }).extend({
        reference: z
          .string()
          .describe(
            'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")',
          ),
      }),
    },
    {
      name: "fetch_translation_notes",
      description: "Fetch translation notes for a specific Bible reference",
      inputSchema: FetchTranslationNotesArgs.omit({ reference: true }).extend({
        reference: z
          .string()
          .describe(
            'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")',
          ),
      }),
    },
    {
      name: "fetch_translation_questions",
      description: "Fetch translation questions for a specific Bible reference",
      inputSchema: FetchTranslationQuestionsArgs.omit({
        reference: true,
      }).extend({
        reference: z
          .string()
          .describe(
            'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")',
          ),
      }),
    },
    {
      name: "fetch_translation_word_links",
      description:
        "Fetch translation word links (TWL) for a specific Bible reference",
      inputSchema: FetchTranslationWordLinksArgs.omit({
        reference: true,
      }).extend({
        reference: z
          .string()
          .describe(
            'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")',
          ),
      }),
    },
    {
      name: "fetch_translation_word",
      description:
        "Fetch translation word articles for biblical terms. Can search by term name (e.g., 'grace', 'paul', 'god', 'faith'), path, rcLink, or Bible reference. Use term parameter for questions like 'Who is Paul?' or 'What is grace?'",
      inputSchema: GetTranslationWordArgs,
    },
    {
      name: "fetch_translation_academy",
      description:
        "Fetch translation academy (tA) modules and training content",
      inputSchema: FetchTranslationAcademyArgs,
    },
    {
      name: "list_languages",
      description:
        "List all available languages from the Door43 catalog. Returns structured language data (codes, names, display names) that can be directly reused as language parameters in other tools. Optionally filter by organization.",
      inputSchema: ListLanguagesArgs,
    },
    {
      name: "list_subjects",
      description:
        "List all available resource subjects (resource types) from the Door43 catalog. Returns structured subject data (names, descriptions, resource types) that can be used to discover what resource types are available. Optionally filter by language and/or organization.",
      inputSchema: ListSubjectsArgs,
    },
    {
      name: "list_resources_for_language",
      description:
        "RECOMMENDED: List all available resources for a specific language. Fast single API call (~1-2 seconds). Given a language code (e.g., 'en', 'fr', 'es-419'), returns all resources available in that language organized by subject/resource type. Suggested workflow: 1) Use list_languages to discover available languages (~1s), 2) Use this tool to see what resources exist for a chosen language (~1-2s), 3) Use specific fetch tools to get the actual content.",
      inputSchema: ListResourcesForLanguageArgs,
    },
  ];
}
