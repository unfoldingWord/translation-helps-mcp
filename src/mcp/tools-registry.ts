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
      description:
        "Fetch Bible text for specific verses, passages, or chapters. CRITICAL: Always use standard 3-letter book codes (e.g., GEN=Genesis, EXO=Exodus, JHN=John, 3JN=3 John, TIT=Titus). NEVER use full book names or names in other languages - convert them to 3-letter codes first. Examples: 'JHN 3:16', 'GEN 1:1-3', 'MAT 5', 'TIT 1:15'.",
      inputSchema: FetchScriptureArgs.omit({ reference: true }).extend({
        reference: z
          .string()
          .describe(
            'Bible reference using standard 3-letter book code (GEN, EXO, LEV, NUM, DEU, JOS, JDG, RUT, 1SA, 2SA, 1KI, 2KI, 1CH, 2CH, EZR, NEH, EST, JOB, PSA, PRO, ECC, SNG, ISA, JER, LAM, EZK, DAN, HOS, JOL, AMO, OBA, JON, MIC, NAM, HAB, ZEP, HAG, ZEC, MAL, MAT, MRK, LUK, JHN, ACT, ROM, 1CO, 2CO, GAL, EPH, PHP, COL, 1TH, 2TH, 1TI, 2TI, TIT, PHM, HEB, JAS, 1PE, 2PE, 1JN, 2JN, 3JN, JUD, REV). Examples: "JHN 3:16", "GEN 1:1-3", "TIT 1:15"',
          ),
      }),
    },
    {
      name: "fetch_translation_notes",
      description:
        "Fetch translator notes explaining difficult passages, cultural context, and translation recommendations. Returns verseNotes (verse-specific) and contextNotes (book/chapter background) separately. CRITICAL: Always use standard 3-letter book codes (TIT=Titus, JHN=John, etc.). NEVER use full book names or names in other languages.",
      inputSchema: FetchTranslationNotesArgs.omit({ reference: true }).extend({
        reference: z
          .string()
          .describe(
            'Bible reference using standard 3-letter book code. Examples: "JHN 3:16", "TIT 1:15", "GEN 1:1-3"',
          ),
      }),
    },
    {
      name: "fetch_translation_questions",
      description:
        "Fetch comprehension questions with answers to verify translation accuracy. CRITICAL: Always use standard 3-letter book codes (TIT=Titus, JHN=John, etc.). NEVER use full book names or names in other languages.",
      inputSchema: FetchTranslationQuestionsArgs.omit({
        reference: true,
      }).extend({
        reference: z
          .string()
          .describe(
            'Bible reference using standard 3-letter book code. Examples: "JHN 3:16", "TIT 1:15", "GEN 1:1-3"',
          ),
      }),
    },
    {
      name: "fetch_translation_word_links",
      description:
        "Fetch list of key biblical terms found in a passage (like 'grace', 'faith', 'covenant') with links to definitions. CRITICAL: Always use standard 3-letter book codes (TIT=Titus, JHN=John, etc.). NEVER use full book names or names in other languages.",
      inputSchema: FetchTranslationWordLinksArgs.omit({
        reference: true,
      }).extend({
        reference: z
          .string()
          .describe(
            'Bible reference using standard 3-letter book code. Examples: "JHN 3:16", "TIT 1:15", "GEN 1:1-3"',
          ),
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
        "List available Bible translation languages with codes and names. Optionally filter by organization.",
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
