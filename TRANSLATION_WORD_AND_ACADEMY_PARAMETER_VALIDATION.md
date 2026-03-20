# Translation Word & Translation Academy Parameter Validation Report

## Date: 2026-03-07
## Validation Status: ✅ **COMPLETE - ALL PARAMETERS WORKING**

---

## Summary

Both `fetch_translation_word` and `fetch_translation_academy` tools/endpoints now fully support all parameter formats:

### Translation Word
- ✅ `term` (equivalent to `moduleId` for academy)
- ✅ `path`
- ✅ `rcLink`

### Translation Academy
- ✅ `moduleId` (equivalent to `term` for words)
- ✅ `path`
- ✅ `rcLink`

All combinations tested and validated for **both MCP tools and REST API endpoints**.

---

## Issues Fixed

### Issue 1: MCP Tool Required Parameters
**Problem**: The `ToolRegistry` in `src/contracts/ToolContracts.ts` had `fetch_translation_word` marked with `requiredParams: ["term"]`, which prevented using `path` or `rcLink` parameters.

**Root Cause**: The `UnifiedMCPHandler.handleToolCall()` method validates `requiredParams` before calling the endpoint, and was throwing "Missing required parameter: term" when `rcLink` or `path` was used instead.

**Fix**: Changed `requiredParams` from `["term"]` to `[]` with a comment explaining that "at least one of: term, path, or rcLink" is validated in the service layer.

```typescript
// BEFORE:
fetch_translation_word: {
  endpoint: "/api/fetch-translation-word",
  formatter: ToolFormatters.words,
  requiredParams: ["term"],  // ❌ TOO RESTRICTIVE
},

// AFTER:
fetch_translation_word: {
  endpoint: "/api/fetch-translation-word",
  formatter: ToolFormatters.words,
  requiredParams: [], // At least one of: term, path, or rcLink (validated in service)
},
```

### Issue 2: Translation Word Service Logic
**Problem**: `TranslationWordService` was calling `fetchTranslationWords` (plural) which was designed for fetching word *links* by reference, not individual word articles.

**Fix**: Created a new core service function `fetchTranslationWordArticle` in `src/functions/translation-word-service.ts` that properly handles:
- `term` parameter (simple term lookup)
- `path` parameter (direct path to word article)
- `rcLink` parameter (RC link parsing and lookup)

Updated `TranslationWordService` to call this new function with proper parameter priority: `rcLink` > `path` > `term`.

### Issue 3: Translation Academy Path Handling
**Problem**: When `moduleId` contained a category prefix (e.g., `translate/figs-metaphor`), the REST endpoint logic would incorrectly trigger category search, resulting in paths like `translate/translate/figs-metaphor`.

**Fix**: Modified `ui/src/routes/api/fetch-translation-academy/+server.ts` to detect when `moduleId` contains a slash and treat it as a direct path parameter instead of triggering the category search logic.

---

## Validation Tests

### REST API - Translation Word

| Test | Parameter | Result | Title | Content Size | Category |
|------|-----------|--------|-------|--------------|----------|
| 1 | `term=believe` | ✅ PASS | believe, believer... | 5960 chars | kt |
| 2 | `path=bible/kt/believe.md` | ✅ PASS | believe, believer... | 5960 chars | kt |
| 3 | `rcLink=rc://en/tw/dict/bible/kt/believe` | ✅ PASS | believe, believer... | 5960 chars | kt |

### REST API - Translation Academy

| Test | Parameter | Result | Title | Content Size | Category |
|------|-----------|--------|-------|--------------|----------|
| 4 | `moduleId=figs-metaphor` | ✅ PASS | Metaphor | 17604 chars | translate |
| 5 | `moduleId=translate/figs-metaphor` | ✅ PASS | Metaphor | 17604 chars | translate |
| 6 | `path=translate/figs-metaphor` | ✅ PASS | Metaphor | 17604 chars | translate |
| 7 | `rcLink=rc://*/ta/man/translate/figs-metaphor` | ✅ PASS | Metaphor | 17604 chars | translate |

### MCP Tools - Translation Word

| Test | Parameter | Result | Title | Content Size | Category |
|------|-----------|--------|-------|--------------|----------|
| 1 | `term=believe` | ✅ PASS | believe, believer... | 5960 chars | kt |
| 2 | `path=bible/kt/believe.md` | ✅ PASS | believe, believer... | 5960 chars | - |
| 3 | `rcLink=rc://en/tw/dict/bible/kt/believe` | ✅ PASS | believe, believer... | 5960 chars | kt |

### MCP Tools - Translation Academy

| Test | Parameter | Result | Title | Content Size |
|------|-----------|--------|-------|--------------|
| 4 | `moduleId=figs-metaphor` | ✅ PASS | Metaphor | 17604 chars |
| 5 | `path=translate/figs-metaphor` | ✅ PASS | Metaphor | 17604 chars |
| 6 | `rcLink=rc://*/ta/man/translate/figs-metaphor` | ✅ PASS | Metaphor | 17604 chars |

---

## Test Commands

### REST API Tests
```bash
# Translation Word - term
curl "http://localhost:8181/api/fetch-translation-word?term=believe&language=en"

# Translation Word - path
curl "http://localhost:8181/api/fetch-translation-word?path=bible/kt/believe.md&language=en"

# Translation Word - rcLink
curl "http://localhost:8181/api/fetch-translation-word?rcLink=rc://en/tw/dict/bible/kt/believe&language=en"

# Translation Academy - moduleId (simple)
curl "http://localhost:8181/api/fetch-translation-academy?moduleId=figs-metaphor&language=en"

# Translation Academy - moduleId (with category/)
curl "http://localhost:8181/api/fetch-translation-academy?moduleId=translate/figs-metaphor&language=en"

# Translation Academy - path
curl "http://localhost:8181/api/fetch-translation-academy?path=translate/figs-metaphor&language=en"

# Translation Academy - rcLink
curl "http://localhost:8181/api/fetch-translation-academy?rcLink=rc://*/ta/man/translate/figs-metaphor&language=en"
```

### MCP Tool Tests
```bash
# Translation Word - term
curl -X POST "http://localhost:8181/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"fetch_translation_word","arguments":{"term":"believe","language":"en"}}}'

# Translation Word - path
curl -X POST "http://localhost:8181/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"fetch_translation_word","arguments":{"path":"bible/kt/believe.md","language":"en"}}}'

# Translation Word - rcLink
curl -X POST "http://localhost:8181/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"fetch_translation_word","arguments":{"rcLink":"rc://en/tw/dict/bible/kt/believe","language":"en"}}}'

# Translation Academy - moduleId
curl -X POST "http://localhost:8181/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"fetch_translation_academy","arguments":{"moduleId":"figs-metaphor","language":"en"}}}'

# Translation Academy - path
curl -X POST "http://localhost:8181/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"fetch_translation_academy","arguments":{"path":"translate/figs-metaphor","language":"en"}}}'

# Translation Academy - rcLink
curl -X POST "http://localhost:8181/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"fetch_translation_academy","arguments":{"rcLink":"rc://*/ta/man/translate/figs-metaphor","language":"en"}}}'
```

---

## Parameter Priority Logic

### Translation Word (`fetchTranslationWordArticle`)
1. **rcLink** - Highest priority, parsed to extract term and category
2. **path** - Direct path to word article file
3. **term** - Simple term lookup, with optional category context

### Translation Academy (`fetchTranslationAcademy`)
1. **rcLink** - Highest priority, parsed to extract module path
2. **path** - Direct path to academy module
3. **moduleId** - Module identifier, auto-prefixed with `translate/` if no category present

---

## Files Modified

1. `src/contracts/ToolContracts.ts`
   - Changed `fetch_translation_word.requiredParams` from `["term"]` to `[]`

2. `src/functions/translation-word-service.ts` (NEW FILE)
   - Created `fetchTranslationWordArticle` function
   - Handles `term`, `path`, and `rcLink` parameters with proper priority
   - Uses `UnifiedResourceFetcher.getMarkdownContent` for content retrieval
   - Parses markdown for title, definition, and category

3. `src/unified-services/TranslationWordService.ts`
   - Updated to call `fetchTranslationWordArticle` instead of `fetchTranslationWords`
   - Added validation for "at least one of term/path/rcLink"

4. `ui/src/routes/api/fetch-translation-academy/+server.ts`
   - Fixed logic to treat `moduleId` containing "/" as `path` parameter
   - Prevents incorrect category search for already-prefixed module IDs

---

## Conclusion

✅ **All parameter combinations for both `fetch_translation_word` and `fetch_translation_academy` are now working correctly across both MCP tools and REST API endpoints.**

The `term` parameter for Translation Word is functionally equivalent to `moduleId` for Translation Academy, with both supporting the same alternative parameter formats (`path` and `rcLink`).
