/**
 * MCP tools + prompts documentation manifest.
 *
 * Served at GET /v2/api/mcp-manifest (and /api/mcp-manifest). Built from the
 * live tool registry + prompt modules so docs stay in sync with the surface.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { MCP_TOOLS } from "./toolRegistry.js";
import { PROMPTS } from "./prompts/index.js";

export type ToolCategory = "workflow" | "obs" | "discovery";

export interface ToolDocMeta {
  category: ToolCategory;
  summary: string;
  example?: Record<string, unknown>;
  /** `structuredContent` payload returned by the tool on success. */
  exampleResponse?: unknown;
  /** Notes about alternate shapes (empty arrays, not-available, etc.). */
  responseNotes?: string[];
}

/** Extra doc metadata keyed by tool name (beyond name/description/schema). */
export const TOOL_DOC_META: Record<string, ToolDocMeta> = {
  list_languages: {
    category: "discovery",
    summary: "List languages with tc-ready Door43 resources.",
    example: {},
    exampleResponse: {
      total_count: 120,
      has_more: true,
      limit: 50,
      offset: 0,
      languages: [
        { code: "en", name: "English" },
        { code: "es-419", name: "Español (Latinoamérica)" },
      ],
      requestId: "req_…",
    },
  },
  list_resources: {
    category: "discovery",
    summary: "Availability summary of resource types for a language.",
    example: { language: "en", book: "TIT" },
    exampleResponse: {
      language: "en",
      requestedLanguage: "en",
      book: "TIT",
      available: [
        {
          type: "scripture",
          subject: "Aligned Bible",
          abbreviation: "ult",
          role: "literal",
          books: ["GEN", "TIT"],
          bookCount: 66,
          coversBook: true,
        },
        {
          type: "notes",
          subject: "TSV Translation Notes",
          abbreviation: "tn",
          role: "notes",
          coversBook: true,
        },
      ],
      resources: [
        {
          type: "scripture",
          subject: "Aligned Bible",
          abbreviation: "ult",
          role: "literal",
        },
      ],
      coverage: {
        note: "Type-level catalog presence does not guarantee every book.",
        filteredByBook: "TIT",
      },
      requestId: "req_…",
    },
    responseNotes: [
      "`resources` is an alias of `available` for discovery consumers.",
      "`language` may differ from `requestedLanguage` after variant resolution.",
      "Optional `book` / `reference` filters book-scoped resources missing that book.",
      "Book-scoped entries may include `books`, `bookCount`, `coversBook`, and `warning`.",
    ],
  },
  get_passage: {
    category: "workflow",
    summary:
      "Scripture text for a reference (literal + simplified + original).",
    example: { reference: "TIT 2:12", language: "en" },
    exampleResponse: {
      reference: "TIT 2:12",
      language: "en",
      book: "TIT",
      chapter: "2",
      verse: "12",
      versions: [
        {
          resourceType: "ult",
          role: "literal",
          text: "training us so that we can reject ungodliness…",
          source: "https://git.door43.org/…",
        },
        {
          resourceType: "ust",
          role: "simplified",
          text: "By means of this free gift, God trains us…",
          source: "https://git.door43.org/…",
        },
        {
          resourceType: "ugnt",
          role: "original",
          text: "παιδεύουσα ἡμᾶς…",
          source: "https://git.door43.org/…",
        },
      ],
      meta: { cache: "kv" },
    },
    responseNotes: [
      '`role` is typically "literal" | "simplified" | "original".',
      "Also warms caches for later workflow steps (notes / word-links / questions).",
    ],
  },
  get_passage_context: {
    category: "workflow",
    summary: "Background notes and resource availability for a passage.",
    example: { reference: "TIT 2:12", language: "en" },
    exampleResponse: {
      reference: "TIT 2:12",
      language: "en",
      book: "TIT",
      chapter: "2",
      context: [
        {
          book: "TIT",
          chapter: "2",
          verse: "intro",
          scope: "chapter",
          note: "In this chapter Paul tells Titus…",
          supportReference: "rc://*/ta/man/translate/…",
        },
      ],
      availability: [
        {
          type: "notes",
          subject: "TSV Translation Notes",
          abbreviation: "tn",
          role: "notes",
        },
      ],
    },
    responseNotes: [
      '`context` holds intro notes only (`verse: "intro"`); `scope` is "book" or "chapter".',
      "Empty `context` / `availability` arrays mean nothing is available — not an error.",
    ],
  },
  get_passage_index: {
    category: "workflow",
    summary: "Survey translation notes and key terms for a passage.",
    example: { reference: "TIT 2:12", language: "en" },
    exampleResponse: {
      reference: "TIT 2:12",
      language: "en",
      notes: [
        {
          id: "abc123",
          verse: "12",
          quote: { original: "παιδεύουσα ἡμᾶς", aligned: "training us" },
          taArticle: {
            path: "translate/figs-personification",
            title: "Personification",
          },
          summary: "Grace spoken of as a trainer…",
        },
      ],
      words: [
        {
          id: "def456",
          verse: "12",
          quote: { original: "δικαίως", aligned: "righteous" },
          twArticle: {
            path: "kt/righteous",
            title: "righteous, righteousness",
          },
        },
      ],
      issues: [
        {
          path: "translate/figs-personification",
          title: "Personification",
          count: 1,
        },
      ],
      keyTerms: [
        { path: "kt/righteous", title: "righteous, righteousness", count: 1 },
      ],
    },
    responseNotes: [
      "Compact index only — no full note/article bodies. Drill with get_note / get_academy_article / get_word_article.",
      "Empty arrays mean no resources for the passage — not an error.",
    ],
  },
  get_note: {
    category: "workflow",
    summary: "Full translation note bodies for a passage.",
    example: { reference: "TIT 2:12", language: "en" },
    exampleResponse: {
      reference: "TIT 2:12",
      language: "en",
      id: null,
      phrase: null,
      notes: [
        {
          book: "TIT",
          chapter: "2",
          verse: "12",
          id: "abc123",
          supportReference: "rc://*/ta/man/translate/figs-personification",
          supportReferenceTitle: "Personification",
          quote: "παιδεύουσα ἡμᾶς",
          occurrence: "1",
          note: "Here, **grace** is spoken of as if it were a person…",
          gatewayQuote: { original: "παιδεύουσα ἡμᾶς", aligned: "training us" },
        },
      ],
    },
    responseNotes: [
      "Pass `id` or `phrase` to filter; omit both to return all notes for the reference.",
      "Empty `notes: []` when none match.",
    ],
  },
  get_academy_article: {
    category: "workflow",
    summary: "Fetch a Translation Academy article by path.",
    example: { path: "translate/figs-metaphor", language: "en" },
    exampleResponse: {
      language: "en",
      path: "translate/figs-metaphor",
      title: "Metaphor",
      article: "# Metaphor\n\n### Description\nA metaphor…\n",
    },
  },
  get_word_article: {
    category: "workflow",
    summary: "Fetch a Translation Words article by path.",
    example: { path: "kt/grace", language: "en" },
    exampleResponse: {
      language: "en",
      path: "kt/grace",
      title: "grace, gracious",
      article: "# grace, gracious\n\n### Definition:\nThe word **grace**…\n",
    },
  },
  get_questions: {
    category: "workflow",
    summary: "Translation questions for a passage.",
    example: { reference: "TIT 2:12", language: "en" },
    exampleResponse: {
      reference: "TIT 2:12",
      language: "en",
      questions: [
        {
          id: "tq1",
          reference: "2:12",
          question: "What does God's grace train us to do?",
          response: "To reject ungodliness and worldly passions…",
        },
      ],
    },
    responseNotes: ["Empty `questions: []` when none exist."],
  },
  search_articles: {
    category: "workflow",
    summary: "Lexical search across TA and TW articles.",
    example: { query: "metaphor", language: "en" },
    exampleResponse: {
      query: "metaphor",
      language: "en",
      results: [
        {
          type: "ta",
          path: "translate/figs-metaphor",
          title: "Metaphor",
          snippet: "A metaphor is a figure of speech…",
          score: 12.4,
        },
      ],
    },
    responseNotes: ["Empty `results: []` when nothing matches."],
  },
  get_obs_story: {
    category: "obs",
    summary: "Open Bible Stories story text.",
    example: { reference: "1:1", language: "en" },
    exampleResponse: {
      reference: "1:1",
      language: "en",
      story: 1,
      frame: 1,
      title: "The Creation",
      text: "This is how God made everything…",
    },
  },
  get_obs_notes: {
    category: "obs",
    summary: "OBS translation notes for a story:frame.",
    example: { reference: "1:1", language: "en" },
    exampleResponse: {
      reference: "1:1",
      language: "en",
      notes: [
        {
          id: "obs-n1",
          reference: "1:1",
          quote: "God",
          note: "This refers to the one true God…",
        },
      ],
    },
  },
  get_obs_questions: {
    category: "obs",
    summary: "OBS translation questions for a story:frame.",
    example: { reference: "1:1", language: "en" },
    exampleResponse: {
      reference: "1:1",
      language: "en",
      questions: [
        {
          id: "obs-q1",
          reference: "1:1",
          question: "Who made everything?",
          response: "God",
        },
      ],
    },
  },
};

export interface McpToolDoc {
  name: string;
  description: string;
  category: ToolCategory;
  summary: string;
  example?: Record<string, unknown>;
  exampleResponse?: unknown;
  responseNotes?: string[];
  inputSchema: unknown;
  outputSchema?: unknown;
  surface: "mcp";
}

export interface McpPromptDoc {
  name: string;
  description: string;
  arguments: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpManifest {
  name: string;
  version: string;
  mcpEndpoint: string;
  description: string;
  /** How tool results are wrapped for MCP clients. */
  resultEnvelope: {
    description: string;
    example: unknown;
    notAvailableExample: unknown;
  };
  tools: McpToolDoc[];
  prompts: McpPromptDoc[];
}

function schemaOf(tool: { inputSchema: unknown }): unknown {
  try {
    return zodToJsonSchema(
      tool.inputSchema as Parameters<typeof zodToJsonSchema>[0],
      {
        $refStrategy: "none",
      },
    );
  } catch {
    return { type: "object" };
  }
}

function outputSchemaOf(tool: { outputSchema?: unknown }): unknown | undefined {
  if (!tool.outputSchema) return undefined;
  try {
    const raw = tool.outputSchema;
    // Tools may store a Zod shape map `{ field: z.string(), … }` (not z.object()).
    if (typeof raw === "object" && raw !== null && !("parse" in raw)) {
      const values = Object.values(raw as Record<string, unknown>);
      if (
        values.length > 0 &&
        values.every(
          (v) => v && typeof v === "object" && "parse" in (v as object),
        )
      ) {
        return zodToJsonSchema(z.object(raw as z.ZodRawShape), {
          $refStrategy: "none",
        });
      }
    }
    if (raw && typeof raw === "object" && "parse" in raw) {
      return zodToJsonSchema(raw as Parameters<typeof zodToJsonSchema>[0], {
        $refStrategy: "none",
      });
    }
    return raw;
  } catch {
    return tool.outputSchema;
  }
}

function toToolDoc(tool: {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}): McpToolDoc {
  const meta = TOOL_DOC_META[tool.name];
  return {
    name: tool.name,
    description: tool.description,
    category: meta?.category ?? "workflow",
    summary: meta?.summary ?? tool.description.split(".")[0] ?? tool.name,
    example: meta?.example,
    exampleResponse: meta?.exampleResponse,
    responseNotes: meta?.responseNotes,
    inputSchema: schemaOf(tool),
    outputSchema: outputSchemaOf(tool),
    surface: "mcp",
  };
}

export function buildMcpManifest(options?: {
  mcpEndpoint?: string;
}): McpManifest {
  const tools = MCP_TOOLS.map((t) => toToolDoc(t));

  const prompts: McpPromptDoc[] = PROMPTS.map((p) => ({
    name: p.name,
    description: p.description,
    arguments: Object.entries(p.argsSchema).map(([name, schema]) => {
      const s = schema as { description?: string; isOptional?: () => boolean };
      return {
        name,
        description: s.description,
        required: typeof s.isOptional === "function" ? !s.isOptional() : true,
      };
    }),
  }));

  return {
    name: "translation-helps-mcp",
    version: "2",
    mcpEndpoint: options?.mcpEndpoint ?? "/v2/mcp",
    description:
      "MCP tools and prompts for Bible translation helps. All tools call the REST Data API via ApiClient.",
    resultEnvelope: {
      description:
        "Successful tools return MCP `content` (text summary + JSON string) plus `structuredContent` (the authoritative object). Prefer `structuredContent` when your client supports it. Per-tool examples below show that object. Tools that declare an `outputSchema` include optional `available` / `code` / `message` / `hints` members so the RESOURCE_NOT_AVAILABLE envelope still validates (isError remains false). Execution errors use isError: true with details in content only — no structuredContent.",
      example: {
        content: [
          { type: "text", text: "3 version(s) for TIT 2:12" },
          { type: "text", text: '{"reference":"TIT 2:12","versions":[…]}' },
        ],
        structuredContent: {
          reference: "TIT 2:12",
          language: "en",
          versions: [],
        },
        isError: false,
      },
      notAvailableExample: {
        content: [
          {
            type: "text",
            text: '{"available":false,"code":"RESOURCE_NOT_AVAILABLE","message":"…"}',
          },
        ],
        structuredContent: {
          available: false,
          code: "RESOURCE_NOT_AVAILABLE",
          message:
            "No translation questions available for this reference or language.",
          hints: [
            "Run list_resources to see what is available for this language.",
          ],
        },
        isError: false,
      },
    },
    tools,
    prompts,
  };
}
