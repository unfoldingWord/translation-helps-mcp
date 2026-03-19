# Tool Implementation Routing

## How Tools Connect to Implementations

The system uses **convention-based routing** rather than explicit implementation props. This leverages SvelteKit's file-based routing to automatically connect tool definitions to their implementations.

## The Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 1. REGISTRY (Metadata)                                      │
│    src/config/tools-registry.ts                             │
│                                                              │
│    {                                                         │
│      mcpName: 'fetch_scripture',                            │
│      endpoint: 'fetch-scripture',  ← RELATIVE PATH          │
│      parameters: [...],                                      │
│      formatter: (data) => ...                               │
│    }                                                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Convention: endpoint name
                         │ maps to route file
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. IMPLEMENTATION (Route File)                              │
│    ui/src/routes/api/fetch-scripture/+server.ts             │
│                                                              │
│    export const GET: RequestHandler = async ({ url }) => {  │
│      const service = new ScriptureService();                │
│      const result = await service.fetch(...);               │
│      return json(result);                                   │
│    }                                                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ SvelteKit automatically
                         │ routes to this file
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. ROUTING (SvelteKit + MCP Handler)                        │
│                                                              │
│    REST: GET /api/fetch-scripture                           │
│         → ui/src/routes/api/fetch-scripture/+server.ts      │
│                                                              │
│    MCP:  POST /api/mcp                                      │
│         → UnifiedMCPHandler reads ToolRegistry              │
│         → Delegates to /api/fetch-scripture                 │
└─────────────────────────────────────────────────────────────┘
```

## How It Works: Step by Step

### 1. Tool Registry Defines the Endpoint Path

**File:** `src/config/tools-registry.ts`

```typescript
export const TOOLS_REGISTRY: ToolDefinition[] = [
  {
    mcpName: 'fetch_scripture',
    displayName: 'Fetch Scripture',
    endpoint: 'fetch-scripture',  // ← RELATIVE PATH (no /api/ prefix)
    description: 'Fetch Bible scripture text',
    category: 'Scripture',
    parameters: PARAMETER_GROUPS.scripture.parameters,
    requiredParams: ['reference'],
    formatter: ToolFormatters.scripture,
    examples: [...]
  }
];
```

**Key Points:**
- `endpoint` is a **relative path** (e.g., `fetch-scripture`, not `/api/fetch-scripture`)
- This allows different consumers to add their own base paths
- The registry is metadata-only; it doesn't contain implementation code

### 2. SvelteKit Route File Provides Implementation

**File:** `ui/src/routes/api/fetch-scripture/+server.ts`

```typescript
import { json, type RequestHandler } from '@sveltejs/kit';
import { ScriptureService } from '$lib/services/ScriptureService';

export const GET: RequestHandler = async ({ url, fetch }) => {
  const reference = url.searchParams.get('reference');
  const language = url.searchParams.get('language') || 'en';
  
  const service = new ScriptureService();
  const result = await service.fetchScripture({
    reference,
    language,
    // ... other params
  });
  
  return json(result);
};
```

**Key Points:**
- **Convention:** The folder name `fetch-scripture` matches the `endpoint` field
- SvelteKit automatically routes `/api/fetch-scripture` to this file
- The `+server.ts` file exports request handlers (`GET`, `POST`, etc.)
- This is the **actual implementation** that does the work

### 3. MCP Handler Delegates to REST Endpoints

**File:** `ui/src/lib/mcp/UnifiedMCPHandler.ts`

```typescript
export class UnifiedMCPHandler {
  private baseUrl: string; // e.g., '/api/'
  private fetchFn: typeof fetch;

  async handleToolCall(toolName: string, args: any): Promise<MCPToolResponse> {
    // Look up tool in registry
    const tool = ToolRegistry[toolName];
    
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // Build query parameters
    const params = new URLSearchParams();
    Object.entries(args).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    });

    // Call the REST endpoint
    const response = await this.fetchFn(
      `${this.baseUrl}${tool.endpoint}?${params}`
      //  /api/       +  fetch-scripture  → /api/fetch-scripture
    );

    const data = await response.json();
    
    // Format for MCP text output
    const formattedText = tool.formatter(data);
    
    return {
      content: [{ type: 'text', text: formattedText }]
    };
  }
}
```

**Key Points:**
- `UnifiedMCPHandler` is instantiated with `baseUrl = '/api/'`
- It looks up the tool in `ToolRegistry` to get the `endpoint` path
- It constructs the full URL: `/api/` + `fetch-scripture` = `/api/fetch-scripture`
- SvelteKit automatically routes this to the implementation file
- The formatter converts JSON response to MCP text format

## The Convention

The magic is in the **naming convention**:

```
Registry endpoint field        SvelteKit route file path
─────────────────────────     ──────────────────────────────────────
'fetch-scripture'       →     ui/src/routes/api/fetch-scripture/+server.ts
'fetch-translation-notes' →   ui/src/routes/api/fetch-translation-notes/+server.ts
'list-languages'        →     ui/src/routes/api/list-languages/+server.ts
```

**If the names match**, SvelteKit automatically routes requests to the correct file. No explicit wiring needed!

## Why This Design?

### 1. **Separation of Concerns**
- **Registry** = Metadata (what the tool does, what params it needs)
- **Route File** = Implementation (how the tool actually works)
- **MCP Handler** = Protocol adapter (converts MCP calls to REST calls)

### 2. **DRY (Don't Repeat Yourself)**
- Tool logic is written **once** in the route file
- Both REST and MCP access the **same implementation**
- No duplication between REST and MCP handlers

### 3. **Convention Over Configuration**
- No need to manually wire up routes in a config file
- Just follow the naming convention and it works
- SvelteKit handles all the routing automatically

### 4. **Easy to Add New Tools**

To add a new tool, you only need:

1. **Add to registry** (`src/config/tools-registry.ts`):
   ```typescript
   {
     mcpName: 'my_new_tool',
     endpoint: 'my-new-tool',
     // ... metadata
   }
   ```

2. **Create route file** (`ui/src/routes/api/my-new-tool/+server.ts`):
   ```typescript
   export const GET: RequestHandler = async ({ url }) => {
     // Implementation
     return json(result);
   };
   ```

3. **Done!** Both REST and MCP access will work automatically.

## Two Access Patterns

### REST Endpoint (Direct Access)

```bash
# Direct HTTP GET request
GET /api/fetch-scripture?reference=John+3:16&language=en

# Routes directly to:
# ui/src/routes/api/fetch-scripture/+server.ts
```

### MCP Protocol (JSON-RPC Wrapper)

```bash
# JSON-RPC 2.0 request
POST /api/mcp
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

# MCP handler:
# 1. Looks up 'fetch_scripture' in ToolRegistry
# 2. Gets endpoint: 'fetch-scripture'
# 3. Delegates to: /api/fetch-scripture?reference=John+3:16&language=en
# 4. Formats response using tool.formatter()
```

## File Structure Example

```
ui/src/routes/api/
├── fetch-scripture/
│   └── +server.ts          ← Implementation for 'fetch-scripture'
├── fetch-translation-notes/
│   └── +server.ts          ← Implementation for 'fetch-translation-notes'
├── list-languages/
│   └── +server.ts          ← Implementation for 'list-languages'
└── mcp/
    └── +server.ts          ← MCP protocol endpoint (delegates to above)

src/config/
└── tools-registry.ts       ← Metadata for all tools
```

## Common Questions

### Q: Why not put implementation in the registry?

**A:** Separation of concerns. The registry is pure metadata that can be safely imported anywhere (including browser builds). Implementation code has dependencies on services, databases, etc. that should only run server-side.

### Q: What if I rename a tool's endpoint?

**A:** You must:
1. Update `endpoint` field in `tools-registry.ts`
2. Rename the folder in `ui/src/routes/api/`
3. Both must match for routing to work

### Q: Can I have multiple endpoints for one tool?

**A:** No. One tool = one endpoint. If you need multiple access patterns, create separate tools in the registry or use query parameters to differentiate behavior.

### Q: How does the UI know about tools?

**A:** The UI queries `/api/tools-metadata` which reads `TOOLS_REGISTRY` and returns all tool metadata with full `/api/` paths prepended. This metadata drives both the MCP Tools page and API Explorer page.

## Summary

**The implementation is NOT in the registry.** Instead:

1. **Registry** defines metadata including the `endpoint` path (relative)
2. **SvelteKit route files** provide the actual implementation
3. **Convention** (matching folder names to endpoint paths) ties them together
4. **MCP handler** delegates to REST endpoints using the registry metadata

This architecture is elegant, DRY, and maintainable. Adding a new tool requires minimal boilerplate and ensures REST/MCP parity automatically.
