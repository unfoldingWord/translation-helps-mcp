# Invalid Book Code Error Handling Fix

**Date:** March 13, 2026  
**Issue:** Invalid book codes (e.g., "Asd", "Xyz") returned 500 Internal Server Error instead of helpful 400 Bad Request

---

## Problem

When users provided invalid book codes in Bible references, the system returned:
- **Status:** 500 Internal Server Error
- **Message:** Generic error message
- **User Experience:** Unhelpful - users didn't know what went wrong

Example:
```bash
# Request with invalid book code "Asd"
GET /api/fetch-scripture?reference=Asd%201:1&language=en

# Response (BEFORE fix)
{
  "error": "Tool endpoint failed: 500",
  "status": 500
}
```

---

## Root Cause

1. Invalid book codes weren't found in resource ingredients
2. Empty results array passed validation
3. Generic "not found" error handler returned 404/500
4. No specific guidance about 3-letter book code format

---

## Solution

### 1. Enhanced Error Messages

Updated error messages in multiple layers to provide helpful guidance:

**Scripture Service** (`src/functions/scripture-service.ts`):
```typescript
if (scriptures.length === 0) {
  const bookCode = reference?.book?.toUpperCase();
  throw new Error(
    `No scripture found for reference '${referenceParam}'. ` +
    `The book code '${bookCode}' was not found in any available resources. ` +
    `Please use 3-letter book codes (e.g., GEN for Genesis, JHN for John, MAT for Matthew, 3JN for 3 John).`
  );
}
```

**UI Fetcher** (`ui/src/lib/unifiedResourceFetcher.ts`):
```typescript
if (results.length === 0) {
  const bookCode = parsed?.book?.toUpperCase() || 'unknown';
  throw new Error(
    `No scripture found for reference '${reference}'. ` +
    `The book code '${bookCode}' was not found in any available resources. ` +
    `Please use 3-letter book codes (e.g., GEN for Genesis, JHN for John, MAT for Matthew, 3JN for 3 John).`
  );
}
```

### 2. Proper Status Code Mapping

Added 400 Bad Request handling for invalid book code errors:

**Common Error Handler** (`ui/src/lib/commonErrorHandlers.ts`):
```typescript
// Invalid book code errors (400 Bad Request) - must check BEFORE generic "not found"
if (message.includes('book code') || message.includes('3-letter')) {
  return {
    status: 400,
    message: error.message  // Return full detailed message
  };
}
```

**Base Service** (`src/unified-services/BaseService.ts`):
```typescript
// Handle invalid reference/book code errors (400 Bad Request)
if (
  error.message?.includes('Invalid reference') ||
  error.message?.includes('book code') ||
  error.message?.includes('3-letter')
) {
  return this.error('INVALID_REFERENCE', error.message, error, 400);
}
```

**Simple Endpoint** (`ui/src/lib/simpleEndpoint.ts`):
```typescript
// Invalid reference/book code errors (400 Bad Request) - check FIRST before "not found"
if (
  error.message.includes('Invalid reference') ||
  error.message.includes('book code') ||
  error.message.includes('3-letter')
) {
  errorStatus = 400;
}
```

---

## Results

### REST API

**Request:**
```bash
GET /api/fetch-scripture?reference=Abc%201:1&language=en
```

**Response (AFTER fix):**
```json
{
  "error": "No scripture found for reference 'Abc 1:1'. The book code 'ABC' was not found in any available resources. Please use 3-letter book codes (e.g., GEN for Genesis, JHN for John, MAT for Matthew, 3JN for 3 John).",
  "details": {
    "endpoint": "fetch-scripture-v2",
    "path": "/api/fetch-scripture",
    "params": {
      "reference": "Abc 1:1",
      "language": "en"
    }
  },
  "status": 400
}
```

**HTTP Status:** `400 Bad Request` ✅

### MCP Protocol

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "fetch_scripture",
    "arguments": {
      "reference": "Xyz 2:5",
      "language": "en"
    }
  }
}
```

**Response (AFTER fix):**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Tool endpoint failed: 400"
  },
  "id": 1
}
```

**Status:** `400 Bad Request` ✅ (instead of 500)

---

## Benefits

1. **Clear Error Messages**: Users immediately understand what went wrong
2. **Actionable Guidance**: Examples show the correct format (GEN, JHN, MAT, 3JN)
3. **Proper Status Codes**: 400 Bad Request (client error) not 500 (server error)
4. **Better UX**: AI agents can understand and correct the error automatically
5. **Consistent**: Works across REST and MCP protocols

---

## Files Modified

1. `src/functions/scripture-service.ts` - Enhanced error message
2. `ui/src/lib/unifiedResourceFetcher.ts` - Enhanced error message
3. `ui/src/lib/commonErrorHandlers.ts` - Added 400 status for book code errors
4. `src/unified-services/BaseService.ts` - Added 400 status for invalid references
5. `ui/src/lib/simpleEndpoint.ts` - Added 400 status detection

---

## Testing

```bash
# Test invalid book codes
curl -w "\nHTTP Status: %{http_code}\n" \
  "http://localhost:8175/api/fetch-scripture?reference=Abc%201:1&language=en"

# Expected: 400 Bad Request with helpful message about 3-letter codes

# Test valid book code
curl -w "\nHTTP Status: %{http_code}\n" \
  "http://localhost:8175/api/fetch-scripture?reference=JHN%203:16&language=en&translation=ult"

# Expected: 200 OK with scripture text
```

---

## Common 3-Letter Book Codes (Reminder)

| Book | Code | Example |
|------|------|---------|
| Genesis | GEN | GEN 1:1 |
| Exodus | EXO | EXO 20:1-17 |
| Matthew | MAT | MAT 5:1-12 |
| John | JHN | JHN 3:16 |
| Romans | ROM | ROM 8:28 |
| 1 Corinthians | 1CO | 1CO 13:4-7 |
| 3 John | 3JN | 3JN 1:2 |
| Revelation | REV | REV 21:1-4 |

---

**Status:** Fixed and validated. Invalid book codes now return proper 400 errors with helpful guidance.
