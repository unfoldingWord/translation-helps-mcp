# Organization Parameter Fix - Complete

## Problem Summary

When explicitly requesting `organization=unfoldingWord` for Translation Academy or Translation Words, the system was incorrectly returning resources from other organizations (like `es-419_gl`). This violated the principle of **explicit intent** - when a user specifies an organization, they expect results **only** from that organization, or a 404 if it doesn't exist.

## Root Causes

### 1. **Hardcoded Default Organization**
   - **Location**: `ui/src/routes/api/fetch-translation-academy/+server.ts` (line 26)
   - **Location**: `ui/src/routes/api/fetch-translation-word/+server.ts` (line 61)
   - **Issue**: Both endpoints had `organization = 'unfoldingWord'` as default in parameter destructuring
   - **Impact**: Empty strings were overridden to `'unfoldingWord'` instead of being treated as "search all"

### 2. **MCP Handler Sending Empty Strings**
   - **Location**: `ui/src/lib/mcp/UnifiedMCPHandler.ts` (line 59-63)
   - **Issue**: Empty string values (`organization: ''`) were being added to query parameters
   - **Impact**: REST endpoints received `organization=` (empty string) instead of omitting the parameter entirely

### 3. **Auto-Retry Overriding Organization Choice**
   - **Location**: `ui/src/lib/simpleEndpoint.ts` (line 447-453)
   - **Issue**: When `organization=unfoldingWord` failed, auto-retry silently changed it to `organization=all`
   - **Impact**: User's explicit organization choice was ignored, returning results from ANY organization

### 4. **Variant Discovery Overriding Organization**
   - **Location**: `ui/src/lib/unifiedResourceFetcher.ts` (6 instances)
   - **Issue**: `organization === 'unfoldingWord' ? undefined : organization` converted explicit `unfoldingWord` to `undefined` (all orgs)
   - **Impact**: Even when user explicitly requested `unfoldingWord`, variant discovery searched all organizations

## Fixes Applied

### Fix 1: Remove Hardcoded Defaults
**File**: `ui/src/routes/api/fetch-translation-academy/+server.ts`
```typescript
// BEFORE
const { path, language = 'en', organization = 'unfoldingWord', topic } = params;

// AFTER
const { path, language = 'en', organization, topic } = params;
```

**File**: `ui/src/routes/api/fetch-translation-word/+server.ts`
```typescript
// BEFORE
const { path, language = 'en', organization = 'unfoldingWord', topic } = params;

// AFTER
const { path, language = 'en', organization, topic } = params;
```

### Fix 2: Skip Empty Strings in MCP Handler
**File**: `ui/src/lib/mcp/UnifiedMCPHandler.ts`
```typescript
// BEFORE
Object.entries(finalArgs).forEach(([key, value]) => {
  if (value !== undefined && value !== null) {
    params.set(key, String(value));
  }
});

// AFTER
Object.entries(finalArgs).forEach(([key, value]) => {
  // Skip undefined, null, and empty strings (especially for organization - empty means "all orgs")
  if (value !== undefined && value !== null && value !== '') {
    params.set(key, String(value));
  }
});
```

### Fix 3: Preserve Organization During Auto-Retry
**File**: `ui/src/lib/simpleEndpoint.ts`
```typescript
// BEFORE
const retryParams = {
  ...parsedParams,
  language: suggestedLanguage,
  // If original org was unfoldingWord and we're retrying with a variant,
  // switch to "all" to find resources from other organizations
  organization: parsedParams.organization === 'unfoldingWord' ? 'all' : parsedParams.organization
};

// AFTER
const retryParams = {
  ...parsedParams,
  language: suggestedLanguage
  // Keep original organization - if user explicitly set it, respect their choice
};
```

### Fix 4: Respect Organization in Variant Discovery
**File**: `ui/src/lib/unifiedResourceFetcher.ts` (6 instances)
```typescript
// BEFORE
const languageVariants = await findLanguageVariants(
  baseLanguage, 
  organization === 'unfoldingWord' ? undefined : organization, 
  'tc-ready', 
  ['Translation Academy']
);

// AFTER
const languageVariants = await findLanguageVariants(
  baseLanguage, 
  organization, // Pass through as-is - respect explicit organization choice
  'tc-ready', 
  ['Translation Academy']
);
```

## Behavior After Fix

### Scenario 1: No Organization (Empty or Omitted)
**Request**: `language=es`, `organization=''` or omitted
**Behavior**: 
- Searches **all organizations**
- Finds `es-419_ta` from `es-419_gl` ✅
- Returns Spanish Translation Academy content

### Scenario 2: Explicit Organization
**Request**: `language=es`, `organization=unfoldingWord`
**Behavior**:
- Searches **only unfoldingWord**
- Finds no `es-419` Translation Academy in unfoldingWord
- Returns **404 Not Found** ✅ (correct!)

### Scenario 3: Other Organizations
**Request**: `language=es-419`, `organization=es-419_gl`
**Behavior**:
- Searches **only es-419_gl**
- Finds `es-419_ta` ✅
- Returns Spanish Translation Academy content

## Comprehensive Test Results ✅ ALL PASSED (19/19)

Ran complete test suite covering all parameter combinations:

```bash
bash tests/run-parameter-tests.sh
```

**Results**:
- Total Tests: 19
- Passed: 19 ✅
- Failed: 0 ✅
- Execution Time: ~42 seconds

### Translation Academy Tests (12/12) ✅
1. ✅ Empty org, es → es-419 auto-retry - Returns Spanish "Metáfora" from es-419_gl
2. ✅ Omitted org, es → es-419 auto-retry - Returns Spanish content
3. ✅ **Explicit unfoldingWord with es → 404** - Correctly rejects (no es-419 in unfoldingWord)
4. ✅ Explicit es-419_gl with es-419 → 200 - Direct match
5. ✅ English with unfoldingWord → 200 - Returns "Metaphor"
6. ✅ JSON format → 200 - Structured object response
7. ✅ Markdown format (md) → 200 - Plain markdown string
8. ✅ Markdown format (markdown) → 200 - Alias works
9. ✅ Invalid format (text) → 400 - Properly rejected
10. ✅ Invalid format (usfm) → 400 - Properly rejected
11. ✅ Invalid path → 404 - Non-existent module
12. ✅ Omitted path → 404 + TOC - Returns table of contents

### Translation Word Tests (6/6) ✅
13. ✅ Empty org, es → 200 - Finds variant
14. ✅ **Explicit unfoldingWord with es → 404** - Correctly rejects
15. ✅ English with unfoldingWord → 200 - Returns content
16. ✅ JSON format → 200 - With definition field
17. ✅ Markdown format → 200 - Plain markdown
18. ✅ Category filter (kt) → 200 - Filter works

### Cache Isolation Test (1/1) ✅
19. ✅ **Cache doesn't leak between organizations** - Critical test confirmed:
   - Request with `org=''` → 200 (cached)
   - Request with `org=unfoldingWord` → 404 (NOT using cached result from above)
   - Request with `org=''` again → 200 (still works)

## Related Tools Fixed

Both Translation Academy and Translation Word tools now properly respect organization parameters:
- ✅ `fetch_translation_academy`
- ✅ `fetch_translation_word`

## Key Principle

**Explicit intent must be respected**: When a user explicitly specifies an organization parameter, the system MUST:
1. Search only that organization
2. Return 404 if the resource doesn't exist in that organization
3. NEVER silently switch to searching other organizations

This ensures predictable, transparent behavior where users get exactly what they ask for.

## Files Modified

1. `ui/src/routes/api/fetch-translation-academy/+server.ts` - Removed default organization
2. `ui/src/routes/api/fetch-translation-word/+server.ts` - Removed default organization
3. `ui/src/lib/mcp/UnifiedMCPHandler.ts` - Skip empty strings in query params
4. `ui/src/lib/simpleEndpoint.ts` - Preserve organization during auto-retry
5. `ui/src/lib/unifiedResourceFetcher.ts` - Respect organization in variant discovery (6 locations)
6. `ui/src/lib/commonValidators.ts` - Added `topic`, `format`, `category` parameters

## Impact

- ✅ Users can now explicitly search specific organizations
- ✅ Empty/omitted organization searches all organizations (expected behavior)
- ✅ 404 errors are returned when resources don't exist in specified organization
- ✅ No silent organization switching during auto-retry
- ✅ Explicit user intent is always respected
