# Translation Notes Response Shape Update

## Problem

The previous response shape mixed verse-specific notes and contextual notes (book/chapter introductions) in a single `items` array. This could confuse LLMs about which notes apply to the specific verse requested vs. which are general background information.

## Solution

Split the response into **separate arrays** with explicit labeling:

### New Response Shape

```typescript
{
  reference: "John 3:16",
  
  // Citations (unchanged)
  citation?: "...",           // Single organization
  citations?: [...],          // Multi-organization
  organizations?: [...],      // When multiple orgs searched
  
  // VERSE-SPECIFIC NOTES (for the exact reference requested)
  verseNotes: [
    {
      Reference: "3:16",
      ID: "abc123",
      Note: "**For** here indicates...",
      Quote: "γὰρ",
      Occurrence: "1",
      Occurrences: "0",
      externalReference?: {
        target: "ta",
        path: "translate/grammar-connect-logic-result"
      },
      citation?: "..."          // For multi-org
    }
  ],
  
  // CONTEXTUAL NOTES (general book/chapter background)
  contextNotes: [
    {
      Reference: "front:intro",
      ID: "t6za",
      Note: "# Introduction to John...",
      Quote: "",
      Occurrence: "0",
      Occurrences: "0",
      contextType: "book",      // NEW: "book" or "chapter"
      externalReference?: {...},
      citation?: "..."
    },
    {
      Reference: "3:intro",
      ID: "xyz789",
      Note: "# John 3 General Notes...",
      Quote: "",
      Occurrence: "0",
      Occurrences: "0",
      contextType: "chapter",   // NEW: "book" or "chapter"
      externalReference?: {...}
    }
  ],
  
  counts: {
    totalCount: 9,              // verseNotesCount + contextNotesCount
    verseNotesCount: 7,         // Length of verseNotes array
    contextNotesCount: 2,       // Length of contextNotes array
    totalResources?: 1
  },
  
  metadata: {
    resourceType: "tn",
    subject: "TSV Translation Notes",
    language: "en",
    organization: "unfoldingWord",
    license: "CC BY-SA 4.0"
  }
}
```

## Key Changes

### 1. Separate Arrays

**Before:**
```typescript
items: [
  { Reference: "front:intro", ... },  // Context
  { Reference: "3:intro", ... },      // Context
  { Reference: "3:16", ... },         // Verse-specific
  { Reference: "3:16", ... }          // Verse-specific
]
```

**After:**
```typescript
verseNotes: [
  { Reference: "3:16", ... },
  { Reference: "3:16", ... }
],
contextNotes: [
  { Reference: "front:intro", contextType: "book", ... },
  { Reference: "3:intro", contextType: "chapter", ... }
]
```

### 2. Explicit Context Type

Each contextual note now includes a `contextType` field:
- `"book"` - Book introduction (`front:intro`)
- `"chapter"` - Chapter introduction (e.g., `3:intro`)

### 3. No More `items` Field

The old `items` array is completely removed to prevent confusion.

## Benefits for LLM

1. **Clear Distinction**: LLM can easily identify which notes are for the specific verse vs. general background

2. **Prevents Confusion**: LLM won't mistakenly think a book introduction is a note about verse 3:16

3. **Better Context Building**: Chat system can format them differently:
   ```
   === Translation Notes for John 3:16 ===
   - γὰρ: **For** here indicates...
   
   === Background Context ===
   
   --- Book Introduction (front:intro) ---
   # Introduction to John...
   
   --- Chapter Introduction (3:intro) ---
   # John 3 General Notes...
   ```

4. **Easier to Process**: Simple array access without parsing `Reference` patterns

## Files Modified

### Core Implementation

1. **`ui/src/routes/api/fetch-translation-notes/+server.ts`** (lines 88-163)
   - Separated `items` into `verseNotes` and `contextNotes`
   - Added `contextType` field to contextual notes
   - Maintained counts in separate fields

2. **`ui/src/routes/api/chat-stream/+server.ts`** (lines 1721-1750, 1880-1916)
   - Updated context builder to handle new shape
   - Format verse notes and context notes separately
   - Added clear section headers for LLM

3. **`ui/src/routes/api/execute-prompt/+server.ts`** (lines 670-672, 720)
   - Updated verse-specific note detection to use `verseNotes` array
   - Updated `hasAnyData` check to use `notes?.verseNotes?.length`

### Tests

4. **`ui/tests/api/fetch-translation-notes.test.ts`**
   - Updated basic functionality tests to check `verseNotes` and `contextNotes`
   - Added new test suite for response shape validation
   - Verified `contextType` field is present and correct
   - Ensured old `items` field is not present

### Documentation

5. **`packages/js-sdk/README.md`**
   - Added response structure documentation with example

6. **`packages/python-sdk/README.md`**
   - Added response structure documentation with example

## Testing

### Test Case 1: Verse with Notes
```bash
curl "http://localhost:8174/api/fetch-translation-notes?reference=John+3:16&language=en&organization=unfoldingWord&format=json"
```

**Result:**
- ✅ `verseNotes`: 7 notes
- ✅ `contextNotes`: 2 notes (front:intro, 3:intro)
- ✅ `contextType`: "book" and "chapter" correctly set
- ✅ No `items` field

### Test Case 2: Non-Existent Verse
```bash
curl "http://localhost:8174/api/fetch-translation-notes?reference=Titus+3:16&language=en"
```

**Result:**
- ✅ Returns 404 error
- ✅ Error includes `hasContextOnly: true`
- ✅ Contextual notes NOT included in error response
- ✅ LLM responds: "Tito 3:16 no está disponible" (not available)

### Test Case 3: Chat Integration
```bash
curl -X POST "http://localhost:8174/api/chat-stream" \
  -d '{"message":"Show me translation notes for Titus 3:15"}'
```

**Result:**
- ✅ LLM correctly displays verse-specific notes
- ✅ Context notes formatted separately with clear headers
- ✅ No confusion about which notes apply to the verse

## Backward Compatibility

**Breaking Change**: Yes, the `items` field is removed.

**Migration for SDK Users:**
- Old: `response.items` → Access all notes together
- New: `response.verseNotes` → Verse-specific notes
- New: `response.contextNotes` → Background context

**Why the Breaking Change is OK:**
1. The SDK packages are internal tooling for this project
2. The separation significantly improves LLM understanding
3. The change prevents data confusion and hallucination
4. Migration is straightforward (change array access)

## Context Type Detection Logic

From lines 131-133 in `fetch-translation-notes/+server.ts`:

```typescript
// Determine context type from reference
const contextType = note.reference === 'front:intro' ? 'book' : 'chapter';
```

**Rules:**
- `front:intro` → `contextType: "book"`
- `{chapter}:intro` (e.g., `3:intro`) → `contextType: "chapter"`

## Summary

This update provides a clearer, more explicit structure that helps LLMs:
- Distinguish verse-specific translation help from background context
- Avoid confusing book/chapter introductions as verse-specific guidance
- Process notes more accurately without parsing reference patterns
- Prevent hallucination by making data boundaries explicit

The new shape is live and tested across:
- ✅ Direct API calls (`/api/fetch-translation-notes`)
- ✅ Chat stream integration (`/api/chat-stream`)
- ✅ Execute prompt workflow (`/api/execute-prompt`)
- ✅ Error handling (verseNotFound, hasContextOnly)
