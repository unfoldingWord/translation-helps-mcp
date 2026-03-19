# Valid Book Codes in Error Responses Enhancement

## Summary

Enhanced invalid book code error responses to include a complete list of all 66 valid 3-letter Bible book codes, enabling AI agents to automatically correct errors without additional round-trips.

## Problem

When an AI agent provided an invalid book code (e.g., "Genesis" instead of "GEN"), the error message instructed using 3-letter codes but didn't provide the complete list. This meant:
- Agents needed to make additional requests to discover valid codes
- No programmatic way to map common book names to codes
- Suboptimal user experience for automated tools

## Solution

### 1. Created Centralized Book Codes Module

**File:** `src/utils/book-codes.ts`

```typescript
export const VALID_BOOK_CODES = {
  // Old Testament (39 books)
  GEN: 'Genesis',
  EXO: 'Exodus',
  // ... all 39 OT books
  
  // New Testament (27 books)
  MAT: 'Matthew',
  MRK: 'Mark',
  // ... all 27 NT books
} as const;

// Utility functions for validation and error formatting
export function getValidBookCodes(): string[];
export function isValidBookCode(code: string): boolean;
export function getBookName(code: string): string | undefined;
export function getBookCodesForError(): Array<{ code: string; name: string }>;
```

**Benefits:**
- Single source of truth for valid codes
- Reusable across all services
- Type-safe with TypeScript
- Easy to maintain and extend

### 2. Updated Error Generation

**Modified Files:**
- `src/functions/scripture-service.ts`
- `ui/src/lib/unifiedResourceFetcher.ts`

**Changes:**
```typescript
import { getBookCodesForError } from '../utils/book-codes.js';

if (scriptures.length === 0) {
  const bookCode = reference?.book?.toUpperCase();
  const validCodes = getBookCodesForError();  // Get all 66 codes
  
  const error: any = new Error(
    `No scripture found for reference '${referenceParam}'. ` +
    `The book code '${bookCode}' was not found in any available resources. ` +
    `Please use 3-letter book codes (e.g., GEN for Genesis, JHN for John).`
  );
  
  // Attach structured data for AI agents
  error.validBookCodes = validCodes;  // Array of {code, name} objects
  error.invalidCode = bookCode;       // The invalid code provided
  
  throw error;
}
```

### 3. Enhanced REST Error Responses

**Modified File:** `ui/src/lib/simpleEndpoint.ts`

**Changes:**
```typescript
// Build detailed error response
const errorDetails: any = {
  endpoint: config.name,
  path: url.pathname,
  params: parsedParams || {},
  timestamp: new Date().toISOString()
};

// Include valid book codes for invalid book code errors
if ((error as any)?.validBookCodes) {
  errorDetails.validBookCodes = (error as any).validBookCodes;
  errorDetails.invalidCode = (error as any).invalidCode;
}
```

### 4. Enhanced MCP Error Responses

**Modified Files:**
- `ui/src/lib/mcp/UnifiedMCPHandler.ts`
- `ui/src/routes/api/mcp/+server.ts`

**UnifiedMCPHandler Changes:**
```typescript
if (!response.ok) {
  let errorBody: any = null;
  try {
    errorBody = await response.json();
    errorDetails = errorBody.details || {};
  } catch (parseError) {
    console.warn('[UNIFIED HANDLER] Failed to parse error response body');
  }
  
  // Create enhanced error with details attached
  const error: any = new Error(`Tool endpoint failed: ${response.status}`);
  error.details = errorDetails;
  
  // Include helpful book code info for AI agents
  if (errorDetails.validBookCodes) {
    error.validBookCodes = errorDetails.validBookCodes;
    error.invalidCode = errorDetails.invalidCode;
  }
  
  throw error;  // Now outside try/catch to prevent accidental catch
}
```

**MCP Endpoint Changes:**
```typescript
const errorData: any = {
  code: -32000,
  message: error instanceof Error ? error.message : 'Tool execution failed'
};

// Include validBookCodes for AI agents if available
const errorObj = error as any;
if (errorObj?.validBookCodes) {
  errorData.data = {
    validBookCodes: errorObj.validBookCodes,
    invalidCode: errorObj.invalidCode
  };
} else if (errorObj?.details?.validBookCodes) {
  errorData.data = {
    validBookCodes: errorObj.details.validBookCodes,
    invalidCode: errorObj.details.invalidCode
  };
}

return json({
  jsonrpc: '2.0',
  error: errorData,
  id: id ?? 0
});
```

## Response Examples

### REST API Error Response

**Request:** `GET /api/fetch-scripture?reference=InvalidBook 1:1&language=en`

**Response:** (HTTP 400 Bad Request)
```json
{
  "error": "No scripture found for reference 'InvalidBook 1:1'. The book code 'INVALIDBOOK' was not found in any available resources. Please use 3-letter book codes (e.g., GEN for Genesis, JHN for John, MAT for Matthew, 3JN for 3 John).",
  "details": {
    "endpoint": "fetch-scripture-v2",
    "path": "/api/fetch-scripture",
    "params": {
      "reference": "InvalidBook 1:1",
      "language": "en"
    },
    "timestamp": "2026-03-13T10:15:00.000Z",
    "validBookCodes": [
      {"code": "GEN", "name": "Genesis"},
      {"code": "EXO", "name": "Exodus"},
      {"code": "LEV", "name": "Leviticus"},
      ... // All 66 books
      {"code": "3JN", "name": "3 John"},
      {"code": "JUD", "name": "Jude"},
      {"code": "REV", "name": "Revelation"}
    ],
    "invalidCode": "INVALIDBOOK"
  },
  "status": 400
}
```

### MCP Error Response

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "fetch_scripture",
    "arguments": {
      "reference": "BadCode 1:1",
      "language": "en"
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Tool endpoint failed: 400",
    "data": {
      "validBookCodes": [
        {"code": "GEN", "name": "Genesis"},
        {"code": "EXO", "name": "Exodus"},
        ... // All 66 books
        {"code": "REV", "name": "Revelation"}
      ],
      "invalidCode": "BADCODE"
    }
  },
  "id": 1
}
```

## Complete List of Valid Book Codes

### Old Testament (39 books)

| Code | Book Name |
|------|-----------|
| GEN  | Genesis |
| EXO  | Exodus |
| LEV  | Leviticus |
| NUM  | Numbers |
| DEU  | Deuteronomy |
| JOS  | Joshua |
| JDG  | Judges |
| RUT  | Ruth |
| 1SA  | 1 Samuel |
| 2SA  | 2 Samuel |
| 1KI  | 1 Kings |
| 2KI  | 2 Kings |
| 1CH  | 1 Chronicles |
| 2CH  | 2 Chronicles |
| EZR  | Ezra |
| NEH  | Nehemiah |
| EST  | Esther |
| JOB  | Job |
| PSA  | Psalms |
| PRO  | Proverbs |
| ECC  | Ecclesiastes |
| SNG  | Song of Solomon |
| ISA  | Isaiah |
| JER  | Jeremiah |
| LAM  | Lamentations |
| EZK  | Ezekiel |
| DAN  | Daniel |
| HOS  | Hosea |
| JOL  | Joel |
| AMO  | Amos |
| OBA  | Obadiah |
| JON  | Jonah |
| MIC  | Micah |
| NAM  | Nahum |
| HAB  | Habakkuk |
| ZEP  | Zephaniah |
| HAG  | Haggai |
| ZEC  | Zechariah |
| MAL  | Malachi |

### New Testament (27 books)

| Code | Book Name |
|------|-----------|
| MAT  | Matthew |
| MRK  | Mark |
| LUK  | Luke |
| JHN  | John |
| ACT  | Acts |
| ROM  | Romans |
| 1CO  | 1 Corinthians |
| 2CO  | 2 Corinthians |
| GAL  | Galatians |
| EPH  | Ephesians |
| PHP  | Philippians |
| COL  | Colossians |
| 1TH  | 1 Thessalonians |
| 2TH  | 2 Thessalonians |
| 1TI  | 1 Timothy |
| 2TI  | 2 Timothy |
| TIT  | Titus |
| PHM  | Philemon |
| HEB  | Hebrews |
| JAS  | James |
| 1PE  | 1 Peter |
| 2PE  | 2 Peter |
| 1JN  | 1 John |
| 2JN  | 2 John |
| 3JN  | 3 John |
| JUD  | Jude |
| REV  | Revelation |

## Benefits for AI Agents

### 1. **Immediate Error Correction**
AI agents can now automatically correct invalid book codes without additional API calls:

```python
# AI Agent Logic Example
try:
    scripture = fetch_scripture("Genesis 1:1", "en")
except InvalidBookCodeError as e:
    # Access valid codes from error response
    valid_codes = e.response['details']['validBookCodes']
    invalid = e.response['details']['invalidCode']  # "GENESIS"
    
    # Find correct code by name matching
    correct_code = next(
        c['code'] for c in valid_codes 
        if c['name'].lower() == 'genesis'
    )  # Returns "GEN"
    
    # Retry with correct code
    scripture = fetch_scripture("GEN 1:1", "en")
```

### 2. **Fuzzy Matching Support**
Agents can implement fuzzy matching to handle typos:

```python
from difflib import get_close_matches

invalid_code = "Genisis"  # Typo
book_names = [c['name'] for c in valid_codes]
closest_match = get_close_matches(invalid_code, book_names, n=1)[0]
# Returns: "Genesis"

correct_code = next(c['code'] for c in valid_codes if c['name'] == closest_match)
# Returns: "GEN"
```

### 3. **Name-to-Code Mapping**
Build a lookup table for instant translation:

```python
# Build mapping from error response
name_to_code = {
    c['name'].lower(): c['code'] 
    for c in error_response['data']['validBookCodes']
}

# Use it
code = name_to_code.get('john')  # Returns: "JHN"
code = name_to_code.get('1 corinthians')  # Returns: "1CO"
```

### 4. **User-Friendly Suggestions**
Present helpful corrections to end users:

```
❌ Error: Book code 'Jhn' not found

✅ Did you mean "JHN" (John)?

Available codes starting with 'J':
- JHN (John)
- JOB (Job)
- JOL (Joel)
- JON (Jonah)
- JAS (James)
- JER (Jeremiah)
- JDG (Judges)
- JUD (Jude)
```

## Testing

### REST Endpoint

```bash
# Test with invalid code
curl "http://localhost:8175/api/fetch-scripture?reference=InvalidBook%201:1&language=en"

# Verify response includes:
# ✅ HTTP 400 status
# ✅ Clear error message
# ✅ validBookCodes array (66 items)
# ✅ invalidCode field
```

### MCP Endpoint

```bash
curl -X POST "http://localhost:8175/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "fetch_scripture",
      "arguments": {
        "reference": "BadCode 1:1",
        "language": "en"
      }
    }
  }'

# Verify response includes:
# ✅ JSON-RPC 2.0 error object
# ✅ error.data.validBookCodes array (66 items)
# ✅ error.data.invalidCode field
```

## Validation Results

✅ **REST API:** Returns 66 valid book codes in `details.validBookCodes`  
✅ **MCP API:** Returns 66 valid book codes in `error.data.validBookCodes`  
✅ **Invalid Code:** Echoed back in both `invalidCode` fields  
✅ **HTTP Status:** Correct 400 Bad Request status  
✅ **Error Message:** Clear, actionable guidance  
✅ **JSON-RPC:** Compliant with MCP error structure  

## Files Modified

1. **Created:**
   - `src/utils/book-codes.ts` - Centralized book code definitions

2. **Modified:**
   - `src/functions/scripture-service.ts` - Added validBookCodes to errors
   - `ui/src/lib/unifiedResourceFetcher.ts` - Added validBookCodes to errors
   - `ui/src/lib/simpleEndpoint.ts` - Include validBookCodes in REST error details
   - `ui/src/lib/mcp/UnifiedMCPHandler.ts` - Extract and preserve validBookCodes from errors
   - `ui/src/routes/api/mcp/+server.ts` - Include validBookCodes in JSON-RPC error.data

## Impact

**Before:**
- AI agent receives: "Invalid book code"
- Agent must guess or make additional discovery calls
- Poor user experience, multiple round-trips

**After:**
- AI agent receives: Full list of 66 valid codes + invalid code provided
- Agent can immediately correct the error
- Single round-trip, better UX, faster response

## Future Enhancements

Potential improvements:
1. **Localized Book Names:** Add translations for book names in other languages
2. **Alternate Codes:** Support additional book code standards (e.g., OSIS codes)
3. **Validation Endpoint:** Create dedicated `/api/validate-book-code` endpoint
4. **Client Libraries:** Add book code validation to JS/Python SDKs
5. **Fuzzy Matching:** Server-side fuzzy matching with suggestions in error
6. **Abbreviations:** Support common abbreviations (e.g., "Gen", "Exo", "Jn")

---

**Status:** ✅ Implemented and tested  
**Date:** March 13, 2026  
**Impact:** Significantly improves AI agent error recovery and reduces API calls
