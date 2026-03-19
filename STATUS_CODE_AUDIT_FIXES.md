# HTTP Status Code Audit & Fixes

## Summary

Comprehensive audit of HTTP status codes across the codebase to ensure semantic correctness. Fixed multiple instances where incorrect status codes were returned.

## Issues Found & Fixed

### ✅ 1. **Simple Endpoint** - Missing Resources (FIXED)
**File:** `ui/src/lib/simpleEndpoint.ts` (lines 588-595)

**Problem:** Returned 500 for missing books/languages that have alternatives

**Fix:** Added specific check for errors with `availableBooks` or `languageVariants` → Returns 404

```typescript
// Resource not found with alternatives (404)
else if ((error as any)?.availableBooks || (error as any)?.languageVariants) {
    errorStatus = 404;
    console.log('[simpleEndpoint] ✅ Setting status to 404 (resource not found with alternatives)');
}
// Generic not found errors (404)
else if (error.message.includes('not found') || error.message.includes('not available') || error.message.includes('404')) {
    errorStatus = 404;
}
```

**Impact:** 
- Book not available → 404 (was 500)
- Language not available → 404 (was 500)

---

### ✅ 2. **MCP Endpoint** - All Errors Returned 500 (FIXED)
**File:** `ui/src/routes/api/mcp/+server.ts` (lines 617-659)

**Problem:** Returned HTTP 500 for ALL errors, including method not found and invalid params

**Fix:** Map MCP error codes to appropriate HTTP status codes

```typescript
// Map MCP error codes to HTTP status codes
switch (mcpErrorCode) {
    case ErrorCode.MethodNotFound: // -32601
        httpStatus = 404; // Not Found
        break;
    case ErrorCode.InvalidParams: // -32602
    case ErrorCode.InvalidRequest: // -32600
    case ErrorCode.ParseError: // -32700
        httpStatus = 400; // Bad Request
        break;
    case ErrorCode.InternalError: // -32603
    default:
        httpStatus = 500; // Internal Server Error
        break;
}
```

**Impact:**
- Unknown tool/method → 404 (was 500)
- Invalid parameters → 400 (was 500)
- Parse errors → 400 (was 500)
- Internal errors → 500 (unchanged)

---

### ✅ 3. **Common Error Handlers** - Missing "not available" Pattern (FIXED)
**File:** `ui/src/lib/commonErrorHandlers.ts` (lines 68-80)

**Problem:** Only checked for "not found", missed "not available"

**Fix:** Added check for "not available" and errors with recovery data

```typescript
// Resource not found with alternatives (404) - check for errors with recovery data
if ((error as any)?.availableBooks || (error as any)?.languageVariants) {
    return {
        status: 404,
        message: error.message // Keep detailed message with suggestions
    };
}

// Generic not found (404)
if (message.includes('not found') || message.includes('not available') || message.includes('404')) {
    return {
        status: 404,
        message: 'The requested resource was not found.'
    };
}
```

**Impact:**
- Errors with "not available" → 404 (was 500)
- Errors with recovery data → 404 (was 500)

---

## Status Code Reference

### Correct Mapping

| **Status** | **Meaning** | **Use Cases** |
|-----------|-----------|-------------|
| **200** | OK | Request succeeded, resource found |
| **202** | Accepted | Async operation started (notifications) |
| **400** | Bad Request | Invalid input, parse errors, invalid params |
| **401** | Unauthorized | Authentication required/failed |
| **404** | Not Found | Resource doesn't exist (book/language/method) |
| **500** | Internal Server Error | Unexpected server malfunction |
| **502** | Bad Gateway | External API error (DCS unreachable) |
| **503** | Service Unavailable | Circuit breaker open, temporary outage |
| **504** | Gateway Timeout | External API timeout |

### Before vs After

#### **Scenario 1: Book Not Available**
```
Before: HTTP 500 Internal Server Error
After:  HTTP 404 Not Found ✅
```

#### **Scenario 2: Unknown MCP Tool**
```
Before: HTTP 500 Internal Server Error
After:  HTTP 404 Not Found ✅
```

#### **Scenario 3: Invalid MCP Parameters**
```
Before: HTTP 500 Internal Server Error
After:  HTTP 400 Bad Request ✅
```

#### **Scenario 4: Language Not Available**
```
Before: HTTP 500 Internal Server Error
After:  HTTP 404 Not Found ✅
```

---

## Files Modified

1. ✅ `ui/src/lib/simpleEndpoint.ts` - Added 404 for missing resources with alternatives
2. ✅ `ui/src/routes/api/mcp/+server.ts` - Map MCP error codes to HTTP status codes
3. ✅ `ui/src/lib/commonErrorHandlers.ts` - Added "not available" pattern and recovery data check

---

## Testing

### Test Cases

**1. Missing Book with Alternatives**
```bash
curl -I "http://localhost:8174/api/fetch-scripture?reference=JHN+3:16&language=es"
# Expected: HTTP/1.1 404 Not Found (was 500)
```

**2. Unknown MCP Tool**
```bash
curl -X POST http://localhost:8174/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"fake_tool"},"id":1}'
# Expected: HTTP/1.1 404 Not Found (was 500)
```

**3. Invalid MCP Parameters**
```bash
curl -X POST http://localhost:8174/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"fetch_scripture"},"id":1}'
# Expected: HTTP/1.1 400 Bad Request (was 500)
```

**4. Unknown MCP Method**
```bash
curl -X POST http://localhost:8174/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"fake/method","params":{},"id":1}'
# Expected: HTTP/1.1 404 Not Found (was 500)
```

### Verification Script

```bash
#!/bin/bash
echo "Testing HTTP Status Code Fixes"
echo "================================"

echo "Test 1: Missing book with alternatives (es-419)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8174/api/fetch-scripture?reference=JHN+3:16&language=es")
echo "Status: $STATUS (Expected: 404)"

echo ""
echo "Test 2: Unknown MCP tool"  
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8174/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"fake_tool"},"id":1}')
echo "Status: $STATUS (Expected: 404)"

echo ""
echo "Test 3: Invalid MCP parameters (missing required)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8174/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"fetch_scripture"},"id":1}')
echo "Status: $STATUS (Expected: 400)"
```

---

## Benefits

### 1. **Semantic Correctness**
- HTTP status codes now accurately reflect error types
- Clients can properly differentiate between error categories

### 2. **Better Client Experience**
- **404**: Retry won't help (resource doesn't exist)
- **400**: Fix your request (bad input)
- **500**: Temporary issue, retry might work

### 3. **Improved Monitoring**
- 404s don't trigger server error alerts
- Clear separation between:
  - **Client errors (4xx)**: User's problem
  - **Server errors (5xx)**: Our problem

### 4. **REST/HTTP Best Practices**
- Aligns with standard HTTP semantics
- More predictable for API consumers
- Better compatibility with HTTP clients

---

## Status Code Decision Tree

```
Error Occurred
    ↓
Has availableBooks/languageVariants?
    YES → 404 Not Found (resource missing, but alternatives exist)
    NO  ↓
Is MCP error?
    YES → Map MCP code:
        - MethodNotFound → 404
        - InvalidParams → 400
        - ParseError → 400
        - InternalError → 500
    NO  ↓
Message includes...?
    - "circuit breaker" → 503 Service Unavailable
    - "dcs api error" → 502 Bad Gateway
    - "timeout" → 504 Gateway Timeout
    - "invalid reference" → 400 Bad Request
    - "book code" → 400 Bad Request
    - "not found/not available" → 404 Not Found
    - Otherwise → 500 Internal Server Error
```

---

## Notes

### JSON-RPC Considerations

For JSON-RPC endpoints, the HTTP status code is separate from the JSON-RPC error code:

**HTTP Layer:**
- 200 OK: Request was processed (JSON-RPC standard)
- 404/400/500: Used by our implementation for better HTTP semantics

**JSON-RPC Layer:**
- -32700: Parse error
- -32600: Invalid Request
- -32601: Method not found
- -32602: Invalid params
- -32603: Internal error
- -32000 to -32099: Server errors

Our implementation uses HTTP status codes for better REST compatibility while maintaining JSON-RPC error codes in the response body.

---

## Deployment

All fixes are backward compatible - only the HTTP status code changes, response bodies remain the same.

**When Active:**
- ✅ Next server restart
- ✅ Production build
- ✅ Cloudflare Pages deployment

**No Breaking Changes:**
- Response format unchanged
- Error messages unchanged
- Recovery data still provided

---

## Summary

✅ **3 files fixed**  
✅ **Semantic correctness improved**  
✅ **No breaking changes**  
✅ **Better monitoring & debugging**  
✅ **Aligned with HTTP/REST standards**  

All error status codes now correctly reflect the nature of the error! 🎯
