# ✅ Single Source of Truth: Tool Registry

## Problem: Before

**Previously, adding a new tool required updating 4 different places:**

1. ❌ `src/config/parameters/groups.ts` - Parameter definitions
2. ❌ `src/contracts/ToolContracts.ts` - ToolRegistry mapping
3. ❌ `ui/src/routes/api/tools-metadata/+server.ts` - TOOL_METADATA_MAP
4. ❌ `ui/src/routes/api/tools-metadata/+server.ts` - nameMap

**Result:** Easy to forget one, causing inconsistencies between MCP, REST API, and UI documentation.

---

## Solution: Now

**✨ ONE PLACE TO UPDATE: `src/config/tools-registry.ts`**

```typescript
export const TOOLS_REGISTRY: ToolDefinition[] = [
  {
    mcpName: 'fetch_scripture',
    displayName: 'Fetch Scripture',
    endpoint: '/api/fetch-scripture',
    description: 'Fetch Bible scripture text',
    category: 'Scripture',
    parameters: PARAMETER_GROUPS.scripture.parameters,
    requiredParams: ['reference'],
    formatter: ToolFormatters.scripture,
    examples: [
      {
        title: 'Single verse',
        parameters: { reference: 'John 3:16', language: 'en' }
      }
    ]
  },
  // ... add new tools here
];
```

**Everything else is automatically derived:**
- ✅ MCP tool definitions
- ✅ REST endpoint metadata
- ✅ UI documentation
- ✅ Parameter validation
- ✅ Response formatting

---

## How to Add a New Tool

### Step 1: Define Parameters (if not already defined)

If your tool needs new parameters, add them to `src/config/parameters/groups.ts`:

```typescript
export const NEW_TOOL_PARAMS = createParameterGroup(
  'New Tool Parameters',
  'Parameters for the new tool',
  [
    COMMON_PARAMS.reference,
    COMMON_PARAMS.language,
    // ... your params
  ]
);

export const PARAMETER_GROUPS = {
  // ... existing
  newTool: NEW_TOOL_PARAMS,
};
```

### Step 2: Add Tool to Registry (ONLY PLACE YOU EDIT!)

Edit `src/config/tools-registry.ts` and add your tool:

```typescript
export const TOOLS_REGISTRY: ToolDefinition[] = [
  // ... existing tools
  {
    mcpName: 'new_tool',              // MCP tool name (snake_case)
    displayName: 'New Tool',          // Human-readable name
    endpoint: 'new-tool',             // RELATIVE path (no /api/ prefix!)
    description: 'What this tool does in detail',
    category: 'Your Category',        // UI grouping
    parameters: PARAMETER_GROUPS.newTool.parameters,
    requiredParams: ['reference'],    // Which params are required
    formatter: (data: any) => {
      // How to format MCP responses
      return JSON.stringify(data, null, 2);
    },
    examples: [
      {
        title: 'Example 1',
        parameters: { reference: 'John 3:16', language: 'en' },
        expectedResponse: 'What you expect back'
      }
    ]
  },
];
```

**Important:** Use **relative paths** for the `endpoint` field (e.g., `"fetch-scripture"` not `"/api/fetch-scripture"`). Different consumers add their own base paths:
- REST API: `/api/` + `fetch-scripture` → `/api/fetch-scripture`
- MCP Handler: Uses `/api/` internally
- Documentation: Can use any base path

### Step 3: Done!

**That's it!** Your new tool now automatically appears in:
- ✅ `/mcp-tools` page
- ✅ `/api-explorer` page
- ✅ `/api/tools-metadata` endpoint
- ✅ MCP server tool list (`/api/mcp` - `tools/list`)
- ✅ REST API documentation

**Note:** You still need to create the actual endpoint handler at `ui/src/routes/api/new-tool/+server.ts` for the REST API.

---

## Understanding the Two-Layer Endpoint Structure

### 🔄 Two Access Patterns

Every tool in the registry can be accessed in **two different ways**:

#### 1️⃣ **REST Endpoint** (Direct HTTP)

```bash
# Direct HTTP access to individual tool endpoints
GET /api/fetch-scripture?reference=John+3:16&language=en
GET /api/fetch-translation-notes?reference=John+3:16
GET /api/list-languages?organization=unfoldingWord

# Discovery endpoint (equivalent to MCP tools/list)
GET /api/list-tools
```

**Characteristics:**
- Individual SvelteKit route files (`ui/src/routes/api/[tool-name]/+server.ts`)
- Standard HTTP GET/POST requests
- Direct JSON responses
- Used by: UI pages, curl, Postman, direct HTTP clients

**Example Response:**
```json
{
  "reference": "John 3:16",
  "scripture": [{
    "translation": "ULT",
    "text": "For God so loved the world..."
  }],
  "metadata": {
    "cacheStatus": "hit",
    "responseTime": 45
  }
}
```

#### 2️⃣ **MCP Protocol Endpoint** (JSON-RPC 2.0)

```bash
# Single unified endpoint for ALL MCP protocol operations
POST /api/mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "fetch_scripture",
    "arguments": {
      "reference": "John 3:16",
      "language": "en"
    }
  },
  "id": 1
}
```

**Characteristics:**
- **Single endpoint** (`ui/src/routes/api/mcp/+server.ts`)
- JSON-RPC 2.0 protocol format
- Supports multiple methods: `tools/call`, `tools/list`, `prompts/list`, `prompts/get`
- Internally delegates to REST endpoints via `UnifiedMCPHandler`
- Used by: Claude Desktop, MCP SDK, MCP Inspector, MCP clients

**Note:** REST now has parity with MCP discovery:
- REST: `GET /api/list-tools` ↔ MCP: `POST /api/mcp` with `method=tools/list`
- Both return the same tool list with schemas

**Example Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": "For God so loved the world..."
    }]
  },
  "id": 1
}
```

### 🔗 How They Work Together

```
┌─────────────────┐
│  Client Request │
└────────┬────────┘
         │
    ┌────┴─────────────────────────────┐
    │                                  │
    ▼ Direct HTTP                      ▼ MCP Protocol
┌────────────────┐              ┌──────────────────┐
│ GET /api/      │              │ POST /api/mcp    │
│ fetch-scripture│              │ method:tools/call│
│                │              │ name:fetch_      │
│ ?reference=... │              │ scripture        │
└────────┬───────┘              └─────────┬────────┘
         │                                │
         │                                │
         │                    ┌───────────▼──────────┐
         │                    │ UnifiedMCPHandler    │
         │                    │ (delegates to REST)  │
         │                    └───────────┬──────────┘
         │                                │
         └────────────────┬───────────────┘
                          │
                          ▼
            ┌──────────────────────────┐
            │  Unified Service Layer   │
            │  (ScriptureService, etc) │
            └──────────────────────────┘
                          │
                          ▼
            ┌──────────────────────────┐
            │  Core Functions          │
            │  (fetchScripture, etc)   │
            └──────────────────────────┘
```

### 📝 Registry Fields Explained

```typescript
{
  mcpName: 'fetch_scripture',    // ← Used by /api/mcp (tools/call)
  endpoint: 'fetch-scripture',   // ← RELATIVE path (base path added by consumers)
  displayName: 'Fetch Scripture',// ← Human-readable (UI)
  // ... rest of definition
}
```

**How Base Paths Work:**

```typescript
// In tools-registry.ts (relative path)
endpoint: 'fetch-scripture'

// Consumers add their own base:

// 1. UnifiedMCPHandler (used by /api/mcp)
const handler = new UnifiedMCPHandler('/api/', eventFetch);
// Result: /api/ + fetch-scripture = /api/fetch-scripture

// 2. Metadata API (for UI documentation)
endpoint: `/api/${tool.endpoint}`
// Result: /api/ + fetch-scripture = /api/fetch-scripture

// 3. ToolRegistry (backward compatibility)
endpoint: `/api/${tool.endpoint}`
// Result: /api/ + fetch-scripture = /api/fetch-scripture
```

**Usage:**

```javascript
// REST: Direct HTTP access
const response = await fetch('/api/fetch-scripture?reference=John+3:16');
const data = await response.json();

// MCP: Via protocol endpoint (internally uses /api/ base)
const mcpClient = new MCPClient('/api/mcp');
const result = await mcpClient.callTool('fetch_scripture', {
  reference: 'John 3:16'
});
```

### ✅ Benefits of Two-Layer Architecture

1. **Flexibility**: Clients can choose the access pattern that suits them
2. **Compatibility**: Standard HTTP for web apps, MCP protocol for AI assistants
3. **Consistency**: Both layers use the same underlying services
4. **Type Safety**: Same parameters and validation for both
5. **Simplicity**: MCP clients don't need to know individual endpoint paths
6. **DRY Principle**: Relative paths avoid duplicating `/api/` prefix
7. **Portability**: Different deployments can use different base paths

### 🎯 Why Relative Paths?

Using **relative paths** (e.g., `"fetch-scripture"` instead of `"/api/fetch-scripture"`) provides several benefits:

1. **No Duplication**: The `/api/` base path isn't repeated in every tool definition
2. **Flexible Deployment**: Different environments can use different base paths
3. **Cleaner Registry**: Tool definitions focus on the tool name, not deployment details
4. **Easier Refactoring**: Change base path once, not in 9+ places

```typescript
// ✅ Good: Relative path (current approach)
endpoint: 'fetch-scripture'

// ❌ Bad: Absolute path with base prefix (old approach)
endpoint: '/api/fetch-scripture'
```

Each consumer adds the appropriate base:
- **REST Documentation**: Adds `/api/` → `/api/fetch-scripture`
- **MCP Handler**: Adds `/api/` → calls REST endpoint
- **Future Deployments**: Could use `/v2/api/` or any other base

---

## Architecture Diagram

### Two-Layer Endpoint Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/config/tools-registry.ts                                       │
│  ✨ SINGLE SOURCE OF TRUTH ✨                                       │
│                                                                      │
│  - Tool identity (mcpName, displayName, REST endpoint)              │
│  - Documentation (description, category, examples)                  │
│  - Parameters (from PARAMETER_GROUPS)                               │
│  - Response formatting (formatter functions for MCP)                │
└────────────┬────────────────────────────────────────────────────────┘
             │
             │ Powers two different access patterns:
             │
    ┌────────┴────────────────────────────────┐
    │                                          │
    ▼                                          ▼
┌─────────────────────────┐      ┌─────────────────────────────┐
│   REST Endpoints        │      │   MCP Protocol Endpoint     │
│   /api/[tool-name]      │      │   /api/mcp                  │
│                         │      │                             │
│   Direct HTTP access:   │      │   JSON-RPC 2.0 wrapper:     │
│   ├─ /api/fetch-        │      │   ├─ tools/list             │
│   │  scripture          │      │   ├─ tools/call             │
│   ├─ /api/fetch-        │      │   ├─ prompts/list           │
│   │  translation-notes  │      │   └─ prompts/get            │
│   ├─ /api/list-         │      │                             │
│   │  languages          │      │   Delegates to REST via     │
│   └─ ... (9 tools)      │      │   UnifiedMCPHandler         │
│                         │      │                             │
│   Used by:              │      │   Used by:                  │
│   • UI pages            │      │   • Claude Desktop          │
│   • Direct HTTP clients │      │   • MCP SDK                 │
│   • curl/Postman        │      │   • MCP Inspector           │
└─────────────────────────┘      └─────────────────────────────┘
             │                                   │
             │                                   │
             └───────────────┬───────────────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │  Shared Components     │
                ├────────────────────────┤
                │ • Parameter validation │
                │ • Unified services     │
                │ • Cache layer          │
                │ • Error handling       │
                │ • Response formatting  │
                └────────────────────────┘
```

### Key Architecture Points

1. **REST Endpoints** (`/api/fetch-scripture`, etc.)
   - Direct HTTP GET/POST access
   - Individual SvelteKit route files
   - Return JSON responses
   - Used by UI and HTTP clients

2. **MCP Endpoint** (`/api/mcp` - singular!)
   - Single JSON-RPC 2.0 protocol endpoint
   - Implements MCP protocol methods
   - Internally calls REST endpoints via `UnifiedMCPHandler`
   - Used by MCP clients (Claude Desktop, SDK)

3. **Single Source of Truth**
   - Both layers derive from `TOOLS_REGISTRY`
   - REST endpoint paths defined here
   - MCP tool names defined here
   - Same parameters, validation, and documentation

---

## Benefits

### ✅ **Single Source of Truth**
- Update one place, everything stays in sync
- No more forgetting to update documentation
- Reduced cognitive load

### ✅ **Type Safety**
- TypeScript ensures consistency
- Compile-time validation
- IDE autocomplete everywhere

### ✅ **DRY Principle**
- Parameters defined once in PARAMETER_GROUPS
- Formatters defined once in ToolFormatters
- No duplication across layers

### ✅ **Easy Maintenance**
- Clear where to make changes
- Less code to maintain
- Easier for new contributors

### ✅ **Automatic Updates**
- UI updates when you change parameters
- Documentation stays current
- No manual sync needed

---

## What Gets Generated Automatically

From the single registry, the system automatically generates:

1. **MCP Tool Definitions** - Tool names, descriptions, parameters for MCP protocol
2. **REST Endpoints** - API endpoint documentation and validation
3. **UI Metadata** - Documentation pages with examples and parameter details
4. **ToolRegistry** - Mapping of tools to endpoints and formatters
5. **Parameter Validation** - Zod schemas for type checking
6. **Response Formatting** - Consistent output across all interfaces

---

## Example: Before vs After

### Before (4 places to update):

```typescript
// 1. src/config/parameters/groups.ts
export const PARAMETER_GROUPS = {
  newTool: NEW_TOOL_PARAMS,
};

// 2. src/contracts/ToolContracts.ts
export const ToolRegistry = {
  new_tool: {
    endpoint: "/api/new-tool",
    formatter: myFormatter,
    requiredParams: ["reference"],
  },
};

// 3. ui/src/routes/api/tools-metadata/+server.ts (TOOL_METADATA_MAP)
const TOOL_METADATA_MAP = {
  newTool: {
    category: 'Category',
    description: 'Description',
    examples: [...]
  }
};

// 4. ui/src/routes/api/tools-metadata/+server.ts (nameMap)
const nameMap = {
  newTool: { 
    displayName: 'New Tool', 
    mcpName: 'new_tool', 
    endpoint: '/api/new-tool' 
  }
};
```

### After (1 place to update):

```typescript
// ONLY: src/config/tools-registry.ts
export const TOOLS_REGISTRY = [
  {
    mcpName: 'new_tool',
    displayName: 'New Tool',
    endpoint: '/api/new-tool',
    description: 'Description',
    category: 'Category',
    parameters: PARAMETER_GROUPS.newTool.parameters,
    requiredParams: ['reference'],
    formatter: myFormatter,
    examples: [...]
  }
];
```

---

## Migration Notes

### Existing Code Compatibility

The new system is **100% backward compatible**:

- `ToolRegistry` is automatically generated from `TOOLS_REGISTRY`
- All existing MCP tools continue to work
- No changes needed to tool handlers
- No changes needed to UI pages

### Testing

After making changes to `tools-registry.ts`:

1. **Build succeeds**: `npm run build`
2. **Dev server runs**: `npm run dev`
3. **Check documentation**: Visit `/mcp-tools` and `/api-explorer`
4. **Test MCP tools**: Use MCP inspector or Claude Desktop
5. **Test REST API**: Call endpoints directly

---

## Future Improvements

### Potential Enhancements:

1. **Auto-generate REST handlers** from registry
2. **Auto-generate Zod schemas** from parameter definitions
3. **Auto-generate SDK methods** from tool definitions
4. **Auto-generate tests** from examples
5. **Auto-generate OpenAPI spec** from registry

### Already Achieved:

- ✅ Single source of truth for tool definitions
- ✅ Automatic UI documentation generation
- ✅ Consistent parameter handling
- ✅ Unified error handling
- ✅ Type-safe across all layers

---

## Conclusion

By consolidating tool definitions into **one file** (`src/config/tools-registry.ts`), we've eliminated the main source of inconsistency and made the system much easier to maintain and extend.

**When adding a new tool, you now only need to:**
1. Add parameters to `PARAMETER_GROUPS` (if needed)
2. Add tool definition to `TOOLS_REGISTRY`
3. Create the actual implementation

Everything else happens automatically! 🎉

---

## Related Documentation

- **[REFACTOR_SINGLE_SOURCE_OF_TRUTH.md](../REFACTOR_SINGLE_SOURCE_OF_TRUTH.md)** - Concise refactor summary
- **[LIST_TOOLS_ENDPOINT_ADDED.md](../LIST_TOOLS_ENDPOINT_ADDED.md)** - New `/api/list-tools` REST endpoint
- **[TOOL_IMPLEMENTATION_ROUTING.md](./TOOL_IMPLEMENTATION_ROUTING.md)** - How tools connect to implementations via convention-based routing ⭐
