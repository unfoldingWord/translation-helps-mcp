# LLM Hallucination Fix: Verse Not Found Handling

## Problem

When a user asked about a non-existent verse (e.g., **Titus 3:16**, which doesn't exist), the LLM was **hallucinating scripture text**:

> "Pero cuando se manifestó la bondad de Dios nuestro Salvador y su amor hacia los hombres,"

This happened even though the backend correctly detected the verse didn't exist and returned:
```json
{
  "scripture": null,
  "notes": null,
  "questions": { "items": [], "count": 0 },
  "words": [],
  "status": 200  // ← Looks like success!
}
```

## Root Causes

### 1. **`verseNotFound` Flag Lost During Language Variant Retry**

**Flow:**
1. User requests `es` (Spanish) for Titus 3:16
2. First try: `es` → 404 with `languageVariants: ['es-419']` ← `execute-prompt` sees this
3. Auto-retry: `es-419` → 404 with `verseNotFound: true` ← This info is lost!
4. `simpleEndpoint` falls through to return the **original error** (which only has `languageVariants`)
5. `execute-prompt` never sees `verseNotFound`, so it doesn't throw an error

**Problem:** The retry error contained `verseNotFound: true`, but it wasn't preserved when falling back to the original error.

### 2. **`hasContextOnly` Flag Not Tracked in execute-prompt**

When `fetch-translation-notes` returned a 404 with `hasContextOnly: true` (meaning only intro/context notes exist, no verse-specific notes), `execute-prompt` didn't track this error type.

**Code (OLD):**
```typescript
// Step 5: Fetch notes
if (notesRes.ok) {
    results.notes = { ... };
}
// ← No else block! Error silently ignored
```

So `results.notes` stayed `null`, and the verse-not-found check couldn't detect it.

### 3. **Incorrect `hasAnyData` Check**

**Code (OLD):**
```typescript
const hasAnyData =
    results.scripture?.text ||
    results.questions ||              // ← BUG: {items: [], count: 0} is truthy!
    results.words?.length > 0 ||
    results.notes ||                  // ← BUG: {items: [], count: 0} is truthy!
    results.academyArticles?.length > 0;
```

Even when `questions.items` was empty `[]`, the `questions` object itself was truthy (`{reference: ..., items: [], count: 0}`), so `hasAnyData` was `true`.

This caused execute-prompt to return "partial results" (with nulls) instead of throwing an error.

### 4. **Ambiguous Response for LLM**

Returning `{ scripture: null, notes: null, status: 200 }` is ambiguous:
- LLM sees "200 OK" and interprets it as success
- `null` values don't clearly communicate "verse doesn't exist"
- LLM fills in the gaps by hallucinating scripture text

---

## Solutions Implemented

### Fix 1: Preserve `verseNotFound` and `hasContextOnly` Flags from Retry Errors

**File:** `ui/src/lib/simpleEndpoint.ts`

**Change:** When retry fails, preserve critical flags from the retry error on the original error object:

```typescript
// In the retry catch block:
if (retryErrorObj?.verseNotFound) {
    console.log('[simpleEndpoint] ✅ Preserving verseNotFound flag from retry error');
    (error as any).verseNotFound = true;
    (error as any).requestedBook = retryErrorObj.requestedBook;
    (error as any).chapter = retryErrorObj.chapter;
    (error as any).verse = retryErrorObj.verse;
    (error as any).language = suggestedLanguage;
    (error as any).resourcesChecked = retryErrorObj.resourcesChecked;
}

if (retryErrorObj?.hasContextOnly) {
    console.log('[simpleEndpoint] ✅ Preserving hasContextOnly flag from retry error');
    (error as any).hasContextOnly = true;
    (error as any).contextNotesCount = retryErrorObj.contextNotesCount;
}
```

This ensures `execute-prompt` receives complete error information even after auto-retry.

### Fix 2: Track `hasContextOnly` Error in execute-prompt

**File:** `ui/src/routes/api/execute-prompt/+server.ts`

**Change:** Add error handling for context-only notes (both CONDENSED and FULL versions):

```typescript
// Step 5: Fetch notes (CONDENSED version)
if (notesRes.ok) {
    results.notes = { ... };
} else {
    // ← NEW: Check for context-only error
    const errorData = await notesRes.json().catch(() => ({}));
    if (errorData.details?.hasContextOnly) {
        console.log('[execute-prompt] Notes error - context only (no verse-specific notes)');
        // Don't set results.notes at all - keep it undefined/null
        // This will be caught by verseNotFoundError check later
    }
}
```

Now `execute-prompt` properly detects when only contextual notes exist.

### Fix 3: Correct `hasAnyData` Check

**File:** `ui/src/routes/api/execute-prompt/+server.ts`

**Change:** Check for actual data, not just object existence:

```typescript
// OLD:
const hasAnyData =
    results.scripture?.text ||
    results.questions ||              // ← Truthy even when empty!
    results.words?.length > 0 ||
    results.notes ||                  // ← Truthy even when empty!
    results.academyArticles?.length > 0;

// NEW:
const hasAnyData =
    results.scripture?.text ||
    (results.questions?.items?.length > 0) ||  // ← Fixed
    (results.words?.length > 0) ||
    (results.notes?.items?.length > 0) ||      // ← Fixed
    (results.academyArticles?.length > 0);
```

Now `hasAnyData` is `false` when all data arrays are empty.

### Fix 4: Explicit LLM-Friendly Error Message

**File:** `ui/src/routes/api/execute-prompt/+server.ts`

**Change:** Create an unmistakable error message that prevents LLM hallucination:

```typescript
const explicitMessage = `⚠️ VERSE DOES NOT EXIST: ${book} ${chapter}:${verse} is not a valid verse reference.\n\n` +
    `This verse was not found in the ${language} resources. This may be because:\n` +
    `- The verse number exceeds the chapter length\n` +
    `- The chapter doesn't have this many verses\n` +
    `- The reference is incorrect\n\n` +
    `DO NOT fabricate or make up scripture text for this verse. The verse does not exist.`;

const error: any = new Error(explicitMessage);
error.details.explicitError = 'VERSE_DOES_NOT_EXIST';
throw error;
```

### Fix 5: Add Status Code Handling

**File:** `ui/src/routes/api/execute-prompt/+server.ts`

**Change:** Return appropriate HTTP status codes:

```typescript
if (errorDetails?.verseNotFound) {
    status = 404; // Verse not found
} else if (errorDetails?.hasContextOnly) {
    status = 404; // No verse-specific notes
}
```

---

## Verification

### Test 1: Non-Existent Verse (Titus 3:16)

**Request:**
```bash
curl -X POST "http://localhost:8174/api/execute-prompt" \
  -H "Content-Type: application/json" \
  -d '{"promptName":"translation-helps-report","parameters":{"reference":"TIT 3:16","language":"es"}}'
```

**Response:**
```json
{
  "error": "Failed to execute prompt",
  "message": "⚠️ VERSE DOES NOT EXIST: TIT 3:16 is not a valid verse reference.\n\nDO NOT fabricate...",
  "details": {
    "verseNotFound": true,
    "explicitError": "VERSE_DOES_NOT_EXIST",
    "languageVariants": ["es-419"],
    "requestedBook": "TIT",
    "chapter": 3,
    "verse": 16
  }
}
```

**HTTP Status:** 404 ✅

### Test 2: Existing Verse (Titus 3:15)

**Request:**
```bash
curl "http://localhost:8174/api/fetch-translation-notes?reference=Titus%203:15&language=es-419"
```

**Response:**
```json
{
  "scripture": {
    "text": "Te saludan todos los que están conmigo...",
    "translation": "GLT v41",
    ...
  },
  "notes": {
    "items": [
      { "Reference": "front:intro", ... },
      { "Reference": "1:intro", ... },
      { "Reference": "3:15", ... }  // ← Verse-specific notes included
    ],
    "count": 9
  },
  ...
}
```

**HTTP Status:** 200 ✅

---

## Impact

### Before Fix:
- LLM received `200 OK` with `{scripture: null, notes: null}`
- LLM interpreted this as "data might exist" and hallucinated scripture text
- Contextual notes confused the LLM into thinking the verse existed

### After Fix:
- LLM receives `404 Not Found` with explicit "VERSE DOES NOT EXIST" message
- Error details include `verseNotFound: true` and `explicitError: "VERSE_DOES_NOT_EXIST"`
- Clear instructions: "DO NOT fabricate or make up scripture text for this verse"
- LLM cannot miss the error and will correctly inform users the verse doesn't exist

---

## Files Modified

1. **`ui/src/lib/simpleEndpoint.ts`**
   - Preserve `verseNotFound` flag from retry errors
   - Preserve `hasContextOnly` flag from retry errors

2. **`ui/src/routes/api/execute-prompt/+server.ts`**
   - Track `hasContextOnly` errors from notes endpoint
   - Fix `hasAnyData` check to properly count items
   - Add status codes for `verseNotFound` and `hasContextOnly`
   - Create explicit, LLM-friendly error messages

---

## Key Insights

1. **Ambiguous Responses Cause Hallucination**: `null` values with `200 OK` are interpreted as "might have data"
2. **Error Flags Get Lost in Retry Logic**: Critical information from retry errors must be explicitly preserved
3. **Empty Objects Are Truthy**: `{items: [], count: 0}` passes truthiness checks; must explicitly check `.items.length`
4. **LLMs Need Explicit Instructions**: Clear, unmistakable error messages like "DO NOT fabricate" are essential

---

## Testing Recommendations

Test these scenarios to ensure no regression:

1. ✅ Non-existent verse (Titus 3:16) → 404 with explicit error
2. ✅ Existing verse (Titus 3:15) → 200 OK with scripture + notes + context notes
3. ✅ Language variant auto-retry → Preserves verseNotFound flag
4. ✅ Context-only notes (3:intro) → 404, no context notes in error response
5. Test with different languages and books to ensure consistent behavior
