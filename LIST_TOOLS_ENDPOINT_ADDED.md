# ✅ Added `/api/list-tools` REST Endpoint

## Problem Identified

The system had **asymmetry** between REST and MCP protocols:

- ✅ **MCP**: Had `tools/list` method via `/api/mcp`
- ❌ **REST**: Missing equivalent discovery endpoint

**User's insight:** "Since the REST API is just a REST representation of the MCP server, we should have a list-tools endpoint for both."

---

## Solution Implemented

### ✅ Created `/api/list-tools` REST Endpoint

**File:** `ui/src/routes/api/list-tools/+server.ts`

```typescript
GET /api/list-tools

// Returns:
{
  tools: [
    {
      name: "fetch_scripture",
      description: "Fetch Bible scripture text",
      inputSchema: { 
        type: "object", 
        properties: {...}, 
        required: [...] 
      }
    },
    // ... all 10 tools
  ],
  count: 10,
  metadata: {
    generatedAt: "2026-03-10T...",
    source: "mcp-tools-registry"
  }
}
```

### ✅ Added to Tools Registry

**File:** `src/config/tools-registry.ts`

```typescript
{
  mcpName: 'list_tools',
  displayName: 'List Tools',
  endpoint: 'list-tools',
  description: 'List all available MCP tools with their schemas and descriptions',
  category: 'Discovery',
  parameters: PARAMETER_GROUPS.listTools.parameters,
  requiredParams: [],
  formatter: (data: any): string => {
    // Formats tool list for MCP text display
  },
  examples: [...]
}
```

### ✅ Added Parameter Group

**File:** `src/config/parameters/groups.ts`

```typescript
export const LIST_TOOLS_PARAMS = createParameterGroup(
  'List Tools Parameters',
  'Parameters for listing available MCP tools',
  []  // No parameters - returns all tools
);
```

---

## Result: Complete Parity

### REST API Discovery

```bash
# Discover available tools
GET /api/list-tools

# Response
{
  "tools": [
    { "name": "fetch_scripture", "description": "...", "inputSchema": {...} },
    { "name": "fetch_translation_notes", "description": "...", "inputSchema": {...} },
    { "name": "list_languages", "description": "...", "inputSchema": {...} },
    { "name": "list_tools", "description": "...", "inputSchema": {...} },
    // ... 10 tools total
  ],
  "count": 10
}
```

### MCP Protocol Discovery

```bash
# Discover available tools (same data, different wrapper)
POST /api/mcp
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}

# Response
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      { "name": "fetch_scripture", "description": "...", "inputSchema": {...} },
      // ... same tool list
    ]
  },
  "id": 1
}
```

---

## Benefits

### ✅ **Protocol Parity**
- REST clients can discover tools just like MCP clients
- Same data, same schemas, different format

### ✅ **Consistency**
- Both use `getMCPToolsList()` from the same source
- Single source of truth ensures discovery matches implementation

### ✅ **REST-Friendly**
- Standard HTTP GET request
- No JSON-RPC wrapper needed
- Direct JSON response

### ✅ **Self-Documenting**
- Tool shows up in `/api-explorer`
- Tool shows up in `/mcp-tools`
- Tool shows up in `/api/tools-metadata`

### ✅ **Discoverable via REST**
```bash
# Clients can now programmatically discover tools via pure REST
curl https://tc-helps.mcp.servant.bible/api/list-tools
```

---

## Complete Tool List

The system now has **10 tools** (up from 9):

### Scripture
1. `fetch_scripture`

### Translation Helps
2. `fetch_translation_notes`
3. `fetch_translation_questions`
4. `fetch_translation_word_links`
5. `fetch_translation_word`
6. `fetch_translation_academy`

### Discovery
7. `list_tools` ⭐ **NEW!**
8. `list_languages`
9. `list_subjects`
10. `list_resources_for_language`

---

## Usage Examples

### REST Client (JavaScript)

```javascript
// Discover available tools
const response = await fetch('/api/list-tools');
const { tools, count } = await response.json();

console.log(`Found ${count} tools:`);
tools.forEach(tool => {
  console.log(`- ${tool.name}: ${tool.description}`);
});
```

### MCP Client (via SDK)

```typescript
import { TranslationHelpsClient } from 'translation-helps-sdk';

const client = new TranslationHelpsClient({
  serverUrl: '/api/mcp'
});

// Initialize and list tools
await client.initialize();
const tools = await client.listTools();

console.log('Available tools:', tools);
```

### Direct REST Call

```bash
# Simple curl request
curl https://tc-helps.mcp.servant.bible/api/list-tools | jq '.tools[].name'

# Output:
# "fetch_scripture"
# "fetch_translation_notes"
# "fetch_translation_questions"
# "fetch_translation_word_links"
# "fetch_translation_word"
# "fetch_translation_academy"
# "list_tools"
# "list_languages"
# "list_subjects"
# "list_resources_for_language"
```

---

## Documentation Updated

- ✅ `docs/SINGLE_SOURCE_OF_TRUTH.md` - Added REST parity note
- ✅ `src/config/tools-registry.ts` - Added list_tools definition
- ✅ `src/config/parameters/groups.ts` - Added LIST_TOOLS_PARAMS
- ✅ `ui/src/routes/api/list-tools/+server.ts` - Created REST endpoint

---

## Architectural Improvement

This change reinforces the **single source of truth** principle:

```
┌─────────────────────────────┐
│  src/config/tools-registry  │
│  (10 tools defined)         │
└──────────┬──────────────────┘
           │
           ├──────────────────────────────┐
           │                              │
           ▼                              ▼
┌────────────────────┐      ┌──────────────────────┐
│  REST Discovery    │      │  MCP Discovery       │
│  /api/list-tools   │      │  /api/mcp            │
│                    │      │  (tools/list)        │
│  GET request       │      │  JSON-RPC 2.0        │
│  Direct JSON       │      │  Protocol wrapper    │
└────────────────────┘      └──────────────────────┘
           │                              │
           └──────────┬───────────────────┘
                      │
                      ▼
            ┌──────────────────┐
            │ getMCPToolsList()│
            │ (shared function)│
            └──────────────────┘
```

Both endpoints now use the **exact same function** to generate the tools list, ensuring perfect consistency.

---

## Conclusion

The REST API now has **complete parity** with the MCP protocol for tool discovery:

| Feature | REST | MCP |
|---------|------|-----|
| **List tools** | ✅ `/api/list-tools` | ✅ `tools/list` |
| **Call tools** | ✅ `/api/{tool-name}` | ✅ `tools/call` |
| **List prompts** | ❌ (not needed for REST) | ✅ `prompts/list` |
| **Get prompt** | ❌ (not needed for REST) | ✅ `prompts/get` |

The system is now **fully self-describing** via REST, making it easy for any HTTP client to discover and use available tools! 🎉
