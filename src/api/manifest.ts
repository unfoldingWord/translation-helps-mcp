/**
 * REST API endpoint manifest — single source of truth for /docs/api.
 *
 * Served at GET /api/v1/_manifest. Keep in sync when adding/changing routes.
 */

export interface ApiParamDoc {
  name: string;
  in: "query" | "path";
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: string | number | boolean;
  description: string;
  example?: string | number | boolean;
}

export interface ApiEndpointDoc {
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  /** Door43 subjects / sources this endpoint adapts. */
  adapts: string[];
  params: ApiParamDoc[];
  exampleRequest: string;
  /** Representative JSON body (200 OK). */
  exampleResponse?: unknown;
  /** Notes about alternate shapes (empty arrays, errors, 202, etc.). */
  responseNotes?: string[];
}

export interface ApiManifest {
  name: string;
  version: string;
  basePath: string;
  description: string;
  library: string;
  endpoints: ApiEndpointDoc[];
}

const REF: ApiParamDoc = {
  name: "reference",
  in: "query",
  type: "string",
  required: true,
  description: 'Bible reference, e.g. "TIT 2:12", "JHN 3:16", "MAT 5:3-12".',
  example: "TIT 2:12",
};

const LANG: ApiParamDoc = {
  name: "language",
  in: "query",
  type: "string",
  required: true,
  description: 'BCP-47 language code, e.g. "en", "es", "es-419".',
  example: "en",
};

const OBS_REF: ApiParamDoc = {
  name: "reference",
  in: "query",
  type: "string",
  required: true,
  description: 'OBS reference — "1:1", "1:0" (intro), "front", or "obs 1:1".',
  example: "1:1",
};

const META_NOTES = [
  "`meta.cache` is one of: kv | r2 | miss | stale (when present).",
  "On failure: `{ error: string, code?: string, requestId?: string }` with 4xx/5xx.",
];

export const API_MANIFEST: ApiManifest = {
  name: "translation-helps-api",
  version: "1",
  basePath: "/api/v1",
  description:
    "REST adapter over Door43 / DCS resources. Owns KV/R2 caching, USFM/TSV parsing, and quote alignment. Consumed by the MCP worker via a service binding.",
  library: "@translation-helps/door43",
  endpoints: [
    {
      method: "GET",
      path: "/languages",
      summary: "List tc-ready languages",
      description:
        "Returns languages that have translationCore-ready resources in the Door43 catalog.",
      adapts: ["Door43 Catalog API /languages"],
      params: [],
      exampleRequest: "/api/v1/languages",
      exampleResponse: {
        languages: [
          { code: "en", name: "English", direction: "ltr" },
          { code: "es-419", name: "Español (Latinoamérica)", direction: "ltr" },
        ],
      },
    },
    {
      method: "GET",
      path: "/scripture",
      summary: "Scripture text for a reference",
      description:
        "Returns scripture versions for a reference. By default one literal, one simplified, and the original language text. Pass all=1 for every available version.",
      adapts: [
        "Aligned Bible",
        "Simplified Bible",
        "Hebrew Bible",
        "Greek New Testament",
      ],
      params: [
        REF,
        LANG,
        {
          name: "format",
          in: "query",
          type: "string",
          default: "plain",
          description: '"plain" (stripped) or "usfm".',
          example: "plain",
        },
        {
          name: "all",
          in: "query",
          type: "boolean",
          default: false,
          description: "When true, return every matching scripture version.",
        },
      ],
      exampleRequest: "/api/v1/scripture?reference=TIT%202:12&language=en",
      exampleResponse: {
        reference: "TIT 2:12",
        language: "en",
        book: "TIT",
        chapter: "2",
        verse: "12",
        format: "plain",
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
        meta: { cache: "kv", timings: { totalMs: 42 } },
      },
      responseNotes: [
        '`role` is one of: "literal" | "simplified" | "original" (and sometimes others when all=1).',
        "With all=1, `versions` may include every catalog match (e.g. multiple gateway Bibles).",
        ...META_NOTES,
      ],
    },
    {
      method: "GET",
      path: "/notes",
      summary: "Translation Notes",
      description:
        "TSV Translation Notes for a reference, with resolved TA article titles and optional quote alignment.",
      adapts: ["TSV Translation Notes", "Translation Academy (titles)"],
      params: [REF, LANG],
      exampleRequest: "/api/v1/notes?reference=TIT%202:12&language=en",
      exampleResponse: {
        reference: "TIT 2:12",
        language: "en",
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
            note: "Here, **grace** is spoken of as if it were a person who trains us…",
            gatewayQuote: {
              original: "παιδεύουσα ἡμᾶς",
              aligned: "training us",
            },
          },
        ],
        meta: { cache: "kv" },
      },
      responseNotes: [
        "Includes intro notes (verse `intro` / chapter `front`) when present for the book/chapter.",
        "Empty `notes: []` means none for that reference — not an error.",
        ...META_NOTES,
      ],
    },
    {
      method: "GET",
      path: "/word-links",
      summary: "Translation Word Links",
      description:
        "TSV Translation Word Links for a reference, with TW article titles.",
      adapts: ["TSV Translation Words Links", "Translation Words (titles)"],
      params: [REF, LANG],
      exampleRequest: "/api/v1/word-links?reference=TIT%202:12&language=en",
      exampleResponse: {
        reference: "TIT 2:12",
        language: "en",
        wordLinks: [
          {
            book: "TIT",
            chapter: "2",
            verse: "12",
            id: "def456",
            twLink: "rc://*/tw/dict/bible/kt/righteous",
            twTitle: "righteous, righteousness",
            origWords: "δικαίως",
            occurrence: "1",
            gatewayQuote: { original: "δικαίως", aligned: "righteous" },
          },
        ],
        meta: { cache: "kv" },
      },
      responseNotes: ["Empty `wordLinks: []` when none exist.", ...META_NOTES],
    },
    {
      method: "GET",
      path: "/questions",
      summary: "Translation Questions",
      description: "TSV Translation Questions for a reference.",
      adapts: ["TSV Translation Questions"],
      params: [REF, LANG],
      exampleRequest: "/api/v1/questions?reference=TIT%202:12&language=en",
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
        meta: { cache: "kv" },
      },
      responseNotes: ["Empty `questions: []` when none exist.", ...META_NOTES],
    },
    {
      method: "GET",
      path: "/words",
      summary: "List Translation Words articles",
      description: "Catalog of TW article paths/titles for a language.",
      adapts: ["Translation Words"],
      params: [LANG],
      exampleRequest: "/api/v1/words?language=en",
      exampleResponse: {
        language: "en",
        articles: [
          { path: "kt/grace", title: "grace, gracious", category: "kt" },
          { path: "other/angel", title: "angel, archangel", category: "other" },
        ],
      },
    },
    {
      method: "GET",
      path: "/words/{path}",
      summary: "Fetch a Translation Word article",
      description: "Full markdown body for a TW article path (e.g. kt/grace).",
      adapts: ["Translation Words"],
      params: [
        LANG,
        {
          name: "path",
          in: "path",
          type: "string",
          required: true,
          description: "Article path, e.g. kt/grace or other/angel.",
          example: "kt/grace",
        },
      ],
      exampleRequest: "/api/v1/words/kt/grace?language=en",
      exampleResponse: {
        language: "en",
        path: "kt/grace",
        title: "grace, gracious",
        article: "# grace, gracious\n\n### Definition:\nThe word **grace**…\n",
      },
      responseNotes: ["404 when the path does not exist for that language."],
    },
    {
      method: "GET",
      path: "/academy",
      summary: "List Translation Academy articles",
      description: "Catalog of TA article paths/titles for a language.",
      adapts: ["Translation Academy"],
      params: [LANG],
      exampleRequest: "/api/v1/academy?language=en",
      exampleResponse: {
        language: "en",
        articles: [
          {
            path: "translate/figs-metaphor",
            title: "Metaphor",
            category: "translate",
          },
        ],
      },
    },
    {
      method: "GET",
      path: "/academy/{path}",
      summary: "Fetch a Translation Academy article",
      description: "Full markdown body for a TA article path.",
      adapts: ["Translation Academy"],
      params: [
        LANG,
        {
          name: "path",
          in: "path",
          type: "string",
          required: true,
          description: "Article path, e.g. translate/figs-metaphor.",
          example: "translate/figs-metaphor",
        },
      ],
      exampleRequest: "/api/v1/academy/translate/figs-metaphor?language=en",
      exampleResponse: {
        language: "en",
        path: "translate/figs-metaphor",
        title: "Metaphor",
        article: "# Metaphor\n\n### Description\nA metaphor…\n",
      },
      responseNotes: ["404 when the path does not exist for that language."],
    },
    {
      method: "GET",
      path: "/quote",
      summary: "Align a quote to original + gateway text",
      description:
        "Token-level quote matching against original-language USFM and an aligned gateway (ULT/GLT).",
      adapts: ["Aligned Bible", "Hebrew Bible / Greek NT"],
      params: [
        REF,
        LANG,
        {
          name: "quote",
          in: "query",
          type: "string",
          required: true,
          description:
            "Source-language quote string (may use & for discontinuous spans).",
        },
        {
          name: "occurrence",
          in: "query",
          type: "number",
          default: 1,
          description: "1-based occurrence of the quote in the verse.",
        },
      ],
      exampleRequest:
        "/api/v1/quote?reference=TIT%202:12&language=en&quote=%CE%B3%CE%AC%CF%81&occurrence=1",
      exampleResponse: {
        reference: "TIT 2:12",
        language: "en",
        quote: "γάρ",
        occurrence: 1,
        match: {
          original: "γάρ",
          aligned: "for",
          ok: true,
        },
      },
      responseNotes: [
        "When the quote cannot be matched, `match.ok` is false and aligned text may be empty.",
      ],
    },
    {
      method: "GET",
      path: "/search",
      summary: "Lexical search of TA/TW articles",
      description:
        "Ranked keyword search across Translation Academy and Translation Words.",
      adapts: ["Translation Academy", "Translation Words"],
      params: [
        {
          name: "q",
          in: "query",
          type: "string",
          required: true,
          description: "Search query.",
          example: "metaphor",
        },
        LANG,
        {
          name: "type",
          in: "query",
          type: "string",
          description: 'Optional filter: "ta" or "tw".',
        },
      ],
      exampleRequest: "/api/v1/search?q=metaphor&language=en",
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
    {
      method: "GET",
      path: "/resources",
      summary: "Resource availability for a language/reference",
      description:
        "Catalog-only summary of which scripture and helps resources exist (no ZIP downloads).",
      adapts: ["Door43 Catalog API"],
      params: [REF, LANG],
      exampleRequest: "/api/v1/resources?reference=TIT%202:12&language=en",
      exampleResponse: {
        language: "en",
        requestedLanguage: "en",
        available: [
          {
            type: "scripture",
            subject: "Aligned Bible",
            abbreviation: "ult",
            role: "literal",
          },
          {
            type: "notes",
            subject: "TSV Translation Notes",
            abbreviation: "tn",
            role: "notes",
          },
        ],
        requestId: "req_…",
      },
      responseNotes: [
        "`language` may differ from `requestedLanguage` when a variant is resolved (e.g. es → es-419).",
        "Optional `book` / `reference` filters book-scoped resources missing that book.",
        "Entries may include `books` / `bookCount` / `warning` for partial coverage; see `coverage.note`.",
      ],
    },
    {
      method: "GET",
      path: "/prefetch",
      summary: "Warm caches for a passage",
      description:
        "Returns 202 and warms notes/word-links/questions in the background via waitUntil. Also accepts POST.",
      adapts: ["Translation Notes", "Word Links", "Questions"],
      params: [REF, LANG],
      exampleRequest: "/api/v1/prefetch?reference=TIT%202:12&language=en",
      exampleResponse: {
        status: "accepted",
        reference: "TIT 2:12",
        language: "en",
      },
      responseNotes: [
        "HTTP 202 Accepted — body confirms the warm job was queued.",
      ],
    },
    {
      method: "GET",
      path: "/obs",
      summary: "Open Bible Stories story text",
      description: "OBS story frames for a story:frame reference.",
      adapts: ["Open Bible Stories"],
      params: [OBS_REF, LANG],
      exampleRequest: "/api/v1/obs?reference=1:1&language=en",
      exampleResponse: {
        reference: "1:1",
        language: "en",
        story: 1,
        frame: 1,
        title: "The Creation",
        text: "This is how God made everything…",
        frames: [{ frame: 1, text: "This is how God made everything…" }],
      },
    },
    {
      method: "GET",
      path: "/obs-notes",
      summary: "OBS translation notes",
      description: "Translation notes for an OBS story:frame.",
      adapts: ["OBS Translation Notes"],
      params: [OBS_REF, LANG],
      exampleRequest: "/api/v1/obs-notes?reference=1:1&language=en",
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
    {
      method: "GET",
      path: "/obs-questions",
      summary: "OBS translation questions",
      description: "Translation questions for an OBS story:frame.",
      adapts: ["OBS Translation Questions"],
      params: [OBS_REF, LANG],
      exampleRequest: "/api/v1/obs-questions?reference=1:1&language=en",
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
  ],
};
