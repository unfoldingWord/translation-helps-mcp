# @translation-helps/mcp-client

TypeScript/JavaScript client for the Translation Helps MCP v2 server.

## Installation

```bash
npm install @translation-helps/mcp-client
```

## Usage

The server uses a **progressive-disclosure workflow** — call tools in order to
orient, survey, drill, and check a Bible passage.

```typescript
import { TranslationHelpsClient, parseResult } from "@translation-helps/mcp-client";

const client = new TranslationHelpsClient({
  // Optional — defaults to the public server
  serverUrl: "https://translation-helps-mcp.workers.dev/mcp",
});

// 1. Discover available languages
const langs = await client.listLanguages({ filter: "es" });

// 2a. Orient — scripture text (all versions, incl. original-language UGNT/UHB)
//     Cheap and repeatable; re-call any time you need the verse text.
const passage = await client.getPassage({
  reference: "JHN 3:16",
  language: "en",
});

// 2b. Orient — book/chapter background + which resources exist (no verse text)
const ctx = await client.getPassageContext({
  reference: "JHN 3:16",
  language: "en",
});

// 3. Survey — compact index of issues + key terms (no full bodies)
const index = await client.getPassageIndex({
  reference: "JHN 3:16",
  language: "en",
});

// 4. Drill — fetch specific items using IDs/paths from the index
const note = await client.getNote({
  reference: "JHN 3:16",
  id: "abc123",          // from index notes[].id
  language: "en",
});

const taArticle = await client.getAcademyArticle({
  path: "translate/figs-metaphor",   // from index notes[].taArticle.path
  language: "en",
});

const twArticle = await client.getWordArticle({
  path: "bible/kt/grace",            // from index wordLinks[].twArticle.path
  language: "en",
});

// 5. Check — comprehension questions to verify understanding
const questions = await client.getQuestions({
  reference: "JHN 3:16",
  language: "en",
});

// 6. Lateral discovery — find articles by concept
const hits = await client.searchArticles({
  query: "How should I translate figurative language?",
  language: "en",
  resourceTypes: ["ta"],
  topK: 5,
});
```

## API Reference

### Constructor

```typescript
new TranslationHelpsClient(options?: ClientOptions)
```

| Option      | Type                     | Default           | Description             |
| ----------- | ------------------------ | ----------------- | ----------------------- |
| `serverUrl` | `string`                 | Public server URL | MCP server endpoint     |
| `timeout`   | `number`                 | `90000`           | Request timeout (ms)    |
| `headers`   | `Record<string, string>` | `{}`              | Additional HTTP headers |

### Workflow Methods

All methods return `MCPToolResult`. Use `parseResult<T>(result)` to extract typed JSON.

#### Step 1 — Orient

| Method | Options | Description |
| ------ | ------- | ----------- |
| `listLanguages(opts?)` | `filter?` | Discover valid BCP-47 language codes |
| `getPassage(opts)` | `reference` (req), `language?` | Scripture text — all versions (literal, simplified, original UGNT/UHB). Cheap and repeatable. |
| `getPassageContext(opts)` | `reference` (req), `language?`, `organization?` | Book/chapter intro notes + resource availability. Does NOT include verse text (use `getPassage`). |

#### Step 2 — Survey

| Method | Options | Description |
| ------ | ------- | ----------- |
| `getPassageIndex(opts)` | `reference` (req), `language?`, `organization?` | Compact index: note IDs + quotes + TA/TW paths (no article bodies). Includes `issues[]` and `keyTerms[]` rollups. |

#### Step 3 — Drill

| Method | Options | Description |
| ------ | ------- | ----------- |
| `getNote(opts)` | `reference` (req), `id?`, `language?`, `organization?` | Full note body. Omit `id` to get all notes for the reference. |
| `getAcademyArticle(opts)` | `path` (req), `language?`, `organization?` | Full TA article markdown. Use `path` from index `taArticle.path`. |
| `getWordArticle(opts)` | `path` (req), `language?`, `organization?` | Full TW article markdown. Use `path` from index `twArticle.path`. |

#### Step 4 — Check

| Method | Options | Description |
| ------ | ------- | ----------- |
| `getQuestions(opts)` | `reference` (req), `language?`, `organization?` | Comprehension questions for a passage. |

#### Lateral Discovery

| Method | Options | Description |
| ------ | ------- | ----------- |
| `searchArticles(opts)` | `query` (req), `language?`, `resourceTypes?`, `topK?` | Lexical search over TA + TW article catalogs. Returns ranked paths. |

### Legacy Methods (deprecated)

These remain for backward compatibility but should be migrated to the workflow methods above.

| Legacy Method | Use Instead |
| ------------- | ----------- |
| `fetchScripture(opts)` | `getPassage` |
| `fetchTranslationNotes(opts)` | `getNote` |
| `fetchTranslationQuestions(opts)` | `getQuestions` |
| `fetchTranslationWordLinks(opts)` | `getPassageIndex` |
| `fetchTranslationWord(opts)` | `getWordArticle` |
| `fetchTranslationAcademy(opts)` | `getAcademyArticle` |
| `getBundle(opts)` | `getPassageContext` + `getPassageIndex` |

### Parsing Results

```typescript
import { parseResult } from "@translation-helps/mcp-client";

const result = await client.getPassageContext({ reference: "JHN 3:16" });
if (result.isError) {
  const error = parseResult<{ code: string; message: string; hints: string[] }>(result);
  console.error(error.code, error.message);
} else {
  const data = parseResult<{ versions: unknown[]; notes: unknown[] }>(result);
  console.log(data.versions);
}
```

Error codes: `INVALID_REFERENCE`, `INVALID_LANGUAGE`, `RESOURCE_NOT_FOUND`, `UPSTREAM_DCS_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`.

### Transport

The client uses **Streamable HTTP** — a single POST to `/mcp` that returns either JSON or a `text/event-stream`. This is the standard MCP transport for remote servers.

## License

MIT
