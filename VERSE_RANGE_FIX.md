# Verse Range Bug Fix

## Problem
When fetching translation notes, questions, or word links for a **verse range** like "John 3:16-19", the API was only returning data for **verse 16**, not the entire range (verses 16, 17, 18, 19).

However, `fetch_scripture` worked correctly for verse ranges.

## Root Cause
There was a **naming mismatch** between two different reference parser implementations:

### File 1: `src/functions/reference-parser.ts`
Used by translation notes/questions/word links services.

**Interface (OLD):**
```typescript
export interface Reference {
  verse?: number;
  verseEnd?: number;  // ❌ Wrong field name
}
```

**Parser output (OLD):**
```typescript
return {
  verse: 16,
  verseEnd: 19  // ❌ Wrong field name
};
```

### File 2: `src/parsers/referenceParser.ts`
Defines the standard `ParsedReference` interface.

**Interface (CORRECT):**
```typescript
export interface ParsedReference {
  verse?: number;
  endVerse?: number;  // ✅ Correct field name
}
```

### File 3: `src/services/ZipResourceFetcher2.ts`
Expects `endVerse`, not `verseEnd`.

**TSV Parser (lines 3256-3262):**
```typescript
// Handle verse range if endVerse is provided
const endVerse = reference.endVerse;  // ✅ Looking for "endVerse"
if (endVerse) {
  // Check if verse is within range
  if (verseNum >= reference.verse && verseNum <= endVerse) {
    matchedRows++;
    results.push(row as Record<string, string>);
  }
}
```

### The Bug
When "John 3:16-19" was parsed:
1. `functions/reference-parser.ts` created: `{ verse: 16, verseEnd: 19 }`
2. `ZipResourceFetcher2.ts` looked for: `reference.endVerse` → **undefined**
3. Since `endVerse` was undefined, the TSV parser treated it as a single verse query
4. Only verse 16 matched, verses 17-19 were skipped

## Solution
**Two-part fix:**

### Part 1: Interface Naming Consistency
Updated `src/functions/reference-parser.ts` to use `endVerse` instead of `verseEnd` for consistency with:
- The standard `ParsedReference` interface (`parsers/referenceParser.ts`)
- The TSV parser (`ZipResourceFetcher2.ts`)

### Part 2: Pass `endVerse` to Fetchers
Updated all service files to pass `endVerse` to `getTSVData()`:
- `src/functions/translation-notes-service.ts` (2 occurrences)
- `src/functions/translation-questions-service.ts` (2 occurrences)
- `src/functions/word-links-service.ts` (1 occurrence)
- `src/functions/scripture-service.ts` (fixed `verseEnd` → `endVerse` in extraction logic)

### Changes Made

**1. Interface Update:**
```typescript
export interface Reference {
  book: string;
  bookName: string;
  chapter: number;
  verse?: number;
  endVerse?: number;  // ✅ Changed from verseEnd to endVerse
  citation: string;
  original: string;
}
```

**2. Chapter Range Return:**
```typescript
return {
  book: bookInfo.code,
  bookName: bookInfo.name,
  chapter: startChapter,
  endVerse: endChapter,  // ✅ Changed from verseEnd
  citation: `${bookInfo.name} ${startChapter}-${endChapter}`,
  original: cleanInput,
};
```

**3. Verse Range Parsing:**
```typescript
const chapter = parseInt(chapterStr);
if (isNaN(chapter) || chapter < 1) return null;

let verse: number | undefined;
let endVerse: number | undefined;  // ✅ Changed from verseEnd

if (verseStr) {
  verse = parseInt(verseStr);
  if (isNaN(verse) || verse < 1) return null;

  if (verseEndStr) {
    endVerse = parseInt(verseEndStr);  // ✅ Changed from verseEnd
    if (isNaN(endVerse) || endVerse < verse) return null;
  }
}

// Create citation
let citation = `${bookInfo.name} ${chapter}`;
if (verse) {
  citation += `:${verse}`;
  if (endVerse && endVerse !== verse) {  // ✅ Changed from verseEnd
    citation += `-${endVerse}`;
  }
}

return {
  book: bookInfo.code,
  bookName: bookInfo.name,
  chapter,
  verse,
  endVerse,  // ✅ Changed from verseEnd
  citation,
  original: cleanInput,
};
```

### Part 2 Changes: Pass `endVerse` to `getTSVData()`

Even after fixing the interface naming, the `endVerse` field wasn't being passed to the TSV fetcher. Updated all service files to include it:

**`src/functions/translation-notes-service.ts` (2 occurrences):**
```typescript
const tsvResult = await zipFetcherProvider.getTSVData(
  {
    book: parsedRef.book,
    chapter: parsedRef.chapter!,
    verse: parsedRef.verse,
    endVerse: parsedRef.endVerse,  // ✅ Added (was missing)
  },
  language,
  organization,
  "tn",
);
```

**`src/functions/translation-questions-service.ts` (2 occurrences):**
```typescript
const tsvResult = await zipFetcherProvider.getTSVData(
  {
    book: parsedRef.book,
    chapter: parsedRef.chapter!,
    verse: parsedRef.verse,
    endVerse: parsedRef.endVerse,  // ✅ Added (was missing)
  },
  language,
  organization,
  "tq",
);
```

**`src/functions/word-links-service.ts` (1 occurrence):**
```typescript
const tsvResult = await zipFetcherProvider.getTSVData(
  {
    book: reference.book,
    chapter: reference.chapter!,
    verse: reference.verse,
    endVerse: reference.endVerse,  // ✅ Added (was missing)
  },
  language,
  organization,
  "twl",
);
```

**`src/functions/scripture-service.ts`:**
Also updated all references to `reference.verseEnd` → `reference.endVerse` (8 occurrences).

## Expected Behavior After Fix

### Translation Notes for John 3:16-19:
```bash
curl "http://localhost:8182/api/fetch-translation-notes?reference=John%203:16-19&language=en&organization=unfoldingWord"
```

**Before Fix:** Returns notes for verse 16 only
**After Fix:** Returns notes for verses 16, 17, 18, AND 19

### Translation Questions for John 3:16-19:
```bash
curl "http://localhost:8182/api/fetch-translation-questions?reference=John%203:16-19&language=en&organization=unfoldingWord"
```

**Before Fix:** Returns questions for verse 16 only
**After Fix:** Returns questions for verses 16, 17, 18, AND 19

### Translation Word Links for John 3:16-19:
```bash
curl "http://localhost:8182/api/fetch-translation-word-links?reference=John%203:16-19&language=en&organization=unfoldingWord"
```

**Before Fix:** Returns word links for verse 16 only
**After Fix:** Returns word links for verses 16, 17, 18, AND 19

### Why Scripture Already Worked
Scripture fetching uses a different code path in `scripture-service.ts` that properly handles verse ranges. This bug only affected TSV-based resources (notes, questions, word links) that go through `ZipResourceFetcher2.ts`.

## Files Modified
- `src/functions/reference-parser.ts` - Changed `verseEnd` to `endVerse` for consistency
- `src/functions/translation-notes-service.ts` - Pass `endVerse` to `getTSVData()` (2 occurrences)
- `src/functions/translation-questions-service.ts` - Pass `endVerse` to `getTSVData()` (2 occurrences)
- `src/functions/word-links-service.ts` - Pass `endVerse` to `getTSVData()` (1 occurrence)
- `src/functions/scripture-service.ts` - Changed `verseEnd` to `endVerse` (8 occurrences)

## Testing
After restarting the dev server, test with:

1. **Single verse** (should still work):
   - `John 3:16` → Returns data for verse 16 only

2. **Verse range** (now fixed):
   - `John 3:16-19` → Returns data for verses 16, 17, 18, 19
   - `Matthew 5:3-10` → Returns data for verses 3 through 10

3. **Chapter only** (should still work):
   - `Philemon 1` → Returns all verses in chapter 1

## Terminal Log Verification
After the fix, when requesting "John 3:16-19", you should see:

```
[INFO] parseTSVForReference: Parsing TSV {
  ...
  reference: "John 3:16-19",
  chapter: 3,
  verse: 16,
  endVerse: 19,  // ✅ Now present!
  book: "John"
}
```

And:
```
[INFO] parseTSVForReference: Filtering complete {
  processedRows: 2623,
  matchedRows: 15,  // ✅ Multiple rows matched (was 1 before)
  totalResults: 15,
  reference: "John 3:16-19"
}
```

## Related Documentation
- `src/parsers/referenceParser.ts` - Standard `ParsedReference` interface with `endVerse`
- `src/services/ZipResourceFetcher2.ts` (lines 3173-3329) - TSV parsing logic that checks `endVerse`
- `PROMPT_EXECUTION_FIX.md` - Previous fix for prompt parameter mismatches
