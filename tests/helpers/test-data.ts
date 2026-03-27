/**
 * Sample test data for comprehensive testing
 */

export const TEST_DATA = {
  // Scripture references
  references: {
    singleVerse: "John 3:16",
    /** Avoid 400 from strict USFM validation in MCP/API paths. */
    singleVerseUsfm: "JHN 3:16",
    /** es / es-419 scripture catalogs often omit JHN; use a book known present. */
    spanishCatalogVerse: "Titus 1:1",
    verseRange: "Genesis 1:1-3",
    wholeChapter: "Psalm 23",
    multiChapter: "Genesis 1-2",
  },

  // Languages
  languages: {
    english: "en",
    spanish: "es",
    spanishVariant: "es-419",
    portuguese: "pt-br",
    french: "fr",
    invalid: "zz-ZZ",
  },

  // Organizations
  organizations: {
    unfoldingWord: "unfoldingWord",
    doorBibleLanguage: "es-419_gl",
    biblesOrg: "biblesorg",
    all: "", // Empty string means search all organizations
  },

  // Translation Words
  translationWords: {
    faith: {
      term: "faith",
      path: "kt/faith",
      category: "kt",
    },
    love: {
      term: "love",
      path: "kt/love",
      category: "kt",
    },
    abraham: {
      term: "abraham",
      path: "names/abraham",
      category: "names",
    },
    altar: {
      term: "altar",
      path: "other/altar",
      category: "other",
    },
  },

  // Translation Academy
  translationAcademy: {
    metaphor: {
      path: "figs-metaphor",
      topic: "figures-of-speech",
    },
    idiom: {
      path: "figs-idiom",
      topic: "figures-of-speech",
    },
    hyperbole: {
      path: "figs-hyperbole",
      topic: "figures-of-speech",
    },
  },

  // Format options
  formats: {
    json: "json",
    markdown: "md",
    markdownFull: "markdown",
    text: "text", // Note: Not supported by all endpoints
    usfm: "usfm", // Scripture-specific
  },

  // Topics
  topics: {
    default: "tc-ready",
    production: "prod",
    draft: "draft",
  },

  // Expected error scenarios
  errorScenarios: {
    missingRequired: {
      description: "Missing required parameter",
      expectedStatus: 400,
      expectedMessage: /required/i,
    },
    invalidFormat: {
      description: "Invalid format value",
      expectedStatus: 400,
      expectedMessage: /invalid.*format/i,
    },
    resourceNotFound: {
      description: "Resource not found",
      expectedStatus: 404,
      expectedMessage: /not found/i,
    },
    invalidReference: {
      description: "Invalid reference format",
      expectedStatus: 400,
      expectedMessage: /invalid.*reference/i,
    },
  },
};

/**
 * Common test parameter combinations
 */
export const TEST_COMBINATIONS = {
  scripture: [
    { reference: TEST_DATA.references.singleVerse },
    {
      reference: TEST_DATA.references.singleVerse,
      language: TEST_DATA.languages.english,
    },
    {
      reference: TEST_DATA.references.singleVerse,
      language: TEST_DATA.languages.spanish,
    },
    {
      reference: TEST_DATA.references.singleVerse,
      language: TEST_DATA.languages.spanishVariant,
    },
    { reference: TEST_DATA.references.verseRange },
    {
      reference: TEST_DATA.references.singleVerse,
      organization: TEST_DATA.organizations.unfoldingWord,
    },
  ],

  translationNotes: [
    { reference: TEST_DATA.references.singleVerse },
    {
      reference: TEST_DATA.references.singleVerse,
      language: TEST_DATA.languages.english,
    },
    {
      reference: TEST_DATA.references.singleVerse,
      language: TEST_DATA.languages.spanish,
    },
  ],

  translationWords: [
    { path: TEST_DATA.translationWords.faith.path },
    {
      path: TEST_DATA.translationWords.faith.path,
      language: TEST_DATA.languages.english,
    },
    {
      path: TEST_DATA.translationWords.faith.path,
      language: TEST_DATA.languages.spanish,
    },
    {
      path: TEST_DATA.translationWords.faith.path,
      format: TEST_DATA.formats.json,
    },
    {
      path: TEST_DATA.translationWords.faith.path,
      format: TEST_DATA.formats.markdown,
    },
    {
      path: TEST_DATA.translationWords.faith.path,
      category: TEST_DATA.translationWords.faith.category,
    },
    {
      path: TEST_DATA.translationWords.faith.path,
      organization: TEST_DATA.organizations.unfoldingWord,
    },
    {
      path: TEST_DATA.translationWords.faith.path,
      organization: TEST_DATA.organizations.all,
    },
  ],

  translationAcademy: [
    { path: TEST_DATA.translationAcademy.metaphor.path },
    {
      path: TEST_DATA.translationAcademy.metaphor.path,
      language: TEST_DATA.languages.english,
    },
    {
      path: TEST_DATA.translationAcademy.metaphor.path,
      language: TEST_DATA.languages.spanish,
    },
    {
      path: TEST_DATA.translationAcademy.metaphor.path,
      language: TEST_DATA.languages.spanishVariant,
    },
    {
      path: TEST_DATA.translationAcademy.metaphor.path,
      format: TEST_DATA.formats.json,
    },
    {
      path: TEST_DATA.translationAcademy.metaphor.path,
      format: TEST_DATA.formats.markdown,
    },
    {
      path: TEST_DATA.translationAcademy.metaphor.path,
      topic: TEST_DATA.topics.default,
    },
    {
      path: TEST_DATA.translationAcademy.metaphor.path,
      organization: TEST_DATA.organizations.unfoldingWord,
    },
    {
      path: TEST_DATA.translationAcademy.metaphor.path,
      organization: TEST_DATA.organizations.all,
    },
  ],

  listLanguages: [{}, { subject: "bible" }],

  listSubjects: [{}],

  listResourcesForLanguage: [
    { language: TEST_DATA.languages.english },
    { language: TEST_DATA.languages.spanish },
    { language: TEST_DATA.languages.spanishVariant },
    {
      language: TEST_DATA.languages.english,
      organization: TEST_DATA.organizations.unfoldingWord,
    },
    {
      language: TEST_DATA.languages.spanish,
      organization: TEST_DATA.organizations.all,
    },
  ],
};

/**
 * Expected response structures
 */
export const EXPECTED_STRUCTURES = {
  scripture: {
    // Top-level shape from createScriptureResponse: text lives on each scripture[] item
    requiredFields: ["scripture", "reference"],
    optionalFields: ["counts", "metadata", "language"],
  },

  translationNotes: {
    // v3 endpoint uses verseNotes (plus optional contextNotes)
    requiredFields: ["verseNotes", "reference"],
    optionalFields: ["contextNotes", "language", "metadata"],
  },

  translationQuestions: {
    requiredFields: ["questions", "reference"],
    optionalFields: ["language", "metadata"],
  },

  translationWord: {
    requiredFields: ["content"],
    optionalFields: ["term", "language", "title", "metadata"],
  },

  translationAcademy: {
    requiredFields: ["content"],
    optionalFields: ["title", "language", "path", "metadata"],
  },

  listLanguages: {
    requiredFields: ["languages"],
    optionalFields: ["metadata", "total"],
  },

  listSubjects: {
    requiredFields: ["subjects"],
    optionalFields: ["metadata", "total"],
  },

  listResourcesForLanguage: {
    requiredFields: ["resourcesBySubject", "totalResources", "language"],
    optionalFields: ["subjects", "organization", "metadata"],
  },
};

/**
 * Tool-to-endpoint mapping
 */
export const TOOL_ENDPOINT_MAP = {
  fetch_scripture: "fetch-scripture",
  fetch_translation_notes: "fetch-translation-notes",
  fetch_translation_questions: "fetch-translation-questions",
  fetch_translation_word_links: "fetch-translation-word-links",
  fetch_translation_word: "fetch-translation-word",
  fetch_translation_academy: "fetch-translation-academy",
  list_tools: "list-tools",
  list_languages: "list-languages",
  list_subjects: "list-subjects",
  list_resources_for_language: "list-resources-for-language",
};

/**
 * Prompt metadata
 */
export const PROMPT_METADATA = {
  "translation-helps-report": {
    description: "Condensed report for a passage",
    requiredArgs: ["reference"],
    optionalArgs: ["language"],
    expectedTools: [
      "fetch_scripture",
      "fetch_translation_notes",
      "fetch_translation_word_links",
    ],
  },
  "translation-helps-for-passage": {
    description: "Comprehensive report for a passage",
    requiredArgs: ["reference"],
    optionalArgs: ["language"],
    expectedTools: [
      "fetch_scripture",
      "fetch_translation_notes",
      "fetch_translation_questions",
      "fetch_translation_word_links",
      "fetch_translation_academy",
    ],
  },
  "get-translation-words-for-passage": {
    description: "Translation words for a passage",
    requiredArgs: ["reference"],
    optionalArgs: ["language"],
    expectedTools: ["fetch_translation_word_links", "fetch_translation_word"],
  },
  "get-translation-academy-for-passage": {
    description: "Translation academy articles for a passage",
    requiredArgs: ["reference"],
    optionalArgs: ["language"],
    expectedTools: ["fetch_translation_academy"],
  },
  "discover-resources-for-language": {
    description: "Discover resources for a language",
    requiredArgs: ["language"],
    optionalArgs: [],
    expectedTools: ["list_resources_for_language"],
  },
  "discover-languages-for-subject": {
    description: "Discover languages for a subject",
    requiredArgs: [],
    optionalArgs: ["subject"],
    expectedTools: ["list_languages", "list_subjects"],
  },
};
