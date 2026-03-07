# Validation Issues Found - John 3:16 Testing

**Date**: March 7, 2026  
**Testing Reference**: John 3:16  
**Status**: ⚠️ **CRITICAL ISSUES FOUND**

## Executive Summary

Systematic testing against actual DCS data revealed that **Translation Notes and Translation Questions tools are NOT working correctly**. They return empty results when DCS data clearly shows content exists for John 3:16.

## DCS Ground Truth for John 3:16

Verified by downloading and inspecting actual DCS ZIP files:

| Resource Type              | Expected Count     | DCS File             | Status     |
| -------------------------- | ------------------ | -------------------- | ---------- |
| **Translation Notes**      | **7 entries**      | `en_tn/tn_JHN.tsv`   | ✓ Verified |
| **Translation Questions**  | **1 entry**        | `en_tq/tq_JHN.tsv`   | ✓ Verified |
| **Translation Word Links** | **8 entries**      | `en_twl/twl_JHN.tsv` | ✓ Verified |
| **Scripture**              | **3 translations** | ULT, UST, T4T USFM   | ✓ Verified |

### Translation Notes (7 entries in DCS)

```tsv
3:16	vg6z		rc://*/ta/man/translate/grammar-connect-logic-result	γὰρ	1	**For** here indicates...
3:16	h4ht			οὕτως & ἠγάπησεν ὁ Θεὸς τὸν κόσμον	1	Here, **so** could refer to...
3:16	uxc2		rc://*/ta/man/translate/figs-metonymy	τὸν κόσμον	1	Here, **world** refers to the people...
3:16	jen2		rc://*/ta/man/translate/grammar-connect-logic-result	ὥστε	1	Here, **that** introduces the result...
3:16	fqk7		rc://*/ta/man/translate/figs-explicit	τὸν Υἱὸν τὸν μονογενῆ	1	Here, **One and Only Son** refers to Jesus...
3:16	z8at		rc://*/ta/man/translate/guidelines-sonofgodprinciples	τὸν Υἱὸν τὸν μονογενῆ	1	Here and throughout John's Gospel...
3:16	qpc9		rc://*/ta/man/translate/guidelines-sonofgodprinciples	τὸν Υἱὸν τὸν μονογενῆ	1	**One and Only Son** is an important title...
```

### Translation Questions (1 entry in DCS)

```tsv
3:16	th1d				How did God show he loved the world?	He showed his love by giving his Only Son...
```

## Test Results

### ✅ Working MCP Tools

#### 1. fetch_scripture

**Result**: ✓ WORKING  
**Returns**: 3 translations (ULT v88, UST v88, T4T v1)  
**Response**:

```json
{
  "scripture": [
    { "text": "For God so loved the world...", "translation": "ULT v88" },
    { "text": "This is because God loved...", "translation": "UST v88" },
    { "text": "God loved us people...", "translation": "T4T v1" }
  ],
  "metadata": { "totalCount": 3, "resources": ["ULT v88", "UST v88", "T4T v1"] }
}
```

#### 2. fetch_translation_word_links

**Result**: ✓ WORKING  
**Returns**: 8 word links (love, god, world, sonofgod, believe, inchrist, perish, eternity)  
**Matches DCS**: Perfect match with `twl_JHN.tsv`

#### 3. fetch_translation_word

**Result**: ✓ WORKING  
**Returns**: Full dictionary entry for "love" (7.4 KB)

#### 4. fetch_translation_academy

**Result**: ✓ WORKING  
**Returns**: Complete "Metaphor" article (18.4 KB)

### ❌ Broken MCP Tools

#### 1. fetch_translation_notes

**Result**: ❌ **RETURNS EMPTY** (Should return 7 notes)  
**Expected**: 7 notes from DCS  
**Actual Response**:

```json
{
  "reference": "John 3:16",
  "language": "en",
  "citations": [],
  "organizations": [],
  "items": [],
  "metadata": {
    "totalCount": 0,
    "verseNotesCount": 0,
    "contextNotesCount": 0,
    "totalResources": 1
  }
}
```

**Issue**:

- Tool runs without errors
- Finds the resource (`totalResources: 1`)
- But returns no notes (`totalCount: 0`)
- DCS file clearly has 7 entries for 3:16

**Logs show**:

```
[INFO] Using resource {"name":"en_tn","title":"unfoldingWord® Translation Notes"}
[DEBUG] Resources found {"resourceType":"notes","count":1}
[DEBUG] Looking for book {"book":"JHN","lower":"jhn"}
[DEBUG] Ingredients available {"ingredients":["gen",...,"jhn",...,"rev"]}
```

Resource is found, but parsing/filtering fails to extract the notes.

#### 2. fetch_translation_questions

**Result**: ❌ **RETURNS EMPTY** (Should return 1 question)  
**Expected**: 1 question from DCS  
**Actual Response**:

```json
{
  "reference": "John 3:16",
  "language": "en",
  "citations": [],
  "organizations": [],
  "items": [],
  "metadata": {
    "totalCount": 0,
    "cached": false,
    "responseTime": 2,
    "totalResources": 1
  }
}
```

**Issue**: Same pattern as Translation Notes

- Tool runs without errors
- Finds the resource
- But returns no questions
- DCS file clearly has 1 entry for 3:16

### 🚨 Critical REST API Issue

**ALL REST API endpoints fail** with Node.js compatibility error:

```
TypeError: __vite_ssr_import_2__.homedir is not a function
at new FSZipFetcherProvider (zip-fetcher-provider.ts:54:175)
```

**Affected Endpoints**:

- /api/fetch-scripture
- /api/fetch-translation-notes
- /api/fetch-translation-questions
- /api/fetch-translation-word-links
- /api/fetch-translation-word
- /api/fetch-translation-academy

**Root Cause**: `os.homedir()` doesn't work in Vite's SSR environment. The `FSZipFetcherProvider` in `zip-fetcher-provider.ts` tries to use Node.js `os.homedir()` which is stubbed out in the browser/SSR context.

**Impact**:

- MCP tools work (pure Node.js environment) ✓
- REST API endpoints completely broken (Vite SSR) ✗

## Root Cause Analysis

### Issue 1: Translation Notes/Questions Return Empty

**Problem**: Core services find the resources but fail to parse/filter the TSV data for the specific verse.

**Possible causes**:

1. **Verse parsing issue** - Reference "John 3:16" not being matched against "3:16" in TSV
2. **TSV parsing bug** - TAB-delimited parsing failing
3. **Filtering bug** - Data extracted but filtered out incorrectly
4. **Resource version mismatch** - Looking for wrong version or file structure

**Evidence**:

- Logs show `"ingredients":["gen",...,"jhn",...,"rev"]` - John is found
- Logs show `"totalResources": 1` - Resource is loaded
- But no items are returned

**Next steps**:

1. Debug the core service TSV parsing logic
2. Check if reference format matching is working
3. Verify the downloaded ZIP structure matches expectations

### Issue 2: Node.js Compatibility in REST API

**Problem**: `os.homedir()` not available in Vite SSR.

**Location**: `src/services/zip-fetcher-provider.ts:54`

**Code**:

```typescript
const cacheDir = path.join(os.homedir(), ".translation-helps-mcp", "cache");
```

**Fix needed**: Use platform-agnostic cache directory or detect environment:

```typescript
const cacheDir =
  typeof process !== "undefined" && process.env.CACHE_PATH
    ? process.env.CACHE_PATH
    : platform === "browser"
      ? "/tmp/cache" // or use IndexedDB
      : path.join(os.homedir(), ".translation-helps-mcp", "cache");
```

## Impact Assessment

### Critical

- ❌ **Translation Notes completely non-functional** (0/7 notes returned)
- ❌ **Translation Questions completely non-functional** (0/1 questions returned)
- ❌ **ALL REST API endpoints completely broken**

### Working

- ✅ Scripture fetching (MCP only)
- ✅ Translation Word Links (MCP only)
- ✅ Translation Words (MCP only)
- ✅ Translation Academy (MCP only)

### User Impact

- **MCP users**: 2 out of 6 core tools broken (33% failure rate)
- **REST API users**: 100% failure rate (all endpoints return 500)
- **Data accuracy**: When tools return empty, users get NO indication data exists in DCS

## Recommendations

### Immediate Actions Required

1. **Fix Translation Notes/Questions parsing**
   - Priority: CRITICAL
   - Debug TSV parsing and verse matching logic
   - Add better error logging to show why notes aren't found
   - Add unit tests with John 3:16 as test case

2. **Fix Node.js compatibility in REST API**
   - Priority: HIGH
   - Make `zip-fetcher-provider` work in browser/SSR context
   - Use environment detection or configuration
   - Test all REST endpoints after fix

3. **Add proper error messages**
   - When notes/questions not found, log WHY
   - Don't silently return empty results
   - Help users understand if it's a bug or truly no data

### Testing Strategy

**Validation test case**: John 3:16 should become the **standard test reference** because it has:

- ✓ Scripture text (ULT, UST, T4T)
- ✓ 7 Translation Notes
- ✓ 1 Translation Question
- ✓ 8 Translation Word Links

**Test matrix**:

```
Reference: John 3:16
Language: en
Organization: unfoldingWord

Expected Results:
- fetch_scripture: 3 translations
- fetch_translation_notes: 7 notes
- fetch_translation_questions: 1 question
- fetch_translation_word_links: 8 word links
- fetch_translation_word (love): 1 definition
- fetch_translation_academy (figs-metaphor): 1 article

Test in BOTH contexts:
- MCP (Node.js)
- REST API (Vite SSR)
```

### Documentation Updates

1. Update validation report to reflect actual findings
2. Add known issues section to README
3. Document John 3:16 as the canonical test case
4. Add troubleshooting guide for empty results

## Conclusion

The unified services architecture is **partially working** but has **critical bugs**:

1. ✅ **Architecture is sound** - Services that work, work correctly
2. ❌ **Translation Notes/Questions have parsing bugs** - Return empty when data exists
3. ❌ **REST API completely broken** - Node.js compatibility issue
4. ⚠️ **Validation was insufficient** - Initial testing didn't verify against DCS data

**Status**: NOT PRODUCTION READY until these issues are fixed.

---

**Discovered by**: Systematic testing against actual DCS data  
**Test Reference**: John 3:16 (proven to have data in all resource types)  
**Next Steps**: Fix core service parsing bugs and Node.js compatibility
