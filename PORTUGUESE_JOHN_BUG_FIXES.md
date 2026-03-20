# Portuguese John 3:16 Bug Fixes

## Issue Summary

User requested "Show me John 3:16 in portuguese" and encountered **multiple critical bugs**:

### 🐛 Bug 1: Incorrect "Invalid Book Code" Error
**Symptom:** Error said `"invalidCode: JHN"` despite JHN being valid  
**Root Cause:** Language with no resources incorrectly treated as "invalid book code"  
**Status:** ✅ FIXED

### 🐛 Bug 2: Language Not Updating on Second Request
**Symptom:** User asked for Spanish, but parameters still showed `"language": "pt"`  
**Root Cause:** LLM reused old language parameter, system didn't override  
**Status:** ✅ FIXED

### 🐛 Bug 3: Status Code Mismatch (Related)
**Symptom:** Debug panel showed "ERROR 500" but message said "failed: 400"  
**Root Cause:** HTTP status not propagating correctly  
**Status:** ✅ FIXED (in previous commit)

---

## Detailed Analysis

### Bug 1: Invalid Book Code Detection Logic Flaw

#### The Problem

**Debug Log Evidence:**
```json
{
  "details": {
    "validBookCodes": [ /* JHN is in this list! */ ],
    "invalidCode": "JHN"  // ❌ Contradictory!
  }
}
```

**What Happened:**
1. User requests John 3:16 in Portuguese (`pt`)
2. System searches for Portuguese resources → **0 results**
3. Tries to find language variants → **0 variants** (Portuguese not in catalog)
4. Tries to find available books → **0 books**
5. Falls into generic error path that assumes "invalid book code"
6. Returns ALL valid book codes + says JHN is invalid (even though it's in the list!)

**Root Cause Location:**  
`ui/src/lib/unifiedResourceFetcher.ts` lines 282-298

**Original Logic (WRONG):**
```typescript
} else {
    // No books or variants available (generic error)
    const validCodes = getBookCodesForError();
    errorMessage = `No scripture found... Please use standard 3-letter book codes...`;
    
    error.validBookCodes = validCodes;
    error.invalidCode = requestedBook;  // ❌ WRONG: JHN IS valid!
}
```

**Problem:** Didn't distinguish between:
- **Invalid book code** (e.g., "NOTABOOK") → Should show valid codes
- **Valid book, unsupported language** (e.g., "JHN" in Portuguese) → Should say "language not supported"

#### The Fix

**New Logic (CORRECT):**
```typescript
} else {
    // Check if book code is actually valid
    const bookCode3Letter = requestedBook.toUpperCase().substring(0, 3);
    const isValidBookCode = getBookNameFromCode(bookCode3Letter) !== null;
    
    if (isValidBookCode) {
        // ✅ Book is valid, language has no resources
        errorMessage = `No scripture resources available for language '${language}'.\n\n` +
            `The requested book (${parsed.book}) exists, but we don't have any resources in this language.\n\n` +
            `Try a different language code or check which languages are available.`;
        
        error.requestedLanguage = language;
        error.requestedBook = parsed.book;
    } else {
        // ❌ Book code itself is invalid
        const validCodes = getBookCodesForError();
        errorMessage = `Invalid book reference '${requestedBook}'.\n\n` +
            `Please use standard 3-letter book codes...`;
        
        error.validBookCodes = validCodes;
        error.invalidCode = requestedBook;
    }
}
```

**Key Change:** Now validates the book code FIRST before deciding error type.

---

### Bug 2: Language Parameter Not Updating

#### The Problem

**Debug Log Evidence:**
```
Request 1: "Show me John 3:16 in portuguese"
  → Params: {"language": "pt"}  ✅ Correct

Request 2: "Can you find it in spanish?"
  → System prompt: "DETECTED: es-419 - use this code"  ✅ Correct detection
  → Params: {"language": "pt"}  ❌ WRONG! Should be "es-419"
```

**What Happened:**
1. First request: User says "in portuguese" → Detects `pt` → LLM uses `pt`
2. Second request: User says "in spanish" → Detects `es-419` → Adds to system prompt
3. BUT: LLM provides tool call with `language: "pt"` (from previous context/memory)
4. Code only sets language if NOT provided: `if (!normalizedParams.language) { ... }`
5. Since LLM provided a language (even though wrong), it wasn't overridden

**Root Cause Location:**  
`ui/src/routes/api/chat-stream/+server.ts` lines 1153-1159

**Original Logic (WRONG):**
```typescript
const normalizedParams: Record<string, any> = {
    ...call.params
};

// Only set language if NOT provided
if (!normalizedParams.language) {
    normalizedParams.language = language;
}
```

**Problem:** Trusted LLM's language parameter completely, even when language detection found a different language.

#### The Fix

**New Logic (CORRECT):**
```typescript
const normalizedParams: Record<string, any> = {
    ...call.params
};

// Language parameter handling with detected language override
if (!normalizedParams.language) {
    // No language provided - use detected or default
    normalizedParams.language = languageInfo?.detectedLanguage || language;
} else if (languageInfo?.detectedLanguage && 
    normalizedParams.language !== languageInfo.detectedLanguage &&
    languageInfo.needsValidation) {
    // LLM provided language doesn't match detected - override with detected
    // This fixes cases where LLM reuses old language from previous request
    logger.info('Overriding LLM language param with detected language', {
        llmProvided: normalizedParams.language,
        detected: languageInfo.detectedLanguage
    });
    normalizedParams.language = languageInfo.detectedLanguage;
}
```

**Key Changes:**
1. If no language: Use detected language (if available) before fallback
2. If language provided BUT doesn't match detected: **Override with detected**
3. Logs the override for debugging

---

## Test Cases

### Test 1: Valid Book, Unsupported Language
```bash
curl "http://localhost:8174/api/fetch-scripture?reference=JHN+3:16&language=xyz&format=json"
```

**Before Fix:**
```json
{
  "error": "No scripture found... Please use standard 3-letter book codes...",
  "details": {
    "validBookCodes": [/* ALL book codes */],
    "invalidCode": "JHN"  // ❌ WRONG
  }
}
```

**After Fix:**
```json
{
  "error": "No scripture resources available for language 'xyz'.\n\nThe requested book (John) exists, but we don't have any resources in this language...",
  "details": {
    "requestedLanguage": "xyz",
    "requestedBook": "John"  // ✅ CORRECT
  }
}
```

### Test 2: Invalid Book Code
```bash
curl "http://localhost:8174/api/fetch-scripture?reference=NOTABOOK+1:1&language=en&format=json"
```

**Before Fix:**
```json
{
  "error": "No scripture found...",
  "details": {
    "validBookCodes": [/* ALL book codes */],
    "invalidCode": "NOTABOOK"  // ✅ This was already correct
  }
}
```

**After Fix:** (Same, still correct)
```json
{
  "error": "Invalid book reference 'NOTABOOK'...",
  "details": {
    "validBookCodes": [/* ALL book codes */],
    "invalidCode": "NOTABOOK"  // ✅ Still correct
  }
}
```

### Test 3: Language Switch in Chat
**Chat Interface Test:**

```
User: "Show me John 3:16 in portuguese"
  → Expected: Error (Portuguese not supported)

User: "Can you find it in spanish?"
  → Expected: Success with es-419 scripture (auto-retry)
```

**Before Fix:**
- Second request still used `pt` parameter ❌

**After Fix:**
- Second request correctly uses `es-419` parameter ✅

---

## Error Message Improvements

### Before: Confusing Error
```
No scripture found for reference 'JHN 3:16' in language 'pt'. 
No resources matched the requested book. 
Please use standard 3-letter book codes (e.g., GEN for Genesis, JHN for John, MAT for Matthew).

Available book codes: [lists all books including JHN]
Invalid code: JHN
```

**Problem:** Says JHN is invalid while also listing it as valid!

### After: Clear Error
```
No scripture resources available for language 'pt'.

The requested book (John) exists, but we don't have any resources in this language.

Try a different language code or check which languages are available.
```

**Improvement:** 
- ✅ Clearly states the issue (language not supported)
- ✅ Confirms book is valid
- ✅ Suggests actionable solution
- ✅ No contradictory information

---

## Files Modified

### 1. `ui/src/lib/unifiedResourceFetcher.ts`
**Lines 282-322:** Added book code validation before determining error type

**Change Summary:**
- Check if book code is valid using `getBookNameFromCode()`
- If valid: Return "language not supported" error
- If invalid: Return "invalid book code" error with suggestions

### 2. `ui/src/routes/api/chat-stream/+server.ts`
**Lines 1153-1173:** Added detected language override logic

**Change Summary:**
- Override LLM's language parameter if detected language differs
- Log overrides for debugging
- Prefer detected language over LLM-provided language

---

## Impact

### User Experience
✅ **Clear Error Messages** - No more contradictory "JHN is invalid but here's JHN in the list"  
✅ **Correct Language Detection** - Spanish requests now use Spanish, not Portuguese  
✅ **Better Guidance** - Users told the real problem (language not supported) with actionable next steps  

### Developer Experience
✅ **Easier Debugging** - Logs show when language parameters are overridden  
✅ **Semantic Correctness** - Error types match actual root causes  
✅ **Maintainability** - Logic clearly distinguishes error categories  

### LLM Behavior
✅ **More Resilient** - System corrects LLM mistakes automatically  
✅ **Better Context** - LLM receives correct error type to generate helpful responses  
✅ **Reduced Confusion** - No more mixed signals about what went wrong  

---

## Related Fixes

This fix builds on previous improvements:
- ✅ **Status Code Fixes** (`STATUS_CODE_AUDIT_FIXES.md`) - 404 for missing resources
- ✅ **Auto-Retry System** (`TEST_SUITE_SUMMARY.md`) - Language variant discovery
- ✅ **Available Books** (`FINAL_VALIDATION_REPORT.md`) - Book suggestions

---

## Testing Checklist

- [x] Valid book, unsupported language → Correct error message
- [x] Invalid book code → Shows valid codes
- [x] Language switch in chat → Uses new language
- [x] Portuguese request → Clear "not supported" message
- [x] Spanish retry → Auto-retries with es-419
- [x] No contradictory error data
- [x] Logging shows overrides

---

## Summary

✅ **Fixed incorrect "invalid book code" detection** - Now distinguishes between invalid book vs unsupported language  
✅ **Fixed language parameter not updating** - System overrides LLM's stale language param  
✅ **Improved error messages** - Clear, non-contradictory, actionable feedback  
✅ **Better LLM integration** - System corrects LLM mistakes automatically  

The Portuguese John 3:16 issue is now fully resolved! 🎯
