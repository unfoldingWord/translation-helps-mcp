#!/usr/bin/env node

/**
 * Translation Helps MCP Server
 * Model Context Protocol server for Bible translation resources
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Import tool handlers with updated names
import {
  FetchScriptureArgs,
  handleFetchScripture,
} from "./tools/fetchScripture.js";
import {
  FetchTranslationNotesArgs,
  handleFetchTranslationNotes,
} from "./tools/fetchTranslationNotes.js";
import {
  FetchTranslationQuestionsArgs,
  handleFetchTranslationQuestions,
} from "./tools/fetchTranslationQuestions.js";
import {
  FetchTranslationWordLinksArgs,
  handleFetchTranslationWordLinks,
} from "./tools/fetchTranslationWordLinks.js";
import {
  FetchTranslationAcademyArgs,
  handleFetchTranslationAcademy,
} from "./tools/fetchTranslationAcademy.js";
import {
  GetTranslationWordArgs,
  handleGetTranslationWord,
} from "./tools/getTranslationWord.js";
import {
  SearchTranslationWordAcrossLanguagesArgs,
  handleSearchTranslationWordAcrossLanguages,
} from "./tools/searchTranslationWordAcrossLanguages.js";
import {
  ListLanguagesArgs,
  handleListLanguages,
} from "./tools/listLanguages.js";
import { ListSubjectsArgs, handleListSubjects } from "./tools/listSubjects.js";
import {
  ListResourcesByLanguageArgs,
  handleListResourcesByLanguage,
} from "./tools/listResourcesByLanguage.js";
import {
  ListResourcesForLanguageArgs,
  handleListResourcesForLanguage,
} from "./tools/listResourcesForLanguage.js";
import { logger } from "./utils/logger.js";
import { getVersion } from "./version.js";

// Tool definitions
const tools = [
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
    inputSchema: FetchTranslationQuestionsArgs.omit({ reference: true }).extend(
      {
        reference: z
          .string()
          .describe(
            'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")',
          ),
      },
    ),
  },
  {
    name: "fetch_translation_word_links",
    description:
      "Fetch translation word links (TWL) for a specific Bible reference",
    inputSchema: FetchTranslationWordLinksArgs.omit({ reference: true }).extend(
      {
        reference: z
          .string()
          .describe(
            'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")',
          ),
      },
    ),
  },
  {
    name: "fetch_translation_word",
    description:
      "Fetch translation word articles for biblical terms. Can search by term name (e.g., 'grace', 'paul', 'god', 'faith'), path, rcLink, or Bible reference. Use term parameter for questions like 'Who is Paul?' or 'What is grace?'",
    inputSchema: GetTranslationWordArgs,
  },
  {
    name: "fetch_translation_academy",
    description: "Fetch translation academy (tA) modules and training content",
    inputSchema: FetchTranslationAcademyArgs,
  },
  {
    name: "search_translation_word_across_languages",
    description:
      "Search for a translation word term across multiple languages to discover which languages have that term available. Useful when a term is not found in the current language or when you want to find all languages that have a specific term.",
    inputSchema: SearchTranslationWordAcrossLanguagesArgs,
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
    name: "list_resources_by_language",
    description:
      "List available resources organized by language. Searches across multiple subjects (7 default) and returns results grouped by language. NOTE: This makes multiple parallel API calls and takes ~4-5 seconds on first call (cached afterward). For faster discovery, consider using list_languages followed by list_resources_for_language for specific languages instead.",
    inputSchema: ListResourcesByLanguageArgs,
  },
  {
    name: "list_resources_for_language",
    description:
      "RECOMMENDED: List all available resources for a specific language. Fast single API call (~1-2 seconds). Given a language code (e.g., 'en', 'fr', 'es-419'), returns all resources available in that language organized by subject/resource type. Suggested workflow: 1) Use list_languages to discover available languages (~1s), 2) Use this tool to see what resources exist for a chosen language (~1-2s), 3) Use specific fetch tools to get the actual content.",
    inputSchema: ListResourcesForLanguageArgs,
  },
];

// Prompt definitions
const prompts = [
  {
    name: "translation-helps-for-passage",
    description:
      "Get comprehensive translation help for a Bible passage: scripture text, questions, word definitions (with titles), notes, and related academy articles",
    arguments: [
      {
        name: "reference",
        description: 'Bible reference (e.g., "John 3:16", "Genesis 1:1-3")',
        required: true,
      },
      {
        name: "language",
        description: 'Language code (default: "en")',
        required: false,
      },
    ],
  },
  {
    name: "get-translation-words-for-passage",
    description:
      "Get all translation word definitions for a passage, showing dictionary entry titles (not technical term IDs)",
    arguments: [
      {
        name: "reference",
        description: 'Bible reference (e.g., "John 3:16")',
        required: true,
      },
      {
        name: "language",
        description: 'Language code (default: "en")',
        required: false,
      },
    ],
  },
  {
    name: "get-translation-academy-for-passage",
    description:
      "Get Translation Academy training articles referenced in the translation notes for a passage",
    arguments: [
      {
        name: "reference",
        description: 'Bible reference (e.g., "John 3:16")',
        required: true,
      },
      {
        name: "language",
        description: 'Language code (default: "en")',
        required: false,
      },
    ],
  },
  {
    name: "discover-resources-for-language",
    description:
      "Discover what translation resources are available for a specific language. Shows available languages (if not specified), available resource types for that language, and provides example tool calls using the discovered language parameter.",
    arguments: [
      {
        name: "language",
        description:
          'Language code (e.g., "en", "es-419"). If not provided, will show all available languages first.',
        required: false,
      },
      {
        name: "organization",
        description: 'Organization (default: "unfoldingWord")',
        required: false,
      },
    ],
  },
  {
    name: "discover-languages-for-subject",
    description:
      "Discover which languages have a specific resource type (subject) available. Shows available subjects (if not specified), then lists languages that have that resource type, and provides example tool calls using the discovered languages.",
    arguments: [
      {
        name: "subject",
        description:
          'Resource subject/type (e.g., "Translation Words", "Translation Notes"). If not provided, will show all available subjects first.',
        required: false,
      },
      {
        name: "organization",
        description: 'Organization (default: "unfoldingWord")',
        required: false,
      },
    ],
  },
];

// Create server
const server = new Server(
  {
    name: "translation-helps-mcp",
    version: getVersion(),
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  },
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema, { $refStrategy: "none" }),
    })),
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "fetch_scripture":
        return await handleFetchScripture(
          args as z.infer<typeof FetchScriptureArgs>,
        );

      case "fetch_translation_notes":
        return await handleFetchTranslationNotes(
          args as z.infer<typeof FetchTranslationNotesArgs>,
        );

      case "fetch_translation_questions":
        return await handleFetchTranslationQuestions(
          args as z.infer<typeof FetchTranslationQuestionsArgs>,
        );

      case "fetch_translation_word_links":
        return await handleFetchTranslationWordLinks(
          args as z.infer<typeof FetchTranslationWordLinksArgs>,
        );

      case "fetch_translation_word":
        return await handleGetTranslationWord(
          args as z.infer<typeof GetTranslationWordArgs>,
        );

      case "fetch_translation_academy":
        return await handleFetchTranslationAcademy(
          args as z.infer<typeof FetchTranslationAcademyArgs>,
        );

      case "search_translation_word_across_languages":
        return await handleSearchTranslationWordAcrossLanguages(
          args as z.infer<typeof SearchTranslationWordAcrossLanguagesArgs>,
        );

      case "list_languages":
        return await handleListLanguages(
          args as z.infer<typeof ListLanguagesArgs>,
        );

      case "list_subjects":
        return await handleListSubjects(
          args as z.infer<typeof ListSubjectsArgs>,
        );

      case "list_resources_by_language":
        return await handleListResourcesByLanguage(
          args as z.infer<typeof ListResourcesByLanguageArgs>,
        );

      case "list_resources_for_language":
        return await handleListResourcesForLanguage(
          args as z.infer<typeof ListResourcesForLanguageArgs>,
        );

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

// List prompts handler
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  };
});

// Get prompt handler
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const prompt = prompts.find((p) => p.name === name);
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }

  const language = (args?.language as string) || "en";
  const reference = (args?.reference as string) || "";
  const organization = (args?.organization as string) || "unfoldingWord";
  const subject = (args?.subject as string) || "";

  switch (name) {
    case "translation-helps-for-passage":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please provide comprehensive translation help for ${reference} in ${language}.

Follow these steps to gather all relevant information:

1. **Get the Scripture Text:**
   - Use fetch_scripture tool with reference="${reference}" and language="${language}"
   - This provides the actual Bible text to work with

2. **Get Translation Questions:**
   - Use fetch_translation_questions with reference="${reference}" and language="${language}"
   - These help check comprehension and guide translation decisions

3. **Get Translation Word Links and Fetch Titles:**
   - Use fetch_translation_word_links with reference="${reference}" and language="${language}"
   - This returns a list of terms (e.g., [{term: "love", category: "kt", path: "..."}])
   - For EACH term in the response, use fetch_translation_word tool with term=<term_value> to get the full article
   - Extract the TITLE from each article (found in the first H1 heading or title field)
   - Show the user these dictionary entry TITLES, not the technical term IDs
   - Example: Show "Love, Beloved" not "love"; show "Son of God, Son" not "sonofgod"

4. **Get Translation Notes:**
   - Use fetch_translation_notes with reference="${reference}" and language="${language}"
   - Notes contain supportReference fields that link to Translation Academy articles

5. **Get Related Translation Academy Articles:**
   - From the translation notes response, extract all supportReference values
   - These are RC links like "rc://*/ta/man/translate/figs-metaphor"
   - For each supportReference, use fetch_translation_academy tool with rcLink=<supportReference_value>
   - Extract the TITLE from each academy article
   - Show these training article titles to help the user understand translation concepts

6. **Organize the Response:**
   Present everything in a clear, structured way:
   - Scripture text at the top
   - List of translation word titles (dictionary entries)
   - Translation questions for comprehension
   - Translation notes with guidance
   - Related academy article titles for deeper learning

The goal is to provide EVERYTHING a translator needs for this passage in one comprehensive response.`,
            },
          },
        ],
      };

    case "get-translation-words-for-passage":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please show me all the translation word definitions for ${reference} in ${language}.

Follow these steps:

1. **Get Translation Word Links:**
   - Use fetch_translation_word_links with reference="${reference}" and language="${language}"
   - This returns links like: [{term: "love", category: "kt", ...}, {term: "god", ...}]

2. **Fetch Full Articles and Extract Titles:**
   - For EACH term in the links result, call fetch_translation_word with term=<term_value>
   - From each article response, extract the TITLE (not the term ID)
   - The title is usually in the first H1 heading or a dedicated title field
   - Example: The term "love" might have title "Love, Beloved"
   - Example: The term "sonofgod" might have title "Son of God, Son"

3. **Present to User:**
   - Show the dictionary entry TITLES in a clear list
   - These are human-readable names, not technical IDs
   - Optionally group by category (Key Terms, Names, Other Terms)
   - Let the user know they can ask for the full definition of any term

Focus on making the translation words accessible by showing their proper titles.`,
            },
          },
        ],
      };

    case "get-translation-academy-for-passage":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please find all the Translation Academy training articles related to ${reference} in ${language}.

Follow these steps:

1. **Get Translation Notes:**
   - Use fetch_translation_notes with reference="${reference}" and language="${language}"
   - Translation notes contain supportReference fields that link to academy articles

2. **Extract Support References:**
   - From the notes response, find all supportReference values
   - These are RC links in format: "rc://*/ta/man/translate/figs-metaphor"
   - Or they might be moduleIds like: "figs-metaphor", "translate-names"
   - Collect all unique support references

3. **Fetch Academy Articles:**
   - For each supportReference, use fetch_translation_academy tool
   - If it's an RC link: use rcLink=<supportReference_value>
   - If it's a moduleId: use moduleId=<supportReference_value>
   - Each call returns an academy article with training content

4. **Extract Titles:**
   - From each academy article response, extract the TITLE
   - The title is in the first H1 heading or dedicated title field

5. **Present to User:**
   - Show the academy article titles
   - Brief description of what each article teaches
   - Let the user know they can request the full content of any article
   
The goal is to show what translation concepts and training materials are relevant to understanding this passage.`,
            },
          },
        ],
      };

    case "discover-resources-for-language":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Help the user discover what translation resources are available for ${language ? `language "${language}"` : "a language"}.

Follow these steps:

1. **List Available Languages (if language not specified):**
   - If no language was provided, first use list_languages tool with organization="${organization}"
   - Show the user the available languages with their codes and names
   - Ask the user to select a language, or proceed with the most common one (usually "en")

2. **List Available Subjects for the Language:**
   - Use list_subjects tool with language="${language || "en"}" and organization="${organization}"
   - This shows what resource types (subjects) are available for this language
   - Common subjects include: "Translation Words", "TSV Translation Notes", "TSV Translation Questions", "Bible", "Aligned Bible", etc.

3. **Present Discovery Results:**
   - Show the user:
     * The selected language: ${language || "[to be selected]"}
     * Available resource types (subjects) for that language
     * A summary of what resources are available

4. **Provide Example Tool Calls:**
   - Show the user how to use the discovered language parameter in other tools
   - Examples:
     * fetch_scripture with language="${language || "en"}" and reference="John 3:16"
     * fetch_translation_notes with language="${language || "en"}" and reference="John 3:16"
     * fetch_translation_word with language="${language || "en"}" and term="love"
     * list_subjects with language="${language || "en"}" to see what's available

5. **Guide Next Steps:**
   - Explain that the user can now use any of the available tools with the discovered language parameter
   - Suggest which tools might be most useful based on the available subjects

The goal is to help users discover what's available and show them how to use that information in subsequent tool calls.`,
            },
          },
        ],
      };

    case "discover-languages-for-subject":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Help the user discover which languages have the resource type "${subject || "[subject to be selected]"}" available.

Follow these steps:

1. **List Available Subjects (if subject not specified):**
   - If no subject was provided, first use list_subjects tool with organization="${organization}"
   - Show the user the available resource types (subjects)
   - Common subjects include: "Translation Words", "TSV Translation Notes", "TSV Translation Questions", "Bible", "Aligned Bible", "Translation Word Links", "Translation Academy"
   - Ask the user to select a subject, or proceed with a common one like "Translation Words"

2. **Discover Languages with This Subject:**
   - For the selected subject "${subject || "[to be selected]"}":
     * Use list_subjects with organization="${organization}" to get all subjects
     * Then, for each language you want to check, use list_subjects with language=<language_code> and organization="${organization}"
     * OR use catalog search to find which languages have resources with this subject
   - Alternatively, you can use list_languages to get all languages, then check each one
   - The goal is to find which languages have the subject "${subject || "[selected subject]"}" available

3. **Present Discovery Results:**
   - Show the user:
     * The selected subject: ${subject || "[to be selected]"}
     * List of languages that have this resource type available
     * For each language, show the language code and name

4. **Provide Example Tool Calls:**
   - Show the user how to use the discovered languages with the subject
   - Examples for "Translation Words" subject:
     * fetch_translation_word with language="en" and term="love"
     * fetch_translation_word with language="es-419" and term="amor"
   - Examples for "Translation Notes" subject:
     * fetch_translation_notes with language="en" and reference="John 3:16"
     * fetch_translation_notes with language="es-419" and reference="John 3:16"

5. **Guide Next Steps:**
   - Explain that the user can now use any of the discovered languages with tools that support that resource type
   - Suggest trying the tools with different languages to compare resources

The goal is to help users find which languages have specific resource types available and show them how to use those languages in subsequent tool calls.`,
            },
          },
        ],
      };

    default:
      throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Translation Helps MCP Server running on stdio");
}

main().catch((error) => {
  logger.error("Fatal error in main()", { error: String(error) });
  process.exit(1);
});
