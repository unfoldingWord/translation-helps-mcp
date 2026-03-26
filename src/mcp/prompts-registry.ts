/**
 * MCP Prompts Registry
 * Single source of truth for all MCP prompt definitions
 * Used by both the MCP server and the HTTP bridge
 */

export interface MCPPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface MCPPromptDefinition {
  name: string;
  description: string;
  arguments: MCPPromptArgument[];
}

/**
 * All MCP prompts - single source of truth
 */
export const MCP_PROMPTS: MCPPromptDefinition[] = [
  {
    name: "translation-helps-report",
    description:
      "Get a CONDENSED translation helps report for a Bible passage: scripture text (full), questions (full), notes (quote + academy link only), key terms list (titles only), and academy article titles (no full content). Perfect for getting an overview without overwhelming context. CRITICAL: Reference parameter MUST use standard 3-letter book codes (GEN, JHN, TIT, etc.), NOT full book names.",
    arguments: [
      {
        name: "reference",
        description:
          'Bible reference using 3-letter book code. Examples: "JHN 3:16" (NOT "John 3:16"), "TIT 1:15" (NOT "Titus 1:15"), "GEN 1:1-3" (NOT "Genesis 1:1-3")',
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
    name: "translation-helps-for-passage",
    description:
      "Get comprehensive translation help for a Bible passage: scripture text, questions, word definitions (with titles), notes, and related academy articles. WARNING: Returns FULL content for all resources which can be very large. Consider using 'translation-helps-report' for a condensed overview. CRITICAL: Reference parameter MUST use standard 3-letter book codes (GEN, JHN, TIT, etc.), NOT full book names.",
    arguments: [
      {
        name: "reference",
        description:
          'Bible reference using 3-letter book code. Examples: "JHN 3:16" (NOT "John 3:16"), "TIT 1:15" (NOT "Titus 1:15"), "GEN 1:1-3" (NOT "Genesis 1:1-3")',
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
      "Get all translation word definitions for a passage, showing dictionary entry titles (not technical term IDs). CRITICAL: Reference parameter MUST use standard 3-letter book codes (GEN, JHN, TIT, etc.), NOT full book names.",
    arguments: [
      {
        name: "reference",
        description:
          'Bible reference using 3-letter book code. Examples: "JHN 3:16" (NOT "John 3:16"), "TIT 1:15" (NOT "Titus 1:15")',
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
      "Get Translation Academy training articles referenced in the translation notes for a passage. CRITICAL: Reference parameter MUST use standard 3-letter book codes (GEN, JHN, TIT, etc.), NOT full book names.",
    arguments: [
      {
        name: "reference",
        description:
          'Bible reference using 3-letter book code. Examples: "JHN 3:16" (NOT "John 3:16"), "TIT 1:15" (NOT "Titus 1:15")',
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
    ],
  },
];

/**
 * Get prompt template text for a specific prompt
 */
export function getPromptTemplate(
  name: string,
  args: Record<string, any>,
): string {
  const language = (args?.language as string) || "en";
  const reference = (args?.reference as string) || "";
  const subject = (args?.subject as string) || "";

  switch (name) {
    case "translation-helps-report":
      return `Please provide a CONDENSED translation helps report for ${reference} in ${language}.

**CRITICAL**: The reference "${reference}" MUST use standard 3-letter book codes (e.g., "JHN 3:16", "TIT 1:15", "GEN 1"). If the user provided a full book name (like "John" or "Titus"), you must convert it to the 3-letter code first (JHN, TIT, GEN, etc.) before calling any tools.

**CITATION REQUIREMENTS**: Every resource returned includes a citation object. You MUST:
1. Read the citation object from each response
2. Extract citation.resource or citation.title for the resource name
3. Extract citation.version for the version number
4. Cite using format: [Resource Version - Reference]
5. NEVER assume resource names - always read from citation object

**CONDENSED FORMAT**: This report provides an OVERVIEW, not full content:
- Scripture: Full text with citation
- Questions: Full questions (they're already concise)
- Translation Notes: ONLY the Greek/Hebrew quote + which academy article it links to
- Translation Words: ONLY the key term titles (no full definitions)
- Translation Academy: ONLY the article titles (no full content)

Follow these steps:

1. **Get Scripture Text:**
   - Use fetch_scripture with reference="${reference}" and language="${language}"
   - Read scripture.citation object from response
   - Show FULL scripture text with citation: [citation.resource version - ${reference}]

2. **Get Translation Questions:**
   - Use fetch_translation_questions with reference="${reference}" and language="${language}"
   - Read questions.citation object
   - Show ALL questions (they're already short) with citation

3. **Get Translation Word Links (Titles Only):**
   - Use fetch_translation_word_links with reference="${reference}" and language="${language}"
   - Extract all externalReference.path values (e.g., "bible/kt/love")
   - For EACH path, use fetch_translation_word with path=<path>
   - Extract ONLY the TITLE from each article (e.g., "Love, Beloved")
   - DO NOT include full content - just list the titles with citations
   - Present as: "Key Terms: [Title 1], [Title 2], [Title 3]..."

4. **Get Translation Notes (Condensed):**
   - Use fetch_translation_notes with reference="${reference}" and language="${language}"
   - For EACH note, show ONLY:
     * The Quote field (Greek/Hebrew text)
     * Any externalReference.path that links to academy articles
   - Format: "Note on [verse]: [Quote] → See: [Academy Article Path]"
   - DO NOT show full note explanations
   - Cite notes with: [citation.resource version - ${reference}]

5. **Get Academy Article Titles (Titles Only):**
   - From the notes, extract all externalReference.path values
   - For EACH path, use fetch_translation_academy with path=<path>
   - Extract ONLY the TITLE (e.g., "Metaphor", "Doble Negativos")
   - DO NOT include full article content
   - Present as: "Related Concepts: [Title 1], [Title 2], [Title 3]..."

6. **Organize Condensed Report:**
   Present in this order with proper citations:
   
   **Scripture** [citation]
   [Full scripture text]
   
   **Key Terms** [word links citation]
   - [Term Title 1]
   - [Term Title 2]
   ...
   
   **Translation Questions** [questions citation]
   - [Question 1]
   - [Question 2]
   ...
   
   **Translation Notes** [notes citation]
   - Verse X: [Greek/Hebrew Quote] → See: [Academy Article Path]
   - Verse Y: [Greek/Hebrew Quote] → See: [Academy Article Path]
   ...
   
   **Related Translation Concepts** [academy citations]
   - [Concept Title 1]
   - [Concept Title 2]
   ...

**REMEMBER**: 
- This is a CONDENSED report - no full articles
- Users can request full content for specific items if needed
- Always cite using actual citation objects
- Keep it concise and scannable

The goal is to provide a clear OVERVIEW that helps translators see what resources are available without overwhelming them with content.`;

    case "translation-helps-for-passage":
      return `Please provide comprehensive translation help for ${reference} in ${language}.

**CRITICAL**: The reference "${reference}" MUST use standard 3-letter book codes (e.g., "JHN 3:16", "TIT 1:15", "GEN 1"). If the user provided a full book name (like "John" or "Titus"), you must convert it to the 3-letter code first (JHN, TIT, GEN, etc.) before calling any tools.

**CITATION REQUIREMENTS**: Every resource returned includes a citation object. You MUST:
1. Read the citation object from each response
2. Extract citation.resource or citation.title for the resource name
3. Extract citation.version for the version number
4. Cite scripture and all resources using this format: [Resource Version - Reference]
5. NEVER assume resource names (like "ULT") - always read from citation object

Example: If citation = {"resource": "glt", "title": "Texto Puente Literal", "version": "v41"}, cite as [GLT v41 - Reference] or [Texto Puente Literal v41 - Reference]

Follow these steps to gather all relevant information:

1. **Get the Scripture Text:**
   - Use fetch_scripture tool with reference="${reference}" and language="${language}"
   - IMPORTANT: Ensure reference uses 3-letter code (e.g., "JHN 3:16" not "John 3:16")
   - Read scripture.citation object from the response
   - Cite scripture using: [citation.resource version - ${reference}] (e.g., [GLT v41 - ${reference}])
   - This provides the actual Bible text to work with

2. **Get Translation Questions:**
   - Use fetch_translation_questions with reference="${reference}" and language="${language}"
   - Read questions.citation object from the response
   - Cite questions using: [citation.resource version - ${reference}] (e.g., [es-419_tq v38 - ${reference}])
   - These help check comprehension and guide translation decisions

3. **Get Translation Word Links and Fetch Titles:**
   - Use fetch_translation_word_links with reference="${reference}" and language="${language}"
   - This returns items with externalReference: [{externalReference: {target: "tw", path: "bible/kt/love", category: "kt"}}]
   - For EACH item that has externalReference.path, use fetch_translation_word tool with path=<externalReference.path> (e.g., path="bible/kt/love")
   - Extract the TITLE from each article (found in the first H1 heading or title field)
   - Show the user these dictionary entry TITLES, not the technical term IDs
   - Example: Show "Love, Beloved" not "love"; show "Son of God, Son" not "sonofgod"

4. **Get Translation Notes:**
   - Use fetch_translation_notes with reference="${reference}" and language="${language}"
   - Read notes.citation object from the response
   - Cite notes using: [citation.resource version - ${reference}] (e.g., [es-419_tn v66 - ${reference}])
   - Notes contain supportReference fields that link to Translation Academy articles

5. **Get Related Translation Academy Articles:**
   - From the translation notes response, extract all externalReference.path values
   - These are paths like "translate/figs-metaphor" (NOT RC links)
   - For each externalReference.path, use fetch_translation_academy tool with path=<path_value>
   - Extract the TITLE from each academy article
   - Show these training article titles to help the user understand translation concepts

6. **Organize the Response:**
   Present everything in a clear, structured way with proper citations:
   - Scripture text at the top with citation: [Resource Version - Reference]
   - List of translation word titles (dictionary entries) with citations
   - Translation questions for comprehension with citation
   - Translation notes with guidance with citation
   - Related academy article titles for deeper learning with citations

**REMEMBER**: Always read and use the citation object from each response. Never assume resource names like "ULT" or "UST".

The goal is to provide EVERYTHING a translator needs for this passage in one comprehensive response with accurate source citations.`;

    case "get-translation-words-for-passage":
      return `Please show me all the translation word definitions for ${reference} in ${language}.

**CRITICAL**: The reference "${reference}" MUST use standard 3-letter book codes (e.g., "JHN 3:16", "TIT 1:15"). If the user provided a full book name, convert it to the 3-letter code first before calling any tools.

**CITATION REQUIREMENTS**: Each translation word article includes a citation object. Always read and cite using [citation.resource version - term] format.

Follow these steps:

1. **Get Translation Word Links:**
   - Use fetch_translation_word_links with reference="${reference}" and language="${language}"
   - IMPORTANT: Ensure reference uses 3-letter code (e.g., "JHN 3:16" not "John 3:16")
   - This returns items with externalReference: [{externalReference: {target: "tw", path: "bible/kt/love", category: "kt"}}]

2. **Fetch Full Articles and Extract Titles:**
   - For EACH item that has externalReference.path, call fetch_translation_word with path=<externalReference.path> (e.g., path="bible/kt/love")
   - From each article response, extract the TITLE (not the path)
   - The title is usually in the first H1 heading or a dedicated title field
   - Example: The path "bible/kt/love" might have title "Love, Beloved"
   - Example: The path "bible/kt/sonofgod" might have title "Son of God, Son"

3. **Present to User:**
   - Show the dictionary entry TITLES in a clear list
   - These are human-readable names, not technical IDs
   - Optionally group by category (Key Terms, Names, Other Terms)
   - Let the user know they can ask for the full definition of any term

Focus on making the translation words accessible by showing their proper titles.`;

    case "get-translation-academy-for-passage":
      return `Please find all the Translation Academy training articles related to ${reference} in ${language}.

**CRITICAL**: The reference "${reference}" MUST use standard 3-letter book codes (e.g., "JHN 3:16", "TIT 1:15"). If the user provided a full book name, convert it to the 3-letter code first before calling any tools.

**CITATION REQUIREMENTS**: Each academy article includes a citation object. Always read and cite using [citation.resource version - article] format.

Follow these steps:

1. **Get Translation Notes:**
   - Use fetch_translation_notes with reference="${reference}" and language="${language}"
   - IMPORTANT: Ensure reference uses 3-letter code (e.g., "JHN 3:16" not "John 3:16")
   - Translation notes contain supportReference fields that link to academy articles

2. **Extract External References:**
   - From the notes response, find all externalReference.path values
   - These are paths in format: "translate/figs-metaphor", "translate-names"
   - Collect all unique external reference paths

3. **Fetch Academy Articles:**
   - For each externalReference.path, use fetch_translation_academy tool with path=<path_value>
   - Each call returns an academy article with training content

4. **Extract Titles:**
   - From each academy article response, extract the TITLE
   - The title is in the first H1 heading or dedicated title field

5. **Present to User:**
   - Show the academy article titles
   - Brief description of what each article teaches
   - Let the user know they can request the full content of any article
   
The goal is to show what translation concepts and training materials are relevant to understanding this passage.`;

    case "discover-resources-for-language":
      return `Help the user discover what translation resources are available for ${language ? `language "${language}"` : "a language"}.

Follow these steps:

1. **List Available Languages (if language not specified):**
   - If no language was provided, first use list_languages tool
   - Show the user the available languages with their codes and names
   - Ask the user to select a language, or proceed with the most common one (usually "en")

2. **List Available Subjects for the Language:**
   - Use list_subjects tool with language="${language || "en"}"
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

The goal is to help users discover what's available and show them how to use that information in subsequent tool calls.`;

    case "discover-languages-for-subject":
      return `Help the user discover which languages have the resource type "${subject || "[subject to be selected]"}" available.

Follow these steps:

1. **List Available Subjects (if subject not specified):**
   - If no subject was provided, first use list_subjects tool
   - Show the user the available resource types (subjects)
   - Common subjects include: "Translation Words", "TSV Translation Notes", "TSV Translation Questions", "Bible", "Aligned Bible", "Translation Word Links", "Translation Academy"
   - Ask the user to select a subject, or proceed with a common one like "Translation Words"

2. **Discover Languages with This Subject:**
   - For the selected subject "${subject || "[to be selected]"}":
     * Use list_subjects to get all subjects
     * Then, for each language you want to check, use list_subjects with language=<language_code>
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
     * fetch_translation_notes with language="en", reference="JHN 3:16"
     * fetch_translation_notes with language="es", reference="TIT 3:15"

5. **Guide Next Steps:**
   - Explain that the user can now use any of the discovered languages with tools that support that resource type
   - Suggest trying the tools with different languages to compare resources

The goal is to help users find which languages have specific resource types available and show them how to use those languages in subsequent tool calls.`;

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
