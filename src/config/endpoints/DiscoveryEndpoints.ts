/**
 * Discovery Endpoint Configurations
 *
 * Defines endpoints for discovering available languages, books, and resource coverage.
 * These endpoints help users understand what content is available before fetching it.
 */

import type { EndpointConfig } from "../EndpointConfig.js";
import { LANGUAGES_SHAPE, RESOURCES_SHAPE, SUBJECTS_SHAPE, RESOURCES_BY_LANGUAGE_SHAPE, RESOURCES_FOR_LANGUAGE_SHAPE } from "../ResponseShapes.js";

/**
 * Get Languages - Discover available languages with resource metadata
 */
export const GET_LANGUAGES_CONFIG: EndpointConfig = {
  name: "simple-languages",
  path: "/simple-languages",
  title: "Get Languages",
  description:
    "Discover available languages with metadata about resource coverage and availability",
  category: "extended",
  responseShape: LANGUAGES_SHAPE,

  params: {
    organization: {
      type: "string" as const,
      required: false,
      default: "unfoldingWord",
      description: "Organization providing the resources",
      example: "unfoldingWord",
      options: ["unfoldingWord", "Door43-Catalog"],
    },
    resource: {
      type: "string" as const,
      required: false,
      description:
        "Filter languages by specific resource availability (e.g., ult, ust, tn, tw, tq, ta)",
      example: "ult",
      options: ["ult", "ust", "tn", "tw", "tq", "ta", "twl"],
    },
    includeMetadata: {
      type: "boolean" as const,
      required: false,
      default: true,
      description: "Include detailed metadata about resource coverage",
      example: true,
    },
    includeStats: {
      type: "boolean" as const,
      required: false,
      default: false,
      description: "Include statistics about books and chapters available",
      example: false,
    },
  },

  dataSource: {
    type: "dcs-api",
    dcsEndpoint: "/api/v1/orgs/{organization}/repos",
    transformation: "json-passthrough",
    cacheTtl: 21600, // 6 hours (language availability changes infrequently)
  },

  enabled: true,
  tags: ["discovery", "languages", "metadata", "core"],

  examples: [
    {
      name: "All Languages",
      description: "Get all available languages with basic metadata",
      params: {
        organization: "unfoldingWord",
        includeMetadata: true,
      },
      expectedContent: {
        contains: ["languages", "en", "es", "metadata"],
        minLength: 200,
        fields: {
          languages: "array",
          totalLanguages: "number",
          metadata: "object",
        },
      },
    },
    {
      name: "Languages with Scripture",
      description: "Get only languages that have ULT scripture available",
      params: {
        organization: "unfoldingWord",
        resource: "ult",
        includeMetadata: true,
      },
      expectedContent: {
        contains: ["languages", "ult", "scripture"],
        minLength: 100,
        fields: {
          languages: "array",
        },
      },
    },
    {
      name: "Languages with Stats",
      description: "Get languages with detailed coverage statistics",
      params: {
        organization: "unfoldingWord",
        includeMetadata: true,
        includeStats: true,
      },
      expectedContent: {
        contains: ["languages", "statistics", "coverage"],
        minLength: 300,
        fields: {
          languages: "array",
          statistics: "object",
        },
      },
    },
  ],
} as EndpointConfig;

/**
 * Get Available Books - Discover book coverage per resource and language
 */
export const GET_AVAILABLE_BOOKS_CONFIG: EndpointConfig = {
  name: "get-available-books",
  path: "/get-available-books",
  title: "Get Available Books",
  description:
    "Discover which Bible books are available for specific resources and languages, with coverage indicators",
  category: "extended",
  responseShape: RESOURCES_SHAPE,

  params: {
    language: {
      type: "string" as const,
      required: false,
      default: "en",
      description: "Language code to check book availability for",
      example: "en",
      options: ["en", "es", "fr", "sw", "hi", "ar", "zh", "pt"],
    },
    organization: {
      type: "string" as const,
      required: false,
      default: "unfoldingWord",
      description: "Organization providing the resources",
      example: "unfoldingWord",
      options: ["unfoldingWord", "Door43-Catalog"],
    },
    resource: {
      type: "string" as const,
      required: false,
      description: "Specific resource to check availability for",
      example: "ult",
      options: ["ult", "ust", "tn", "tw", "tq", "ta", "twl"],
    },
    testament: {
      type: "string" as const,
      required: false,
      description: "Filter by Old Testament (ot) or New Testament (nt)",
      example: "nt",
      options: ["ot", "nt"],
    },
    includeChapters: {
      type: "boolean" as const,
      required: false,
      default: false,
      description: "Include chapter-level availability information",
      example: false,
    },
    includeCoverage: {
      type: "boolean" as const,
      required: false,
      default: true,
      description: "Include coverage percentages and completion status",
      example: true,
    },
  },

  dataSource: {
    type: "dcs-api",
    dcsEndpoint: "/api/v1/repos/{organization}/{language}_{resource}/contents",
    transformation: "json-passthrough",
    cacheTtl: 14400, // 4 hours (book availability changes moderately)
  },

  enabled: true,
  tags: ["discovery", "books", "coverage", "availability", "core"],

  examples: [
    {
      name: "English ULT Books",
      description: "Get available books for English ULT scripture",
      params: {
        language: "en",
        organization: "unfoldingWord",
        resource: "ult",
        includeCoverage: true,
      },
      expectedContent: {
        contains: ["books", "Genesis", "Matthew", "coverage"],
        minLength: 500,
        fields: {
          books: "array",
          coverage: "object",
          totalBooks: "number",
        },
      },
    },
    {
      name: "NT Books Only",
      description: "Get only New Testament books for Spanish translation",
      params: {
        language: "es",
        organization: "unfoldingWord",
        resource: "ult",
        testament: "nt",
        includeCoverage: true,
      },
      expectedContent: {
        contains: ["books", "Matthew", "Revelation"],
        fields: {
          books: "array",
          testament: "nt",
        },
      },
    },
    {
      name: "Translation Notes Coverage",
      description: "Check which books have translation notes available",
      params: {
        language: "en",
        organization: "unfoldingWord",
        resource: "tn",
        includeCoverage: true,
        includeChapters: true,
      },
      expectedContent: {
        contains: ["books", "notes", "chapters", "coverage"],
        minLength: 800,
        fields: {
          books: "array",
          coverage: "object",
          chapters: "object",
        },
      },
    },
    {
      name: "Cross-Resource Comparison",
      description: "Check availability across multiple resources",
      params: {
        language: "en",
        organization: "unfoldingWord",
        includeCoverage: true,
      },
      expectedContent: {
        contains: ["resources", "availability", "comparison"],
        fields: {
          resources: "array",
          coverage: "object",
        },
      },
    },
  ],
} as EndpointConfig;

/**
 * List Available Resources - Discover what resource types exist
 */
export const LIST_AVAILABLE_RESOURCES_CONFIG: EndpointConfig = {
  name: "list-available-resources",
  path: "/list-available-resources",
  title: "List Available Resources",
  description:
    "Discover what types of translation resources are available (Scripture, Notes, Words, etc.)",
  category: "extended",
  responseShape: RESOURCES_SHAPE,

  params: {
    language: {
      type: "string" as const,
      required: false,
      default: "en",
      description: "Language code to check resource availability for",
      example: "en",
      options: ["en", "es", "fr", "sw", "hi", "ar", "zh", "pt"],
    },
    organization: {
      type: "string" as const,
      required: false,
      default: "unfoldingWord",
      description: "Organization providing the resources",
      example: "unfoldingWord",
      options: ["unfoldingWord", "Door43-Catalog"],
    },
    includeMetadata: {
      type: "boolean" as const,
      required: false,
      default: true,
      description: "Include metadata about each resource type",
      example: true,
    },
    includeStats: {
      type: "boolean" as const,
      required: false,
      default: false,
      description: "Include statistics about content volume",
      example: false,
    },
  },

  dataSource: {
    type: "dcs-api",
    dcsEndpoint: "/api/v1/orgs/{organization}/repos",
    transformation: "json-passthrough",
    cacheTtl: 43200, // 12 hours (resource types change very infrequently)
  },

  enabled: true,
  tags: ["discovery", "resources", "types", "core"],

  examples: [
    {
      name: "All Resource Types",
      description: "Get all available resource types for English",
      params: {
        language: "en",
        organization: "unfoldingWord",
        includeMetadata: true,
      },
      expectedContent: {
        contains: ["resources", "ult", "ust", "tn", "tw", "tq"],
        minLength: 300,
        fields: {
          resources: "array",
          metadata: "object",
        },
      },
    },
    {
      name: "Resource Stats",
      description: "Get resources with detailed statistics",
      params: {
        language: "en",
        organization: "unfoldingWord",
        includeMetadata: true,
        includeStats: true,
      },
      expectedContent: {
        contains: ["resources", "statistics", "volume"],
        fields: {
          resources: "array",
          statistics: "object",
        },
      },
    },
  ],
} as EndpointConfig;

/**
 * List Languages - Discover available languages from Door43 catalog
 */
export const LIST_LANGUAGES_CONFIG: EndpointConfig = {
  name: "list-languages",
  path: "/api/list-languages",
  title: "List Languages",
  description:
    "List all available languages from the Door43 catalog. Returns structured language data (codes, names, display names) that can be directly reused as language parameters in other tools.",
  category: "core",
  responseShape: LANGUAGES_SHAPE,

  params: {
    organization: {
      type: "string" as const,
      required: false,
      description:
        "Organization(s) to filter by. Can be a single organization (string), multiple organizations (comma-separated), or omitted to return all languages from all organizations.",
      example: "unfoldingWord",
    },
    stage: {
      type: "string" as const,
      required: false,
      default: "prod",
      description: "Resource stage (default: prod)",
      example: "prod",
      options: ["prod", "preprod", "draft"],
    },
  },

  dataSource: {
    type: "computed",
    transformation: "json-passthrough",
    cacheTtl: 21600, // 6 hours (language availability changes infrequently)
  },

  enabled: true,
  tags: ["discovery", "languages", "catalog", "core"],

  examples: [
    {
      name: "All Languages",
      description: "Get all available languages from all organizations",
      params: {
        stage: "prod",
      },
      expectedContent: {
        contains: ["languages", "code", "name"],
        minLength: 200,
        fields: {
          languages: "array",
          metadata: "object",
        },
      },
    },
    {
      name: "Languages by Organization",
      description: "Get languages available from a specific organization",
      params: {
        organization: "unfoldingWord",
        stage: "prod",
      },
      expectedContent: {
        contains: ["languages", "unfoldingWord"],
        minLength: 100,
        fields: {
          languages: "array",
          filters: "object",
        },
      },
    },
  ],
} as EndpointConfig;

/**
 * List Subjects - Discover available resource types from Door43 catalog
 */
export const LIST_SUBJECTS_CONFIG: EndpointConfig = {
  name: "list-subjects",
  path: "/api/list-subjects",
  title: "List Subjects",
  description:
    "List all available resource subjects (resource types) from the Door43 catalog. Returns structured subject data (names, descriptions, resource types) that can be used to discover what resource types are available.",
  category: "core",
  responseShape: SUBJECTS_SHAPE,

  params: {
    language: {
      type: "string" as const,
      required: false,
      description:
        "Filter subjects by language code (e.g., 'en', 'es-419'). If not provided, returns all subjects.",
      example: "en",
    },
    organization: {
      type: "string" as const,
      required: false,
      description:
        "Organization(s) to filter by. Can be a single organization (string), multiple organizations (comma-separated), or omitted to return all subjects from all organizations.",
      example: "unfoldingWord",
    },
    stage: {
      type: "string" as const,
      required: false,
      default: "prod",
      description: "Resource stage (default: prod)",
      example: "prod",
      options: ["prod", "preprod", "draft"],
    },
  },

  dataSource: {
    type: "computed",
    transformation: "json-passthrough",
    cacheTtl: 43200, // 12 hours (resource types change very infrequently)
  },

  enabled: true,
  tags: ["discovery", "subjects", "resource-types", "catalog", "core"],

  examples: [
    {
      name: "All Subjects",
      description: "Get all available resource subjects",
      params: {
        stage: "prod",
      },
      expectedContent: {
        contains: ["subjects", "name", "resourceType"],
        minLength: 200,
        fields: {
          subjects: "array",
          metadata: "object",
        },
      },
    },
    {
      name: "Subjects for Language",
      description: "Get resource subjects available for a specific language",
      params: {
        language: "en",
        organization: "unfoldingWord",
        stage: "prod",
      },
      expectedContent: {
        contains: ["subjects", "filters"],
        minLength: 100,
        fields: {
          subjects: "array",
          filters: "object",
        },
      },
    },
  ],
} as EndpointConfig;

/**
 * List Resources by Language - Discover resources organized by language
 */
export const LIST_RESOURCES_BY_LANGUAGE_CONFIG: EndpointConfig = {
  name: "list-resources-by-language",
  path: "/api/list-resources-by-language",
  title: "List Resources by Language",
  description:
    "List available resources organized by language. Searches 7 default subjects in parallel. First call: ~4-5s (uncached). Subsequent calls: ~50ms (cached). For faster single-language discovery, use list-resources-for-language instead.",
  category: "core",
  responseShape: RESOURCES_BY_LANGUAGE_SHAPE,

  params: {
    subjects: {
      type: "string" as const,
      required: false,
      description:
        "Comma-separated list of subjects to search for (e.g., 'Translation Words,Translation Academy'). If not provided, automatically searches 7 default subjects: Bible, Aligned Bible, Translation Words, Translation Academy, TSV Translation Notes, TSV Translation Questions, and TSV Translation Words Links.",
      example: "Translation Words,Translation Academy",
    },
    organization: {
      type: "string" as const,
      required: false,
      description:
        "Organization(s) to filter by. Can be a single organization (string), multiple organizations (comma-separated), or omitted to search all organizations.",
      example: "unfoldingWord",
    },
    stage: {
      type: "string" as const,
      required: false,
      default: "prod",
      description: "Resource stage (default: prod)",
      example: "prod",
      options: ["prod", "preprod", "draft"],
    },
    limit: {
      type: "number" as const,
      required: false,
      default: 100,
      description: "Maximum number of resources to return per subject (default: 100, max: 1000)",
      example: 100,
      min: 1,
      max: 1000,
    },
    topic: {
      type: "string" as const,
      required: false,
      description: 'Filter by topic tag (e.g., "tc-ready" for translationCore-ready resources). Topics are metadata tags that indicate resource status or readiness.',
      example: "tc-ready",
    },
  },

  dataSource: {
    type: "computed",
    transformation: "json-passthrough",
    cacheTtl: 3600, // 1 hour (resource availability changes moderately)
  },

  enabled: true,
  tags: ["discovery", "resources", "languages", "catalog", "core"],

  examples: [
    {
      name: "All Resources by Language",
      description: "Get all available resources organized by language",
      params: {
        stage: "prod",
      },
      expectedContent: {
        contains: ["resourcesByLanguage", "summary", "en", "es"],
        minLength: 500,
        fields: {
          resourcesByLanguage: "array",
          summary: "object",
        },
      },
    },
    {
      name: "Specific Subjects by Language",
      description: "Get specific resource types organized by language",
      params: {
        subjects: "Translation Words,Translation Notes",
        organization: "unfoldingWord",
        stage: "prod",
      },
      expectedContent: {
        contains: ["resourcesByLanguage", "Translation Words", "Translation Notes"],
        minLength: 200,
        fields: {
          resourcesByLanguage: "object",
        },
      },
    },
  ],
} as EndpointConfig;

/**
 * List Resources for Language - Get all resources for a specific language
 */
export const LIST_RESOURCES_FOR_LANGUAGE_CONFIG: EndpointConfig = {
  name: "list-resources-for-language",
  path: "/api/list-resources-for-language",
  title: "List Resources for Language (Recommended)",
  description:
    "FAST: List all available resources for a specific language (~1-2s). Given a language code (e.g., 'en', 'fr', 'es-419'), returns all resources organized by subject. Single API call, much faster than list-resources-by-language. Recommended workflow: 1) list-languages, 2) this tool for chosen language, 3) fetch specific resources.",
  category: "core",
  responseShape: RESOURCES_FOR_LANGUAGE_SHAPE,

  params: {
    language: {
      type: "string" as const,
      required: true,
      description: "Language code (e.g., 'en', 'fr', 'es-419')",
      example: "en",
    },
    organization: {
      type: "string" as const,
      required: false,
      description:
        "Organization(s) to filter by. Can be a single organization, multiple organizations (comma-separated), or omitted to search all organizations.",
      example: "unfoldingWord",
    },
    stage: {
      type: "string" as const,
      required: false,
      default: "prod",
      description: "Resource stage (default: prod)",
      example: "prod",
      options: ["prod", "preprod", "draft"],
    },
    subject: {
      type: "string" as const,
      required: false,
      description:
        "Optional: Filter by specific subject/resource type (e.g., 'Bible', 'Translation Words')",
      example: "Translation Words",
    },
    limit: {
      type: "number" as const,
      required: false,
      description: "Maximum number of resources to return. If not specified, fetches all available resources (up to 10000).",
      example: 200,
    },
    topic: {
      type: "string" as const,
      required: false,
      description: 'Filter by topic tag (e.g., "tc-ready" for translationCore-ready resources). Topics are metadata tags that indicate resource status or readiness.',
      example: "tc-ready",
    },
  },

  dataSource: {
    type: "computed",
    transformation: "json-passthrough",
    cacheTtl: 3600, // 1 hour
  },

  enabled: true,
  tags: ["discovery", "languages", "resources", "catalog", "core"],

  examples: [
    {
      name: "All Resources for English",
      description: "Get all English resources from all organizations",
      params: {
        language: "en",
      },
    },
    {
      name: "unfoldingWord Spanish Resources",
      description: "Get Spanish resources from unfoldingWord only",
      params: {
        language: "es-419",
        organization: "unfoldingWord",
      },
    },
    {
      name: "French Translation Words",
      description: "Get only Translation Words resources in French",
      params: {
        language: "fr",
        subject: "Translation Words",
      },
    },
  ],
} as EndpointConfig;

/**
 * All Discovery Endpoint Configurations
 */
export const DISCOVERY_ENDPOINTS = [
  LIST_LANGUAGES_CONFIG,
  LIST_SUBJECTS_CONFIG,
  LIST_RESOURCES_BY_LANGUAGE_CONFIG,
  LIST_RESOURCES_FOR_LANGUAGE_CONFIG,
] as const;

export default DISCOVERY_ENDPOINTS;
