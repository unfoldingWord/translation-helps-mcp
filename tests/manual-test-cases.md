# Manual Test Cases for Automatic Retry System

## Overview
This document provides manual test cases for the automatic retry mechanism that handles language variants and provides available book suggestions.

## Test Environment
- **Server:** `http://localhost:8174`
- **Chat Interface:** `http://localhost:8174/chat`
- **API Endpoint:** `/api/fetch-scripture`
- **MCP Endpoint:** `/api/mcp` (JSON-RPC 2.0)

---

## Test Case 1: Successful Auto-Retry (Language Variant)

**Scenario:** User requests scripture in base language (`es`) that has variant (`es-419`) with the requested book available.

### API Test
```bash
curl "http://localhost:8174/api/fetch-scripture?reference=JON+1:1&language=es&format=json"
```

**Expected Result:**
```json
{
  "scripture": [
    {
      "text": "Y la palabra de Jehová vino a Jonás hijo de Amitai...",
      "translation": "GLT v88",
      "citation": {
        "language": "es-419",
        ...
      }
    }
  ],
  "counts": { "totalCount": 2 }
}
```

**Headers to Check:**
- `X-Retry: true`
- `X-Original-Language: es`
- `X-Retry-Language: es-419`

### Chat Test
**Input:** `"show me jonah 1:1 in spanish"`

**Expected Response:**
> Scripture text in Spanish (es-419) appears directly without any error messages.

**Debug Panel Should Show:**
- No error entries (retry was successful internally)
- Or original error marked as `(auto-retried)` + success entry

---

## Test Case 2: Auto-Retry with Available Books Suggestion

**Scenario:** User requests scripture in base language (`es`) for a book that doesn't exist in the variant (`es-419`), but other books are available.

### API Test
```bash
curl "http://localhost:8174/api/fetch-scripture?reference=JHN+3:16&language=es&format=json"
```

**Expected Result:**
```json
{
  "error": "The book of John is not available in es-419...",
  "details": {
    "availableBooks": [
      { "code": "3JN", "name": "3 John" },
      { "code": "JON", "name": "Jonah" },
      { "code": "RUT", "name": "Ruth" },
      { "code": "TIT", "name": "Titus" }
    ],
    "requestedBook": "John",
    "language": "es-419"
  },
  "status": 404
}
```

### Chat Test
**Input:** `"show me john 3:16 in spanish"`

**Expected Response:**
> "The book of John is not available in Spanish (es-419), but I found these books available:
> - 3 John
> - Jonah
> - Ruth
> - Titus
> 
> Would you like to see a verse from one of these books instead?"

**Debug Panel Should Show:**
- 📖 Available Books in es-419
- List of 4 books
- Requested: John (not available)

---

## Test Case 3: Invalid Book Code

**Scenario:** User provides a completely invalid book code.

### API Test
```bash
curl "http://localhost:8174/api/fetch-scripture?reference=NOTABOOK+1:1&language=en&format=json"
```

**Expected Result:**
```json
{
  "error": "Invalid reference format...",
  "details": {
    "invalidCode": "NOTABOOK",
    "validBookCodes": [/* array of valid codes */]
  },
  "status": 400
}
```

### Chat Test
**Input:** `"show me notabook 1:1"`

**Expected Response:**
> "I couldn't find a book named 'notabook'. Please use standard book names or codes like:
> - Genesis (GEN)
> - John (JHN)
> - Matthew (MAT)"

---

## Test Case 4: Valid Request (Baseline)

**Scenario:** User requests scripture in a language with full resources.

### API Test
```bash
curl "http://localhost:8174/api/fetch-scripture?reference=JHN+3:16&language=en&format=json"
```

**Expected Result:**
```json
{
  "scripture": [
    {
      "text": "For God so loved the world...",
      "translation": "ULT v88",
      "citation": { "language": "en", ... }
    },
    {
      "text": "This is because God loved...",
      "translation": "UST v88",
      "citation": { "language": "en", ... }
    }
  ],
  "counts": { "totalCount": 4 }
}
```

**Headers:**
- No retry headers (worked on first attempt)

### Chat Test
**Input:** `"show me john 3:16"`

**Expected Response:**
> Scripture appears in multiple translations (ULT, UST, T4T, BSB)

---

## Test Case 5: MCP Protocol Integration

**Scenario:** Same tests through MCP JSON-RPC 2.0 endpoint.

### MCP Test (Available Book)
```bash
curl -X POST http://localhost:8174/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "fetch_scripture",
      "arguments": {
        "reference": "JON 1:1",
        "language": "es",
        "format": "json"
      }
    },
    "id": 1
  }'
```

**Expected:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"scripture\":[...], \"counts\":{\"totalCount\":2}}"
    }]
  },
  "id": 1
}
```

### MCP Test (Unavailable Book)
```bash
curl -X POST http://localhost:8174/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "fetch_scripture",
      "arguments": {
        "reference": "JHN 3:16",
        "language": "es",
        "format": "json"
      }
    },
    "id": 1
  }'
```

**Expected:**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Tool endpoint failed: 500",
    "data": {
      "availableBooks": [
        { "code": "3JN", "name": "3 John" },
        { "code": "JON", "name": "Jonah" },
        { "code": "RUT", "name": "Ruth" },
        { "code": "TIT", "name": "Titus" }
      ],
      "requestedBook": "John",
      "language": "es-419"
    }
  },
  "id": 1
}
```

---

## Test Case 6: Chat Interface Integration

**Scenario:** Test complete user experience through chat interface.

### Test 6A: Successful Auto-Retry
1. Navigate to `http://localhost:8174/chat`
2. Type: `"show me jonah 1:1 in spanish"`
3. **Expected:** Spanish text appears immediately (no error visible to user)

### Test 6B: Available Books Suggestion
1. Navigate to `http://localhost:8174/chat`
2. Type: `"show me john 3:16 in spanish"`
3. **Expected:** LLM explains John is not available and suggests 3 John, Jonah, Ruth, or Titus
4. Type: `"show me jonah 1:1 instead"`
5. **Expected:** Spanish Jonah text appears

---

## Verification Checklist

### Server Logs to Check
- [ ] `[simpleEndpoint] 🔄 Retrying with language variant: es-419`
- [ ] `[simpleEndpoint] ✅ Auto-retry succeeded with es-419` (for Jonah)
- [ ] `[simpleEndpoint] ✅ Retry found N available books` (for John)
- [ ] `[INFO] Extracted N available books from catalog`

### Browser Console to Check (Chat)
- [ ] `[SDK] ✅ Attaching availableBooks: N books`
- [ ] `[CHAT] ✅ Retry provided useful data (availableBooks)`
- [ ] No `retryParams is not defined` errors

### Debug Panel to Check
- [ ] "🔄 Auto-Retry Data Available" for language variants
- [ ] "📖 Available Books in es-419" for book alternatives
- [ ] Book list shows: 3 John, Jonah, Ruth, Titus (4 unique books)
- [ ] No duplicates in book list

---

## Edge Cases to Test

1. **Language with no variants:** `language=xyz` → Generic error
2. **Language variant with no books:** (none currently exist)
3. **Multiple language variants:** Test with languages that have multiple variants
4. **Verse ranges:** `JON 1:1-5&language=es` → Should auto-retry correctly
5. **Invalid chapter/verse:** `JON 999:999&language=es` → Should auto-retry then report invalid reference

---

## Known Issues and Limitations

1. **Limited Spanish Resources:** The `es-419` tc-ready resources only contain 4 books:
   - 3 John (3JN)
   - Jonah (JON)  
   - Ruth (RUT)
   - Titus (TIT)

2. **Duplicate Detection:** Book list may contain duplicates if multiple resources have the same books (fixed with deduplication)

3. **Book Code vs Name:** System handles both 3-letter codes (JHN) and full names (John) correctly

---

## Success Criteria

✅ **Auto-Retry Works When:**
- Language has no direct resources but has variants
- Variant has the requested book
- Results returned transparently (no error to user)

✅ **Available Books Works When:**
- Auto-retry finds language variant
- Requested book not in variant
- System returns list of available books
- LLM can guide user to alternatives

✅ **Error Handling Works When:**
- Invalid book codes detected
- Language has no variants
- Helpful recovery data provided in all error cases
