# Translation Helps MCP - Available Tools & Prompts

## 📋 MCP Server Tools (9 Active)

All tools are available via:

- **MCP stdio transport** (for MCP clients)
- **HTTP MCP endpoint** (`/api/mcp`) - JSON-RPC 2.0 format
- **REST API endpoints** (individual endpoints for each tool)

### Content Fetching Tools (6)

#### 1. `fetch_scripture`

- **Description**: Fetch Bible scripture text for a specific reference
- **Parameters**:
  - `reference` (required): Bible reference (e.g., "John 3:16", "Genesis 1:1-3")
  - `language` (optional, default: "en"): Language code
  - `organization` (optional, default: "unfoldingWord"): Organization
  - `includeVerseNumbers` (optional, default: true): Include verse numbers
  - `format` (optional, default: "json"): Output format (text, usfm, json, md, markdown)
  - `resource` (optional, default: "all"): Resource type(s) - ult, ust, t4t, ueb, or "all"
  - `includeAlignment` (optional, default: false): Include word alignment data (USFM only)
- **REST API**: `GET /api/fetch-scripture`
- **File**: `src/tools/fetchScripture.ts`

#### 2. `fetch_translation_notes`

- **Description**: Fetch translation notes for a specific Bible reference
- **Parameters**:
  - `reference` (required): Bible reference
  - `language` (optional, default: "en"): Language code
  - `organization` (optional, default: "unfoldingWord"): Organization
  - `includeIntro` (optional, default: true): Include book/chapter introductions
  - `includeContext` (optional, default: true): Include contextual notes
  - `format` (optional, default: "json"): Output format
- **REST API**: `GET /api/fetch-translation-notes`
- **File**: `src/tools/fetchTranslationNotes.ts`

#### 3. `fetch_translation_questions`

- **Description**: Fetch translation questions for a specific Bible reference
- **Parameters**:
  - `reference` (required): Bible reference
  - `language` (optional, default: "en"): Language code
  - `organization` (optional, default: "unfoldingWord"): Organization
  - `format` (optional, default: "json"): Output format
- **REST API**: `GET /api/fetch-translation-questions`
- **File**: `src/tools/fetchTranslationQuestions.ts`

#### 4. `fetch_translation_word_links`

- **Description**: Fetch translation word links (TWL) for a specific Bible reference
- **Parameters**:
  - `reference` (required): Bible reference
  - `language` (optional, default: "en"): Language code
  - `organization` (optional, default: "unfoldingWord"): Organization
  - `format` (optional, default: "json"): Output format
- **REST API**: `GET /api/fetch-translation-word-links`
- **File**: `src/tools/fetchTranslationWordLinks.ts`

#### 5. `fetch_translation_word`

- **Description**: Fetch translation word articles for biblical terms. Can search by term name (e.g., 'grace', 'paul', 'god', 'faith'), path, rcLink, or Bible reference. Use term parameter for questions like 'Who is Paul?' or 'What is grace?'
- **Parameters**:
  - `term` (optional): Translation word term to lookup (e.g., "love", "grace", "salvation")
  - `path` (optional): Explicit path to resource file (e.g., "bible/kt/love.md")
  - `rcLink` (optional): RC link to resource (e.g., "rc://\*/tw/dict/bible/kt/love")
  - `reference` (optional): Bible reference (e.g., "John 3:16")
  - `language` (optional, default: "en"): Language code
  - `organization` (optional, default: "unfoldingWord"): Organization
  - `category` (optional): Filter by category (kt, names, other) - only used with reference
- **REST API**: `GET /api/fetch-translation-word`
- **File**: `src/tools/getTranslationWord.ts`

#### 6. `fetch_translation_academy`

- **Description**: Fetch translation academy (tA) modules and training content
- **Parameters**:
  - `moduleId` (optional): Academy module ID (e.g., "figs-metaphor")
  - `path` (optional): Explicit path to resource file
  - `rcLink` (optional): RC link to resource
  - `language` (optional, default: "en"): Language code
  - `organization` (optional, default: "unfoldingWord"): Organization
  - `format` (optional, default: "json"): Output format
- **REST API**: `GET /api/fetch-translation-academy`
- **File**: `src/tools/fetchTranslationAcademy.ts`

### Discovery Tools (3)

#### 7. `list_languages`

- **Description**: List all available languages from the Door43 catalog. Returns structured language data (codes, names, display names) that can be directly reused as language parameters in other tools. Optionally filter by organization.
- **Parameters**:
  - `organization` (optional): Filter languages by organization (e.g., "unfoldingWord")
  - `stage` (optional, default: "prod"): Resource stage
- **REST API**: `GET /api/list-languages`
- **File**: `src/tools/listLanguages.ts`

#### 8. `list_subjects`

- **Description**: List all available resource subjects (resource types) from the Door43 catalog. Returns structured subject data (names, descriptions, resource types) that can be used to discover what resource types are available. Optionally filter by language and/or organization.
- **Parameters**:
  - `language` (optional): Filter subjects by language code (e.g., "en", "es-419")
  - `organization` (optional): Filter subjects by organization
  - `stage` (optional, default: "prod"): Resource stage
- **REST API**: `GET /api/list-subjects`
- **File**: `src/tools/listSubjects.ts`

#### 9. `list_resources_for_language` ⭐ RECOMMENDED

- **Description**: RECOMMENDED: List all available resources for a specific language. Fast single API call (~1-2 seconds). Given a language code (e.g., 'en', 'fr', 'es-419'), returns all resources available in that language organized by subject/resource type. Suggested workflow: 1) Use list_languages to discover available languages (~1s), 2) Use this tool to see what resources exist for a chosen language (~1-2s), 3) Use specific fetch tools to get the actual content.
- **Parameters**:
  - `language` (required): Language code (e.g., "en", "es", "fr", "es-419")
  - `organization` (optional): Organization(s) to filter by (string or array)
  - `stage` (optional, default: "prod"): Resource stage
  - `subject` (optional): Comma-separated list or array of subjects. If not provided, searches 7 default subjects: Bible, Aligned Bible, Translation Words, Translation Academy, TSV Translation Notes, TSV Translation Questions, and TSV Translation Words Links.
  - `limit` (optional): Maximum number of resources to return (1-10000)
  - `topic` (optional, default: "tc-ready"): Filter by topic tag (e.g., "tc-ready" for translationCore-ready resources)
- **REST API**: `GET /api/list-resources-for-language`
- **File**: `src/tools/listResourcesForLanguage.ts`

---

## 🎯 MCP Server Prompts (5 Active)

Prompts are available via:

- **MCP stdio transport** (for MCP clients)
- **HTTP MCP endpoint** (`/api/mcp`) - JSON-RPC 2.0 format
- **REST API**: `POST /api/execute-prompt`

### 1. `translation-helps-for-passage`

- **Description**: Get comprehensive translation help for a Bible passage: scripture text, questions, word definitions (with titles), notes, and related academy articles
- **Parameters**:
  - `reference` (required): Bible reference (e.g., "John 3:16", "Genesis 1:1-3")
  - `language` (optional, default: "en"): Language code
- **Use Case**: Comprehensive learning/translation requests
- **What it does**: Chains multiple tools to provide complete translation help for a passage

### 2. `get-translation-words-for-passage`

- **Description**: Get all translation word definitions for a passage, showing dictionary entry titles (not technical term IDs)
- **Parameters**:
  - `reference` (required): Bible reference (e.g., "John 3:16")
  - `language` (optional, default: "en"): Language code
- **Use Case**: When user specifically asks for key terms/word definitions for a passage

### 3. `get-translation-academy-for-passage`

- **Description**: Get Translation Academy training articles referenced in the translation notes for a passage
- **Parameters**:
  - `reference` (required): Bible reference (e.g., "John 3:16")
  - `language` (optional, default: "en"): Language code
- **Use Case**: When user specifically asks for translation concepts/techniques for a passage

### 4. `discover-resources-for-language`

- **Description**: Discover what translation resources are available for a specific language. Shows available languages (if not specified), available resource types for that language, and provides example tool calls using the discovered language parameter.
- **Parameters**:
  - `language` (optional): Language code (e.g., "en", "es-419"). If not provided, will show all available languages first.
  - `organization` (optional, default: "unfoldingWord"): Organization
- **Use Case**: Resource discovery workflow

### 5. `discover-languages-for-subject`

- **Description**: Discover which languages have a specific resource type (subject) available. Shows available subjects (if not specified), then lists languages that have that resource type, and provides example tool calls using the discovered languages.
- **Parameters**:
  - `subject` (optional): Resource subject/type (e.g., "Translation Words", "Translation Notes"). If not provided, will show all available subjects first.
  - `organization` (optional, default: "unfoldingWord"): Organization
- **Use Case**: Finding which languages have specific resource types

---

## 🌐 REST API Endpoints

All REST API endpoints are available at `/api/{endpoint-name}` where endpoint names use kebab-case (e.g., `fetch-scripture`, `list-languages`).

### Tool Endpoints (9)

1. `GET /api/fetch-scripture`
2. `GET /api/fetch-translation-notes`
3. `GET /api/fetch-translation-questions`
4. `GET /api/fetch-translation-word-links`
5. `GET /api/fetch-translation-word`
6. `GET /api/fetch-translation-academy`
7. `GET /api/list-languages`
8. `GET /api/list-subjects`
9. `GET /api/list-resources-for-language`

### Prompt Endpoint (1)

- `POST /api/execute-prompt` - Execute any of the 5 prompts

### MCP Endpoint (1)

- `POST /api/mcp` - Full MCP-over-HTTP bridge (JSON-RPC 2.0)
  - Supports: `initialize`, `tools/list`, `tools/call`, `prompts/list`, `prompts/get`
- `GET /api/mcp` - Server info and method discovery

### Utility Endpoints

- `GET /api/health` - Health check
- `GET /api/health-dcs` - Door43 Content Service health check
- `GET /api/kv-status` - Key-value cache status
- `GET /api/mcp-config` - MCP configuration
- `GET /api/discover-language-orgs` - Discover language organizations
- `GET /api/deployment` - Deployment information

### Chat Endpoint

- `POST /api/chat-stream` - Streaming chat interface with AI assistant

---

## 📊 Summary

- **MCP Tools**: 9 active tools
- **MCP Prompts**: 5 active prompts
- **REST API Endpoints**: 9 tool endpoints + 1 prompt endpoint + MCP bridge + utilities
- **Transport Methods**:
  - MCP stdio (for MCP clients)
  - HTTP MCP (JSON-RPC 2.0)
  - REST API (individual endpoints)

---

## 🔗 Access Methods

### Via MCP Protocol (stdio)

```bash
# Connect via stdio transport
npx @modelcontextprotocol/inspector translation-helps-mcp
```

### Via HTTP MCP (JSON-RPC 2.0)

```bash
# POST to /api/mcp
curl -X POST http://localhost:8174/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
```

### Via REST API

```bash
# Direct REST endpoint
curl "http://localhost:8174/api/fetch-scripture?reference=John%203:16&language=en"
```

---

## 📝 Notes

- All tools are defined in `src/mcp/tools-registry.ts` (single source of truth)
- All prompts are defined in `src/index.ts`
- REST API endpoints are in `ui/src/routes/api/`
- MCP HTTP bridge is in `ui/src/routes/api/mcp/+server.ts`
- Tools support both MCP protocol and REST API access
- Prompts are workflow orchestrators that chain multiple tools together
