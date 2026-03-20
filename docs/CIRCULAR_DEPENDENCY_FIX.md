# Circular Dependency Fix - March 10, 2026

## Problem

After implementing the single source of truth with `src/config/tools-registry.ts`, we encountered a circular dependency error that prevented the MCP endpoint from working:

```
TypeError: Cannot read properties of undefined (reading 'scripture')
    at eval (C:/Users/LENOVO/Git/Github/translation-helps-mcp-2/src/config/tools-registry.ts:25:53)
```

And then:

```json
{
  "error": "Tool endpoint failed: 404"
}
```

## Root Causes

### 1. Circular Import Dependency

**Initial Problem:**
- `tools-registry.ts` imported `ToolFormatters` from `ToolContracts.ts`
- `ToolContracts.ts` imported `toToolRegistry()` from `tools-registry.ts`
- `toToolRegistry()` referenced `TOOLS_REGISTRY` which used `ToolFormatters`
- This created a circular dependency during module initialization

**Solution:**
Moved `ToolFormatters` to `tools-registry.ts` (where they're actually used) and had `ToolContracts.ts` re-export them:

```typescript
// src/config/tools-registry.ts
export const ToolFormatters = {
  scripture: (data: any): string => { /* ... */ },
  notes: (data: any): string => { /* ... */ },
  // ... other formatters
};

// src/contracts/ToolContracts.ts
export { ToolFormatters } from '../config/tools-registry.js';
```

This breaks the circular dependency because:
- `tools-registry.ts` no longer imports from `ToolContracts.ts`
- `ToolContracts.ts` can safely import from `tools-registry.ts`
- Any module can import `ToolFormatters` from either location

### 2. Double Base Path Issue

**Problem:**
After fixing the circular dependency, all tools returned 404 errors because the base path was being added twice:

1. `toToolRegistry()` added `/api/` prefix: `/api/fetch-scripture`
2. `UnifiedMCPHandler` also added `/api/` base: `/api/` + `/api/fetch-scripture` = `/api//api/fetch-scripture` ❌

**Solution:**
Modified `toToolRegistry()` to return RELATIVE paths and let the handler add the base:

```typescript
// src/config/tools-registry.ts
export function toToolRegistry() {
  const registry: Record<string, any> = {};
  
  for (const tool of TOOLS_REGISTRY) {
    registry[tool.mcpName] = {
      endpoint: tool.endpoint,  // Keep relative: "fetch-scripture"
      formatter: tool.formatter,
      requiredParams: tool.requiredParams,
    };
  }
  
  return registry;
}
```

The `UnifiedMCPHandler` already handles adding the base path:

```typescript
// ui/src/lib/mcp/UnifiedMCPHandler.ts
const response = await this.fetchFn(`${this.baseUrl}${tool.endpoint}?${params}`);
//                                    /api/       +  fetch-scripture  → /api/fetch-scripture ✅
```

## Files Changed

### 1. `src/config/tools-registry.ts`
- **Added**: `ToolFormatters` export (moved from `ToolContracts.ts`)
- **Modified**: `toToolRegistry()` to return relative endpoint paths

### 2. `src/contracts/ToolContracts.ts`
- **Removed**: `ToolFormatters` definition
- **Added**: Re-export of `ToolFormatters` from `tools-registry.ts`
- **Modified**: `ToolRegistry` now uses Proxy pattern for lazy initialization

## Verification

After the fix, both REST and MCP endpoints work correctly:

### REST Endpoint (Direct Access)
```bash
curl "http://localhost:8179/api/fetch-scripture?reference=John+3:16"
```

**Response:** ✅ Returns scripture JSON

### MCP Protocol Endpoint
```bash
curl "http://localhost:8179/api/mcp" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"fetch_scripture","arguments":{"reference":"John 3:16"}},"id":1}'
```

**Response:** ✅ Returns JSON-RPC 2.0 formatted response with scripture data and metadata

## Key Takeaways

1. **Circular Dependencies**: When refactoring, always check the import graph to avoid cycles. Tools and formatters should live in the same module if they reference each other.

2. **Base Path Responsibility**: When working with URL construction, clearly define WHO is responsible for adding base paths. In our case:
   - `TOOLS_REGISTRY` stores **relative paths** (`fetch-scripture`)
   - `UnifiedMCPHandler` adds **base path** (`/api/`)
   - Result: `/api/fetch-scripture`

3. **Single Source of Truth**: Even when fixing architectural issues, maintain the principle. `ToolFormatters` belong in `tools-registry.ts` because that's where `TOOLS_REGISTRY` uses them.

4. **Module Initialization Order**: Use Proxy patterns or getter functions for lazy initialization when you need to break circular dependencies while maintaining backward compatibility.

## Architecture After Fix

```
src/config/tools-registry.ts  (SINGLE SOURCE OF TRUTH)
├─ exports: TOOLS_REGISTRY     (array of tool definitions)
├─ exports: ToolFormatters     (formatter functions)
└─ exports: toToolRegistry()   (convert to old format, returns RELATIVE paths)
           ↓
src/contracts/ToolContracts.ts (INTERFACE LAYER)
├─ re-exports: ToolFormatters  (from tools-registry.ts)
└─ exports: ToolRegistry       (Proxy to toToolRegistry(), for backward compat)
           ↓
ui/src/lib/mcp/UnifiedMCPHandler.ts (MCP PROTOCOL HANDLER)
└─ Adds /api/ base path to relative endpoints from ToolRegistry
```

## Related Documentation

- **[SINGLE_SOURCE_OF_TRUTH.md](./SINGLE_SOURCE_OF_TRUTH.md)** - Overview of the single source of truth refactor
- **[TOOL_IMPLEMENTATION_ROUTING.md](./TOOL_IMPLEMENTATION_ROUTING.md)** - How tools connect to implementations
- **[REFACTOR_SINGLE_SOURCE_OF_TRUTH.md](../REFACTOR_SINGLE_SOURCE_OF_TRUTH.md)** - Concise refactor summary
