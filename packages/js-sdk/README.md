# @translation-helps/mcp-client

TypeScript/JavaScript client for the Translation Helps MCP v2 server.

## Installation

```bash
npm install @translation-helps/mcp-client
```

## Usage

```typescript
import { TranslationHelpsClient } from "@translation-helps/mcp-client";

const client = new TranslationHelpsClient({
  // Optional — defaults to the public server
  serverUrl: "https://translation-helps-mcp.workers.dev/mcp",
});

// Fetch scripture
const scripture = await client.fetchScripture({
  reference: "JHN 3:16",
  language: "en",
  resourceType: "ult",
});
console.log(scripture);

// Get all translation helps for a passage
const bundle = await client.getBundle({
  reference: "JHN 3:16",
  language: "en",
});

// Semantic search
const results = await client.ragQuery({
  query: "How should I translate figurative language?",
  language: "en",
  resourceTypes: ["ta", "tn"],
  topK: 5,
});

// List available languages
const languages = await client.listLanguages();

// Fetch a translation word article
const word = await client.fetchTranslationWord({
  path: "bible/kt/grace", // preferred: use path from fetchTranslationWordLinks
  language: "en",
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

### Methods

All methods return typed results from the MCP server.

| Method                            | Description                         |
| --------------------------------- | ----------------------------------- |
| `fetchScripture(opts)`            | Fetch Bible text                    |
| `fetchTranslationNotes(opts)`     | Fetch translation notes             |
| `fetchTranslationQuestions(opts)` | Fetch comprehension questions       |
| `fetchTranslationWordLinks(opts)` | Fetch word links for a reference    |
| `fetchTranslationWord(opts)`      | Fetch a dictionary article          |
| `fetchTranslationAcademy(opts)`   | Fetch a Translation Academy article |
| `listLanguages(opts?)`            | List available languages            |
| `listSubjects(opts?)`             | List available resource subjects    |
| `listResourcesForLanguage(opts)`  | List resources for a language       |
| `ragQuery(opts)`                  | Semantic search                     |
| `getBundle(opts)`                 | Get all helps for a passage         |
| `indexResource(opts)`             | Index a resource (admin)            |
| `callTool(name, args)`            | Raw tool call                       |

### Transport

The client uses **Streamable HTTP** — a single POST to `/mcp` that returns either JSON or a `text/event-stream`. This is the standard MCP transport for remote servers.

## Error Handling

The server returns structured errors with machine-readable codes:

```typescript
import { parseResult } from "@translation-helps/mcp-client";

const result = await client.callTool("fetch_scripture", {
  reference: "invalid",
});
if (result.isError) {
  const error = parseResult<{ code: string; message: string; hints: string[] }>(
    result,
  );
  console.error(error.code, error.message);
}
```

Error codes: `INVALID_REFERENCE`, `INVALID_LANGUAGE`, `RESOURCE_NOT_FOUND`, `UPSTREAM_DCS_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## License

MIT
