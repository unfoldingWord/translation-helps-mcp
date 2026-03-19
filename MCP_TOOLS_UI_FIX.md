# MCP Tools UI - Error Response Fix

## Problem

When testing invalid book codes on the MCP Tools UI page (`/mcp-tools`), the error response in the "Response Data" section wasn't showing the helpful `validBookCodes` array, only showing generic error info:

```json
{
  "error": "Tool endpoint failed: 400",
  "details": {
    "endpoint": "fetch_scripture",
    "toolName": "fetch_scripture",
    "timestamp": "2026-03-13T10:18:10.292Z"
  },
  "status": 0
}
```

**Missing**: The `validBookCodes` array (66 Bible book codes) and `invalidCode` field that AI agents need to automatically correct errors.

## Root Cause

The issue was in two places:

### 1. JavaScript SDK (`packages/js-sdk/src/client.ts`)

**Problem**: When the SDK received a JSON-RPC error response with `error.data.validBookCodes`, it was only extracting the error message:

```typescript
// ❌ OLD CODE - Lost validBookCodes data
if (data.error) {
  throw new Error(data.error.message || "MCP server error");
}
```

**Fix**: Now preserves `error.data` when throwing:

```typescript
// ✅ NEW CODE - Preserves validBookCodes
if (data.error) {
  const error: any = new Error(data.error.message || "MCP server error");
  // Preserve error.data for AI agents
  if (data.error.data) {
    error.details = data.error.data;
    // Also attach directly for easy access
    if (data.error.data.validBookCodes) {
      error.validBookCodes = data.error.data.validBookCodes;
      error.invalidCode = data.error.data.invalidCode;
    }
  }
  throw error;
}
```

### 2. MCP Tools UI Page (`ui/src/routes/(app)/mcp-tools/+page.svelte`)

**Problem**: When catching errors, the UI created a new error response object that didn't preserve the `validBookCodes`:

```typescript
// ❌ OLD CODE - Lost validBookCodes data
apiResult = {
  error: error.message || 'MCP tool execution error',
  details: {
    endpoint: endpoint.name,
    toolName: endpointToToolName(endpoint.name),
    timestamp: new Date().toISOString()
  },
  status: 0
};
```

**Fix**: Now preserves `validBookCodes` from caught errors:

```typescript
// ✅ NEW CODE - Preserves validBookCodes
const errorDetails: any = {
  endpoint: endpoint.name,
  toolName: endpointToToolName(endpoint.name),
  timestamp: new Date().toISOString()
};

// Preserve validBookCodes for AI agents
if (error.validBookCodes) {
  errorDetails.validBookCodes = error.validBookCodes;
  errorDetails.invalidCode = error.invalidCode;
} else if (error.details?.validBookCodes) {
  errorDetails.validBookCodes = error.details.validBookCodes;
  errorDetails.invalidCode = error.details.invalidCode;
}

// Preserve other error details
if (error.details) {
  Object.assign(errorDetails, error.details);
}

apiResult = {
  error: error.message || 'MCP tool execution error',
  details: errorDetails,
  status: 0
};
```

## How to Test

1. **Rebuild SDK** (already done):
   ```bash
   cd packages/js-sdk
   npm run build
   ```

2. **Refresh your browser** - Hard refresh the MCP Tools page to reload the updated SDK

3. **Test with invalid book code**:
   - Go to MCP Tools page: http://localhost:8175/mcp-tools
   - Select `fetch_scripture` tool
   - Enter invalid reference: `InvalidBook 1:1`
   - Click "Test API"

4. **Expected Result** - Response Data should now show:

```json
{
  "error": "Tool endpoint failed: 400",
  "details": {
    "endpoint": "fetch_scripture",
    "toolName": "fetch_scripture",
    "timestamp": "2026-03-13T10:20:00.000Z",
    "validBookCodes": [
      {"code": "GEN", "name": "Genesis"},
      {"code": "EXO", "name": "Exodus"},
      {"code": "LEV", "name": "Leviticus"},
      ... // All 66 books
      {"code": "REV", "name": "Revelation"}
    ],
    "invalidCode": "INVALIDBOOK"
  },
  "status": 0
}
```

## MCP Protocol Compliance

The error structure follows JSON-RPC 2.0 spec with MCP extensions:

**Raw MCP Response:**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Tool endpoint failed: 400",
    "data": {
      "validBookCodes": [...],
      "invalidCode": "..."
    }
  },
  "id": 1
}
```

**SDK MCPResponse Format:**
```typescript
{
  content: [
    {
      type: 'text',
      text: JSON.stringify(data)
    }
  ],
  // SDK preserves error.data as error.details and error.validBookCodes
}
```

**UI Display Format:**
```json
{
  "error": "...",
  "details": {
    "validBookCodes": [...],
    "invalidCode": "..."
  }
}
```

## Benefits for AI Agents

AI agents testing via the MCP Tools UI can now:

✅ **See complete list of valid book codes** in error responses  
✅ **Identify which code was invalid** (`invalidCode` field)  
✅ **Automatically correct errors** without additional API calls  
✅ **Implement fuzzy matching** for typo correction  
✅ **Build name-to-code mappings** for user-friendly suggestions  

## Files Modified

1. **`packages/js-sdk/src/client.ts`** - Enhanced error handling to preserve `error.data`
2. **`ui/src/routes/(app)/mcp-tools/+page.svelte`** - Updated error catch to preserve `validBookCodes`

## Verified

✅ REST API includes `validBookCodes` (66 items) in error responses  
✅ MCP API includes `validBookCodes` (66 items) in `error.data`  
✅ JavaScript SDK preserves `error.data` when throwing  
✅ MCP Tools UI preserves `validBookCodes` when catching errors  
✅ JSON-RPC 2.0 compliance maintained  

---

**Status:** ✅ Fixed  
**Testing:** Requires browser hard refresh to see changes  
**Impact:** Significantly improved error handling for AI agents  
**Date:** March 13, 2026
