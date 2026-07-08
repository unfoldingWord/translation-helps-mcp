/**
 * SINGLE SOURCE OF TRUTH: Complete Tool Registry
 *
 * This is the ONLY place you need to update when adding a new tool.
 * Everything else (MCP tools, REST endpoints, UI documentation) derives from this.
 *
 * ARCHITECTURE NOTE:
 * Each tool has TWO access patterns:
 *
 * 1. REST Endpoint: /api/[tool-name] (direct HTTP access)
 *    - Individual SvelteKit route files
 *    - Direct JSON responses
 *    - Used by UI and HTTP clients
 *
 * 2. MCP Protocol: /api/mcp (JSON-RPC 2.0 wrapper)
 *    - Single unified endpoint for all MCP protocol methods
 *    - Implements tools/call, tools/list, prompts/list, prompts/get
 *    - Internally delegates to REST endpoints via UnifiedMCPHandler
 *    - Used by Claude Desktop, MCP SDK, MCP Inspector
 *
 * The 'endpoint' field specifies the REST endpoint path.
 * The 'mcpName' field specifies how to call it via /api/mcp (tools/call).
 */

import { PARAMETER_GROUPS } from "./parameters/groups.js";
import type { UnifiedParameterDef } from "./parameters/types.js";

/**
 * Tool Response Formatters
 * These format REST API responses for MCP text output
 */
export const ToolFormatters = {
  scripture: (data: any): string => {
    const scriptureArray = data.scripture || data.scriptures;
    if (scriptureArray && Array.isArray(scriptureArray)) {
      if (scriptureArray.length > 1) {
        return scriptureArray
          .map((s: any) => `${s.translation || "Unknown"}: ${s.text || ""}`)
          .join("\n\n");
      }
      return scriptureArray[0]?.text || "Scripture not found";
    }
    return data.text || data.ult || data.ust || "Scripture not found";
  },

  notes: (data: any): string => {
    let notes: any[] = [];
    const possibleArrays = ["items", "verseNotes", "contextNotes", "notes"];
    for (const field of possibleArrays) {
      if (data[field] && Array.isArray(data[field])) {
        notes = notes.concat(data[field]);
      }
    }
    if (notes.length === 0) return "No translation notes found";

    return notes
      .map((note: any, index: number) => {
        const content =
          note.text || note.note || note.Note || note.content || "";
        const quote = note.quote || note.Quote;
        const _entryLink = note.entryLink || note.link || note.SupportReference;
        // The endpoint attaches externalReference per note; without this
        // declaration the reference below threw at runtime (undeclared).
        const externalReference = note.externalReference;
        let formattedNote = `**${index + 1}.**`;
        if (quote && quote.trim()) {
          formattedNote += ` **${quote}**:`;
        }
        formattedNote += ` ${content}`;
        // Add externalReference guidance when available
        if (externalReference && externalReference.target === "ta") {
          formattedNote += `\n   📚 *Translation Academy: \`${externalReference.path}\`* (use with \`fetch_translation_academy(path="${externalReference.path}")\`)`;
        }
        return formattedNote;
      })
      .join("\n\n");
  },

  questions: (data: any): string => {
    const questions =
      data.items || data.translationQuestions || data.questions || [];
    if (!Array.isArray(questions) || questions.length === 0) {
      return "No translation questions found";
    }
    return questions
      .map((q: any, index: number) => {
        const question = q.question || "";
        const answer = q.response || q.answer || "";
        return `**Q${index + 1}: ${question}**\n\n${answer}`;
      })
      .join("\n\n---\n\n");
  },

  words: (
    data: any,
    externalReference?: { target: string; path: string },
  ): string => {
    // Handle pre-formatted string (from format=md response)
    if (typeof data === "string") return data;

    if (data.items && Array.isArray(data.items)) {
      const links = data.items.map((link: any) => {
        const term = link.term || link.TWLink || "Unknown term";
        const category = link.category ? ` (${link.category})` : "";
        const _entryLink = link.entryLink || link.link || link.rcLink;
        let formatted = `**${term}**${category}`;
        // Add externalReference guidance when available
        if (externalReference && externalReference.target === "tw") {
          formatted += `\n   📖 *Entry: \`${externalReference.path}\`* (use with \`fetch_translation_word(path="${externalReference.path}")\`)`;
        }
        return formatted;
      });
      return links.length > 0
        ? links.join("\n\n")
        : "No translation word links found";
    }
    if (data.words && Array.isArray(data.words)) {
      return (
        data.words
          .map((word: any) => `**${word.term}**\n${word.definition}`)
          .join("\n\n") || "No translation words found"
      );
    }
    if (data.term && data.definition) {
      return `**${data.term}**\n${data.definition}`;
    }
    if (data.title && data.content) {
      return `# ${data.title}\n\n${data.content}`;
    }
    if (data.content) return data.content;
    // Plain markdown body from fetch (UnifiedMCPHandler wraps non-JSON as { text, raw })
    if (data?.raw && typeof data.raw === "string") return data.raw;
    return "No translation words found";
  },

  obsStory: (data: any): string => {
    // Handle pre-formatted string (from format=md response)
    if (typeof data === "string") return data;
    if (data?.frontMatter) return data.frontMatter;

    let output = "";
    if (data?.title) {
      output += `# ${data.story ? `${data.story}. ` : ""}${data.title}\n\n`;
    }
    for (const frame of data?.frames || []) {
      output += `**Frame ${data.story}:${frame.frame}**\n\n`;
      if (frame.imageUrl) output += `![OBS Image](${frame.imageUrl})\n\n`;
      output += `${frame.text}\n\n`;
    }
    if (data?.bibleReference) output += `_${data.bibleReference}_\n`;
    if (data?.raw && typeof data.raw === "string") return data.raw;
    return output.trim() || "No OBS content found";
  },

  academy: (data: any): string => {
    // Handle pre-formatted string (from format=md response)
    if (typeof data === "string") return data;

    if (data.title && data.content) {
      return `# ${data.title}\n\n${data.content}`;
    }
    if (Array.isArray(data)) {
      return data
        .map((article: any) => {
          if (article.title && article.content) {
            return `# ${article.title}\n\n${article.content}`;
          }
          return article.content || article.markdown || "No content";
        })
        .join("\n\n---\n\n");
    }
    if (data.content) return data.content;
    if (data.markdown) return data.markdown;
    if (data?.raw && typeof data.raw === "string") return data.raw;
    return "No translation academy content found";
  },
};

export interface ToolDefinition {
  // Identity
  mcpName: string; // MCP tool name (e.g., "fetch_scripture")
  // Used with /api/mcp endpoint: tools/call { name: "fetch_scripture" }

  displayName: string; // Human-readable name (e.g., "Fetch Scripture")

  endpoint: string; // RELATIVE endpoint path (e.g., "fetch-scripture")
  // Consumers add their own base:
  // - REST: /api/ + fetch-scripture = /api/fetch-scripture
  // - MCP: /api/mcp delegates to REST endpoints
  // - Docs: Can use any base path

  // Documentation
  description: string; // What this tool does
  category: string; // UI category (e.g., "Scripture", "Translation Helps")

  // Parameters
  parameters: UnifiedParameterDef[]; // Parameter definitions
  requiredParams: string[]; // Which params are required

  // Response handling
  formatter: (data: any) => string; // How to format MCP responses (text output)

  // Examples for documentation
  examples: Array<{
    title: string;
    description?: string;
    parameters: Record<string, any>;
    expectedResponse?: string;
  }>;
}

/**
 * Complete registry of all tools
 *
 * ADD NEW TOOLS HERE - this is the ONLY place you need to update!
 */
export const TOOLS_REGISTRY: ToolDefinition[] = [
  // ============================================================
  // SCRIPTURE TOOLS
  // ============================================================
  {
    mcpName: "fetch_scripture",
    displayName: "Fetch Scripture",
    endpoint: "fetch-scripture",
    description:
      "Fetch Bible scripture text for multiple translations (ULT, UST, T4T, UEB). Searches all Door43 orgs for the given language.",
    category: "Scripture",
    parameters: PARAMETER_GROUPS.scripture.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.scripture,
    examples: [
      {
        title: "Single verse",
        parameters: { reference: "John 3:16", language: "en" },
        expectedResponse: "Scripture text for John 3:16",
      },
      {
        title: "Verse range",
        parameters: { reference: "Genesis 1:1-3", language: "en" },
        expectedResponse: "Scripture text for Genesis 1:1-3",
      },
      {
        title: "Specific translation",
        parameters: { reference: "John 3:16", language: "en", resource: "ult" },
        expectedResponse: "ULT scripture for John 3:16",
      },
    ],
  },

  // ============================================================
  // TRANSLATION HELPS
  // ============================================================
  {
    mcpName: "fetch_translation_notes",
    displayName: "Fetch Translation Notes",
    endpoint: "fetch-translation-notes",
    description:
      "Fetch translation notes for a specific Bible reference (verse-by-verse). All Door43 organizations are searched automatically.",
    category: "Translation Helps",
    parameters: PARAMETER_GROUPS.translationNotes.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.notes,
    examples: [
      {
        title: "Notes for a verse",
        parameters: { reference: "John 3:16", language: "en" },
        expectedResponse: "Translation notes for John 3:16",
      },
      {
        title: "Notes with context",
        parameters: {
          reference: "Genesis 1:1",
          language: "en",
          includeContext: true,
        },
        expectedResponse: "Translation notes with surrounding context",
      },
      {
        title: "Spanish notes (all organizations)",
        parameters: { reference: "TIT 3:15", language: "es" },
        expectedResponse: "Spanish TN from whichever org publishes them",
      },
    ],
  },

  {
    mcpName: "fetch_translation_questions",
    displayName: "Fetch Translation Questions",
    endpoint: "fetch-translation-questions",
    description:
      "Fetch translation questions for a specific Bible reference (comprehension verification). All Door43 organizations are searched automatically.",
    category: "Translation Helps",
    parameters: PARAMETER_GROUPS.translationQuestions.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.questions,
    examples: [
      {
        title: "Questions for a verse",
        parameters: { reference: "John 3:16", language: "en" },
        expectedResponse: "Translation questions for John 3:16",
      },
      {
        title: "Spanish questions (all organizations)",
        parameters: { reference: "TIT 3:15", language: "es" },
        expectedResponse: "TQ from whichever org publishes them",
      },
    ],
  },

  {
    mcpName: "fetch_translation_word_links",
    displayName: "Fetch Translation Word Links",
    endpoint: "fetch-translation-word-links",
    description:
      "Fetch translation word links (TWL) for a specific Bible reference (verse words → dictionary entries). All Door43 organizations are searched automatically.",
    category: "Translation Helps",
    parameters: PARAMETER_GROUPS.translationWordLinks.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.words,
    examples: [
      {
        title: "Word links for a verse",
        parameters: { reference: "John 3:16", language: "en" },
        expectedResponse: "Translation word links for John 3:16",
      },
    ],
  },

  {
    mcpName: "fetch_translation_word",
    displayName: "Fetch Translation Word",
    endpoint: "fetch-translation-word",
    description:
      'Fetch translation word articles. Use the path value from externalReference in fetch_translation_word_links output. Path format: "bible/kt/love" (no file extensions).',
    category: "Translation Helps",
    parameters: PARAMETER_GROUPS.translationWord.parameters,
    requiredParams: ["path"],
    formatter: ToolFormatters.words,
    examples: [
      {
        title: "Love (default example)",
        parameters: { path: "bible/kt/love", language: "en" },
        expectedResponse: 'Translation word article for "love, beloved"',
      },
      {
        title: "Believe",
        parameters: { path: "bible/kt/believe", language: "en" },
        expectedResponse: 'Translation word article for "believe, believer"',
      },
      {
        title: "Grace",
        parameters: { path: "bible/kt/grace", language: "en" },
        expectedResponse: 'Translation word article for "grace, gracious"',
      },
    ],
  },

  {
    mcpName: "fetch_translation_academy",
    displayName: "Fetch Translation Academy",
    endpoint: "fetch-translation-academy",
    description:
      'Fetch translation academy modules and training content. Use the path value from externalReference in fetch_translation_notes output. Path format: "translate/figs-metaphor" (no file extensions).',
    category: "Training",
    parameters: PARAMETER_GROUPS.translationAcademy.parameters,
    requiredParams: ["path"],
    formatter: ToolFormatters.academy,
    examples: [
      {
        title: "Metaphor (default example)",
        parameters: { path: "translate/figs-metaphor", language: "en" },
        expectedResponse: "Translation Academy module about metaphors",
      },
      {
        title: "Simile",
        parameters: { path: "translate/figs-simile", language: "en" },
        expectedResponse: "Translation Academy module about similes",
      },
      {
        title: "Active/Passive Voice",
        parameters: { path: "translate/figs-activepassive", language: "en" },
        expectedResponse:
          "Translation Academy module about active and passive voice",
      },
    ],
  },

  // ============================================================
  // OPEN BIBLE STORIES (issue #32)
  // OBS uses story:frame references ("1:1", "1:0" = title, "front",
  // "1:1-8"), NOT the Bible book chapter:verse scheme.
  // ============================================================
  {
    mcpName: "fetch_obs",
    displayName: "Fetch Open Bible Stories",
    endpoint: "fetch-obs",
    description:
      'Fetch Open Bible Stories (OBS) story text: title and illustrated frames. Uses OBS story:frame references ("1:1", "1:0" for a story title, "1" for a whole story, "front" for front matter) — NOT Bible book chapter:verse. All Door43 organizations are searched automatically.',
    category: "Open Bible Stories",
    parameters: PARAMETER_GROUPS.obs.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.obsStory,
    examples: [
      {
        title: "One frame",
        parameters: { reference: "1:1", language: "en" },
        expectedResponse: "Story 1, frame 1: image + paragraph text",
      },
      {
        title: "Story title",
        parameters: { reference: "1:0", language: "en" },
        expectedResponse: 'The title of story 1 ("The Creation")',
      },
      {
        title: "Whole story",
        parameters: { reference: "1", language: "en" },
        expectedResponse: "All 16 frames of story 1",
      },
    ],
  },

  {
    mcpName: "fetch_obs_translation_notes",
    displayName: "Fetch OBS Translation Notes",
    endpoint: "fetch-obs-translation-notes",
    description:
      'Fetch translator notes for an Open Bible Stories reference (story:frame, e.g. "1:1"; "1:0" for a story title). All Door43 organizations are searched automatically.',
    category: "Open Bible Stories",
    parameters: PARAMETER_GROUPS.obs.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.notes,
    examples: [
      {
        title: "Notes for a frame",
        parameters: { reference: "1:1", language: "en" },
        expectedResponse: "OBS translation notes for story 1, frame 1",
      },
    ],
  },

  {
    mcpName: "fetch_obs_translation_questions",
    displayName: "Fetch OBS Translation Questions",
    endpoint: "fetch-obs-translation-questions",
    description:
      'Fetch comprehension questions with answers for an Open Bible Stories reference (story:frame, e.g. "1:1"). All Door43 organizations are searched automatically.',
    category: "Open Bible Stories",
    parameters: PARAMETER_GROUPS.obs.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.questions,
    examples: [
      {
        title: "Questions for a frame",
        parameters: { reference: "1:1", language: "en" },
        expectedResponse: "OBS translation questions for story 1, frame 1",
      },
    ],
  },

  {
    mcpName: "fetch_obs_study_notes",
    displayName: "Fetch OBS Study Notes",
    endpoint: "fetch-obs-study-notes",
    description:
      'Fetch study notes for an Open Bible Stories reference (story:frame, e.g. "1:1"). All Door43 organizations are searched automatically.',
    category: "Open Bible Stories",
    parameters: PARAMETER_GROUPS.obs.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.notes,
    examples: [
      {
        title: "Study notes for a frame",
        parameters: { reference: "1:1", language: "en" },
        expectedResponse: "OBS study notes for story 1, frame 1",
      },
    ],
  },

  {
    mcpName: "fetch_obs_study_questions",
    displayName: "Fetch OBS Study Questions",
    endpoint: "fetch-obs-study-questions",
    description:
      'Fetch study/discussion questions for an Open Bible Stories reference. Rows may cover frame RANGES (e.g. "1:1-8") and front matter ("front"). All Door43 organizations are searched automatically.',
    category: "Open Bible Stories",
    parameters: PARAMETER_GROUPS.obs.parameters,
    requiredParams: ["reference"],
    formatter: ToolFormatters.questions,
    examples: [
      {
        title: "Study questions for a frame",
        parameters: { reference: "1:3", language: "en" },
        expectedResponse:
          "OBS study questions whose frame range covers story 1, frame 3",
      },
    ],
  },

  // ============================================================
  // TEST/MOCKUP TOOLS
  // ============================================================
  {
    mcpName: "test_mockup_tool",
    displayName: "Test Mockup Tool",
    endpoint: "test-mockup-tool",
    description:
      "🧪 Test tool to verify single source of truth is working - this tool does NOT have a real endpoint implementation",
    category: "Testing",
    parameters: PARAMETER_GROUPS.scripture.parameters, // Reuse existing params for testing
    requiredParams: ["reference"],
    formatter: (data: any): string => {
      return `Test Mockup Tool Response:\n${JSON.stringify(data, null, 2)}`;
    },
    examples: [
      {
        title: "Test example",
        parameters: { reference: "John 3:16", language: "en" },
        expectedResponse:
          "This is a mockup tool for testing the single source of truth system",
      },
    ],
  },

  // ============================================================
  // DISCOVERY TOOLS
  // ============================================================
  {
    mcpName: "list_tools",
    displayName: "List Tools",
    endpoint: "list-tools",
    description:
      "List all available MCP tools with their schemas and descriptions",
    category: "Discovery",
    parameters: PARAMETER_GROUPS.listTools.parameters,
    requiredParams: [],
    formatter: (data: any): string => {
      if (data.tools && Array.isArray(data.tools)) {
        return data.tools
          .map(
            (tool: any) =>
              `**${tool.name}**${tool.description ? ` - ${tool.description}` : ""}`,
          )
          .join("\n");
      }
      return JSON.stringify(data, null, 2);
    },
    examples: [
      {
        title: "List all tools",
        parameters: {},
        expectedResponse:
          "List of all available MCP tools with their input schemas",
      },
    ],
  },

  {
    mcpName: "list_languages",
    displayName: "List Languages",
    endpoint: "list-languages",
    description:
      "List all available languages with codes, names, and display names (all Door43 organizations)",
    category: "Discovery",
    parameters: PARAMETER_GROUPS.listLanguages.parameters,
    requiredParams: [],
    formatter: (data: any): string => {
      if (data.languages && Array.isArray(data.languages)) {
        return data.languages
          .map(
            (lang: any) =>
              `**${lang.name}** (${lang.code})${lang.displayName ? ` - ${lang.displayName}` : ""}`,
          )
          .join("\n");
      }
      return JSON.stringify(data, null, 2);
    },
    examples: [
      {
        title: "All languages",
        parameters: {},
        expectedResponse: "List of available languages with codes and names",
      },
    ],
  },

  {
    mcpName: "list_subjects",
    displayName: "List Subjects",
    endpoint: "list-subjects",
    description:
      "List all available resource subjects/types (Bible, Translation Words, etc.) — filter by language; all Door43 orgs searched",
    category: "Discovery",
    parameters: PARAMETER_GROUPS.listSubjects.parameters,
    requiredParams: [],
    formatter: (data: any): string => {
      if (data.subjects && Array.isArray(data.subjects)) {
        return data.subjects
          .map(
            (subject: any) =>
              `**${subject.name}**${subject.resourceType ? ` (${subject.resourceType})` : ""}${subject.description ? ` - ${subject.description}` : ""}`,
          )
          .join("\n");
      }
      return JSON.stringify(data, null, 2);
    },
    examples: [
      {
        title: "Subjects for English",
        parameters: { language: "en" },
        expectedResponse: "List of resource subjects available in English",
      },
    ],
  },

  {
    mcpName: "list_resources_for_language",
    displayName: "List Resources For Language",
    endpoint: "list-resources-for-language",
    description:
      "RECOMMENDED: Fast single API call (~1-2s) listing all resources for a specific language",
    category: "Discovery",
    parameters: PARAMETER_GROUPS.listResourcesForLanguage.parameters,
    requiredParams: ["language"],
    formatter: (data: any): string => {
      if (data.resourcesBySubject && data.language) {
        let output = `**Resources for ${data.language.toUpperCase()}**\n`;
        output += `Total: ${data.totalResources} resources across ${data.subjectCount} subjects\n\n`;

        for (const subject of data.subjects || []) {
          const resources = data.resourcesBySubject[subject] || [];
          output += `**${subject}** (${resources.length})\n`;
          resources.slice(0, 5).forEach((res: any) => {
            output += `  - ${res.name} (${res.organization})${res.version ? ` v${res.version}` : ""}\n`;
          });
          if (resources.length > 5) {
            output += `  ... and ${resources.length - 5} more\n`;
          }
          output += "\n";
        }
        return output;
      }
      return JSON.stringify(data, null, 2);
    },
    examples: [
      {
        title: "All English resources",
        parameters: { language: "en" },
        expectedResponse:
          "All resources available in English, organized by subject",
      },
    ],
  },
];

/**
 * Helper: Get tool by MCP name
 */
export function getToolByMcpName(mcpName: string): ToolDefinition | undefined {
  return TOOLS_REGISTRY.find((tool) => tool.mcpName === mcpName);
}

/**
 * Helper: Get tool by endpoint
 */
export function getToolByEndpoint(
  endpoint: string,
): ToolDefinition | undefined {
  return TOOLS_REGISTRY.find((tool) => tool.endpoint === endpoint);
}

/**
 * Helper: Get tools by category
 */
export function getToolsByCategory(category: string): ToolDefinition[] {
  return TOOLS_REGISTRY.filter((tool) => tool.category === category);
}

/**
 * Helper: Get all categories
 */
export function getAllCategories(): string[] {
  return [...new Set(TOOLS_REGISTRY.map((tool) => tool.category))].sort();
}

/**
 * Helper: Convert to ToolRegistry format (for backward compatibility)
 *
 * NOTE: Returns RELATIVE endpoint paths (no /api/ prefix)
 * The caller (UnifiedMCPHandler) is responsible for adding the base path
 */
export function toToolRegistry() {
  const registry: Record<string, any> = {};

  for (const tool of TOOLS_REGISTRY) {
    registry[tool.mcpName] = {
      endpoint: tool.endpoint, // Keep as relative path - handler adds base
      formatter: tool.formatter,
      requiredParams: tool.requiredParams,
    };
  }

  return registry;
}
