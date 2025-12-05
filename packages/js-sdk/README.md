# @translation-helps/mcp-client

Official TypeScript/JavaScript client SDK for the Translation Helps MCP Server.

## Installation

```bash
npm install @translation-helps/mcp-client
```

### Browser Usage

The SDK is **fully compatible with browsers**! It uses standard Web APIs (`fetch`, `AbortController`) and has no Node.js dependencies.

**Using a bundler (recommended):**

```typescript
import { TranslationHelpsClient } from "@translation-helps/mcp-client";

const client = new TranslationHelpsClient();
await client.connect();
```

**Using a CDN (alternative):**

```html
<script type="module">
  // Import from CDN (when published)
  import { TranslationHelpsClient } from "https://cdn.jsdelivr.net/npm/@translation-helps/mcp-client/dist/index.js";

  const client = new TranslationHelpsClient();
  await client.connect();
</script>
```

**Note:** The SDK works in both Node.js and browser environments. No special configuration needed!

## Quick Start

```typescript
import { TranslationHelpsClient } from "@translation-helps/mcp-client";
// Import your AI provider's SDK
// import Anthropic from '@anthropic-ai/sdk';

// Create a client instance
const mcpClient = new TranslationHelpsClient({
  serverUrl: "https://tc-helps.mcp.servant.bible/api/mcp",
});

await mcpClient.connect();

// Get available tools and prompts
const tools = await mcpClient.listTools();
const prompts = await mcpClient.listPrompts();

// Convert to your AI provider's format
const availableTools = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema,
}));

// Note: Prompts provide instructions/templates - refer to your provider's docs for usage

// Send user query to AI WITH available tools
// The AI will decide which tools to call!
// const response = await aiClient.messages.create({
//   model: 'your-model',
//   messages: [{ role: 'user', content: 'What does John 3:16 say?' }],
//   tools: availableTools
// });

// When AI requests a tool call, execute it via SDK:
// const result = await mcpClient.callTool(toolName, toolArgs);
// Feed result back to AI for final response
```

## API Reference

### `TranslationHelpsClient`

Main client class for interacting with the Translation Helps MCP server.

#### Constructor

```typescript
new TranslationHelpsClient(options?: ClientOptions)
```

**Options:**

- `serverUrl?: string` - Server URL (default: production server)
- `timeout?: number` - Request timeout in ms (default: 30000)
- `headers?: Record<string, string>` - Custom headers
- `enableMetrics?: boolean` - Enable metrics collection (response headers, timing, X-Ray traces). Useful for development/debugging (default: false)

#### Methods

##### `connect(): Promise<void>`

Initialize connection to the MCP server. Automatically called by convenience methods.

##### `fetchScripture(options): Promise<string>`

Fetch Bible scripture text.

```typescript
const text = await client.fetchScripture({
  reference: "John 3:16",
  language: "en",
  organization: "unfoldingWord",
  format: "text", // or 'usfm'
  includeVerseNumbers: true,
});
```

##### `fetchTranslationNotes(options): Promise<any>`

Fetch translation notes for a passage.

```typescript
const notes = await client.fetchTranslationNotes({
  reference: "John 3:16",
  language: "en",
  includeIntro: true,
  includeContext: true,
});
```

##### `fetchTranslationQuestions(options): Promise<any>`

Fetch translation questions for a passage.

```typescript
const questions = await client.fetchTranslationQuestions({
  reference: "John 3:16",
  language: "en",
});
```

##### `fetchTranslationWord(options): Promise<any>`

Fetch translation word article by term or reference.

```typescript
// By term
const word = await client.fetchTranslationWord({
  term: "love",
  language: "en",
});

// By reference (gets words used in passage)
const words = await client.fetchTranslationWord({
  reference: "John 3:16",
  language: "en",
});
```

##### `fetchTranslationWordLinks(options): Promise<any>`

Fetch translation word links for a passage.

```typescript
const links = await client.fetchTranslationWordLinks({
  reference: "John 3:16",
  language: "en",
});
```

##### `fetchTranslationAcademy(options): Promise<any>`

Fetch translation academy articles.

```typescript
const articles = await client.fetchTranslationAcademy({
  reference: "John 3:16",
  language: "en",
  format: "json", // or 'markdown'
});
```

##### `searchTranslationWordAcrossLanguages(options): Promise<any>`

Search for a translation word term across multiple languages to discover which languages have that term available. Useful when a term is not found in the current language or when you want to find all languages that have a specific term.

```typescript
const results = await client.searchTranslationWordAcrossLanguages({
  term: "love",
  languages: ["en", "es-419", "fr"], // optional: specific languages to search
  organization: "unfoldingWord", // optional, defaults to "unfoldingWord"
  limit: 20, // optional, defaults to 20
});

console.log(results.results); // Array of { language, organization, found, ... }
```

##### `getLanguages(options?): Promise<any>`

Get available languages and organizations.

```typescript
const languages = await client.getLanguages({
  organization: "unfoldingWord",
});
```

##### `listTools(): Promise<MCPTool[]>`

List all available MCP tools.

##### `listPrompts(): Promise<MCPPrompt[]>`

List all available MCP prompts.

##### `callTool(name, arguments): Promise<MCPResponse>`

Call any MCP tool directly.

## Metrics & Debugging

When `enableMetrics` is enabled in the client options, responses include a `metadata` field with diagnostic information:

```typescript
const client = new TranslationHelpsClient({
  enableMetrics: true, // Enable metrics collection for development
});

const response = await client.callTool("fetch_translation_notes", {
  reference: "John 3:16",
});

// Access metrics
if (response.metadata) {
  console.log("Response time:", response.metadata.responseTime, "ms");
  console.log("Cache status:", response.metadata.cacheStatus);
  console.log("Trace ID:", response.metadata.traceId);
  console.log("X-Ray trace:", response.metadata.xrayTrace);
  console.log("All headers:", response.metadata.headers);
}
```

**Available Metrics:**

- `responseTime` - Response time in milliseconds
- `cacheStatus` - Cache status (hit/miss/bypass)
- `traceId` - Trace ID for debugging
- `xrayTrace` - X-Ray trace data (decoded from header)
- `statusCode` - HTTP status code
- `headers` - All response headers

**Note:** Metrics are only available when `enableMetrics: true` is set in the client options. This is useful for development and debugging but adds minimal overhead.

##### `getPrompt(name, arguments?): Promise<MCPResponse>`

Get a prompt template.

## Examples

### Basic Usage

```typescript
import { TranslationHelpsClient } from "@translation-helps/mcp-client";

const client = new TranslationHelpsClient();
await client.connect();

// Fetch scripture
const scripture = await client.fetchScripture({
  reference: "John 3:16",
});

// Fetch comprehensive helps
const notes = await client.fetchTranslationNotes({
  reference: "John 3:16",
});

const questions = await client.fetchTranslationQuestions({
  reference: "John 3:16",
});

const words = await client.fetchTranslationWord({
  reference: "John 3:16",
});
```

### Error Handling

```typescript
try {
  const scripture = await client.fetchScripture({
    reference: "John 3:16",
  });
} catch (error) {
  console.error("Failed to fetch scripture:", error);
}
```

### Custom Server URL

```typescript
const client = new TranslationHelpsClient({
  serverUrl: "https://your-custom-server.com/api/mcp",
  timeout: 60000, // 60 seconds
});
```

## Optimized System Prompts

The SDK includes optimized, contextual system prompts for AI interactions with Translation Helps data. These prompts reduce token usage by 60-70% while maintaining all critical functionality.

### Usage

```typescript
import {
  getSystemPrompt,
  detectRequestType,
} from "@translation-helps/mcp-client";

// Auto-detect request type and get optimized prompt
const prompt = getSystemPrompt(undefined, endpointCalls, message);

// Or manually specify request type
const prompt = getSystemPrompt("comprehensive");

// Use in OpenAI call
const messages = [
  { role: "system", content: prompt },
  { role: "user", content: message },
];
```

### Request Types

- `comprehensive`: Uses translation-helps-for-passage prompt
- `list`: User wants concise lists
- `explanation`: User wants detailed explanations
- `term`: User asking about translation words
- `concept`: User asking about translation concepts
- `default`: Fallback

### Benefits

- **60-70% token reduction** compared to legacy prompts
- **Contextual rules** injected based on request type
- **Automatic detection** from endpoint calls and message patterns
- **Type-safe** with full TypeScript support

### Discovery Methods

#### `listLanguages(options?): Promise<any>`

List all available languages from Door43 catalog (~1 second).

```typescript
const languages = await client.listLanguages({
  organization: "unfoldingWord", // or omit for all orgs
  stage: "prod",
});

console.log(languages.languages); // Array of language objects
```

#### `listSubjects(options?): Promise<any>`

List all available resource subjects/types from Door43 catalog.

```typescript
const subjects = await client.listSubjects({
  language: "en",
  organization: "unfoldingWord",
  stage: "prod",
});

console.log(subjects.subjects); // Array of subject objects
```

#### `listResourcesByLanguage(options?): Promise<any>`

List resources organized by language. Makes multiple parallel API calls (~4-5s first time, cached afterward).

```typescript
const resourcesByLang = await client.listResourcesByLanguage({
  subjects: ["Translation Words", "Translation Academy"], // or omit for defaults
  organization: "", // empty = all orgs
  stage: "prod",
  limit: 100,
  topic: "tc-ready", // optional: filter for production-ready resources
});

console.log(resourcesByLang.resourcesByLanguage); // Array grouped by language
```

#### `listResourcesForLanguage(options): Promise<any>` ⭐ RECOMMENDED

List all resources for a specific language. Fast single API call (~1-2 seconds).

```typescript
// Discover what's available for Spanish (es-419)
const resources = await client.listResourcesForLanguage({
  language: "es-419",
  organization: "", // empty = all orgs (includes es-419_gl, unfoldingWord, etc.)
  topic: "tc-ready", // optional: production-ready only
});

console.log(
  `Found ${resources.totalResources} resources from ${resources.metadata.organizations} orgs`,
);
console.log(resources.subjects); // Array of subject names
console.log(resources.resourcesBySubject); // Resources grouped by type
```

**Recommended Discovery Workflow:**

```typescript
// Step 1: Discover available languages (~1s)
const langs = await client.listLanguages();
console.log(
  "Available languages:",
  langs.languages.map((l) => l.code),
);

// Step 2: Get resources for chosen language (~1-2s)
const spanishResources = await client.listResourcesForLanguage({
  language: "es-419",
  topic: "tc-ready", // optional: quality-filtered
});

// Step 3: Fetch specific resources
const scripture = await client.fetchScripture({
  reference: "John 3:16",
  language: "es-419",
  organization: "es-419_gl",
});
```

## TypeScript Support

This package includes full TypeScript definitions. All types are exported for your convenience:

```typescript
import type {
  MCPTool,
  MCPPrompt,
  ClientOptions,
  FetchScriptureOptions,
  ListResourcesForLanguageOptions,
  ListResourcesByLanguageOptions,
  RequestType,
  EndpointCall,
  // ... other types
} from "@translation-helps/mcp-client";
```

## License

MIT

## Links

- [Documentation](https://tc-helps.mcp.servant.bible)
- [GitHub Repository](https://github.com/unfoldingWord/translation-helps-mcp)
- [MCP Protocol](https://modelcontextprotocol.io)
