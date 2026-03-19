# HTTP Status Code Fix: 500 → 404 for Missing Resources

## Issue Summary

**Problem**: When a requested book is not available (but alternatives exist), the API was returning **500 Internal Server Error** instead of **404 Not Found**.

**Example**: Requesting John's Gospel in Spanish (`es-419`) returns:
- ✅ `availableBooks`: `["3 John", "Jonah", "Ruth", "Titus"]`
- ✅ Helpful error message with suggestions
- ❌ Status code: `500` (incorrect)
- ✅ Status code: `404` (correct - after fix)

## Why 500 Was Wrong

**HTTP 500 Internal Server Error** means: "The server encountered an unexpected condition that prevented it from fulfilling the request."

But in this case:
- ✅ The request was valid (correct format, valid book code)
- ✅ The server processed it correctly (auto-retry, catalog queries)
- ✅ The system worked as designed (returned helpful alternatives)
- ❌ The issue is **data availability**, not a server malfunction

**Correct status: HTTP 404 Not Found** - The requested resource (John in es-419) does not exist in the dataset.

## Fix Applied

### Location
`ui/src/lib/simpleEndpoint.ts` lines 588-591

### Code Change

```typescript
// Resource not found with alternatives (404) - book/language not available but we have suggestions
else if ((error as any)?.availableBooks || (error as any)?.languageVariants) {
    errorStatus = 404;
    console.log('[simpleEndpoint] ✅ Setting status to 404 (resource not found with alternatives)');
}
// Not found errors (404) - check LAST since it's generic  
else if (error.message.includes('not found') || error.message.includes('not available') || error.message.includes('404')) {
    errorStatus = 404;
    console.log('[simpleEndpoint] ✅ Setting status to 404 (generic not found)');
}
```

### Logic

The fix adds a specific check for errors that contain recovery data:
1. **First priority**: Check if error has `availableBooks` or `languageVariants` → Set 404
2. **Second priority**: Check error message for "not found" or "not available" → Set 404
3. **Fallback**: Default to 500 for unexpected errors

This ensures that:
- ✅ Missing books with alternatives → 404 (resource not found, but here are suggestions)
- ✅ Missing languages with variants → 404 (language not found, but try these codes)
- ✅ Invalid book codes → 400 (bad request)
- ✅ Timeout errors → 504 (gateway timeout)
- ❌ Unexpected server errors → 500 (fallback)

## Impact

### API Responses
Before:
```json
{
  "error": "...",
  "details": { "availableBooks": [...] },
  "status": 500  // ❌ Incorrect
}
```

After:
```json
{
  "error": "...",
  "details": { "availableBooks": [...] },
  "status": 404  // ✅ Correct
}
```

### HTTP Headers
Before:
```
HTTP/1.1 500 Internal Server Error
```

After:
```
HTTP/1.1 404 Not Found
```

### Chat Interface
**No functional change** - the LLM already handles both 404 and 500 correctly by suggesting alternatives. The fix makes the HTTP semantics correct.

### MCP JSON-RPC
Before:
```json
{
  "error": {
    "code": -32000,
    "message": "Tool endpoint failed: 500",
    "data": { "availableBooks": [...] }
  }
}
```

After:
```json
{
  "error": {
    "code": -32000,
    "message": "Tool endpoint failed: 404",
    "data": { "availableBooks": [...] }
  }
}
```

## Testing

### Updated Test Expectations

All test files have been updated to expect **404** instead of **500**:

1. **`tests/auto-retry-tests.ts`** - Vitest assertions updated
2. **`tests/manual-test-cases.md`** - Expected results updated
3. **`scripts/test-auto-retry.sh`** - Comments updated
4. **`tests/README.md`** - Documentation updated

### Test After Deployment

```bash
# Test unavailable book (should be 404)
curl -I "http://localhost:8174/api/fetch-scripture?reference=JHN+3:16&language=es"

# Expected:
HTTP/1.1 404 Not Found
X-Response-Time: ~13000ms
```

```bash
# Verify JSON response
curl -s "http://localhost:8174/api/fetch-scripture?reference=JHN+3:16&language=es&format=json" | jq '.status'

# Expected:
404
```

## Deployment Notes

### Vite HMR Limitation

⚠️ **Important**: Changes to `ui/src/lib/simpleEndpoint.ts` may not be picked up by Vite's hot module reload during development.

**To test the fix locally:**

```bash
# Option 1: Full restart (recommended)
taskkill //F //IM node.exe  # Windows
# or
killall node  # Linux/Mac

npm run dev

# Option 2: Production build
npm run build:cloudflare
```

### Production Deployment

The fix will take effect automatically on:
- ✅ Next Cloudflare Pages deployment
- ✅ Any new build (`npm run build`)
- ✅ Fresh server start

No additional configuration or migration needed.

## Benefits

### 1. **Semantic Correctness**
- HTTP status codes now accurately reflect the nature of the error
- 404 = "resource not found" (correct)
- 500 = "server malfunction" (was incorrect)

### 2. **Better Client Experience**
- HTTP clients can properly differentiate between:
  - **404**: Retry won't help, but alternatives are available
  - **500**: Temporary server issue, retry might work

### 3. **Improved Monitoring**
- 404s don't trigger server error alerts in monitoring systems
- Cleaner separation between:
  - **Client errors (4xx)**: User requested something that doesn't exist
  - **Server errors (5xx)**: Actual problems that need investigation

### 4. **REST API Best Practices**
- Aligns with HTTP/REST standards
- Makes API more predictable for third-party integrators
- Better compatibility with HTTP clients and frameworks

## Status Code Reference

| **Status** | **Meaning** | **When to Use** |
|---------|-----------|----|
| **200** | OK | Request succeeded, resource found |
| **400** | Bad Request | Invalid input (bad book code, malformed reference) |
| **404** | Not Found | Resource doesn't exist (book/language not available) |
| **500** | Internal Server Error | Unexpected server malfunction (bugs, crashes) |
| **504** | Gateway Timeout | External API timeout (Door43 not responding) |

## Summary

✅ **Fixed**: Status code now correctly returns 404 for missing resources  
✅ **Semantic**: HTTP codes now match REST best practices  
✅ **Backward Compatible**: No breaking changes to response format  
✅ **Functional**: LLM behavior unchanged (already handled both statuses)  
✅ **Testable**: All test expectations updated  

The automatic retry system continues to work perfectly, now with semantically correct HTTP status codes. 🎯
