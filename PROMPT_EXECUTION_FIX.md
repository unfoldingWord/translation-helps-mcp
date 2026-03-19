# Prompt Execution Parameter Fix

## Problem
When executing the "fetch translation helps for passage" prompt, all tool calls were failing with `path=undefined` for `fetch_translation_word` and similar issues for `fetch_translation_academy`. This caused 8 consecutive failures trying to fetch word articles.

## Root Cause
The prompt execution code in `ui/src/routes/api/execute-prompt/+server.ts` was using the **old response structure** from the translation resource APIs. The code expected fields like:
- `link.term`
- `link.path`
- `link.rcLink`
- `link.category`

But the **actual response structure** uses `externalReference`:
```json
{
  "items": [{
    "id": "twl1",
    "reference": "John 3:16",
    "occurrence": 1,
    "quote": "loved",
    "strongsId": "G25",
    "externalReference": {
      "target": "tw",
      "path": "bible/kt/love",
      "category": "kt"
    }
  }]
}
```

## Solution Applied

### 1. **Translation Word Links (`executeTranslationHelpsPrompt`)**
**Before:**
```typescript
console.log(`Word link for ${link.term}:`, {
  term: link.term,
  path: link.path,
  rcLink: link.rcLink,
  category: link.category
});

const url = `/api/fetch-translation-word?path=${encodeURIComponent(link.path)}&...`;
```

**After:**
```typescript
// Extract path from externalReference structure
const externalRef = link.externalReference;
if (!externalRef || !externalRef.path) {
  console.warn(`Skipping word link - no externalReference.path:`, link);
  continue;
}

const path = externalRef.path;
const category = externalRef.category;
const term = link.quote || path.split('/').pop();

console.log(`Word link for "${term}":`, {
  term,
  path,
  category,
  quote: link.quote
});

const url = `/api/fetch-translation-word?path=${encodeURIComponent(path)}&...`;
```

### 2. **Translation Academy References (`extractSupportReferences`)**
**Before:**
```typescript
for (const note of notes) {
  const supportRef = note.SupportReference || note.supportReference;
  if (supportRef && supportRef.startsWith('rc://')) {
    console.log(`Found support reference: ${supportRef}`);
    refs.add(supportRef);
  }
}
```

**After:**
```typescript
for (const note of notes) {
  // Extract path from externalReference (new structure)
  const externalRef = note.externalReference;
  if (externalRef && externalRef.target === 'ta' && externalRef.path) {
    console.log(`Found academy reference path: ${externalRef.path}`);
    paths.add(externalRef.path);
  }
}
```

### 3. **Academy Article Fetching**
**Before:**
```typescript
for (const ref of supportRefs.slice(0, 5)) {
  const academyRes = await trackedFetchCall(
    `/api/fetch-translation-academy?rcLink=${encodeURIComponent(ref)}&...`
  );
  // ...
}
```

**After:**
```typescript
for (const path of academyPaths.slice(0, 5)) {
  const academyRes = await trackedFetchCall(
    `/api/fetch-translation-academy?path=${encodeURIComponent(path)}&...`
  );
  // ...
}
```

### 4. **Updated All Three Prompt Functions**
Applied the same fixes to:
- ✅ `executeTranslationHelpsPrompt` (main prompt)
- ✅ `executeWordsPrompt` (words-only prompt)
- ✅ `executeAcademyPrompt` (academy-only prompt)

## Files Modified
- `ui/src/routes/api/execute-prompt/+server.ts` - Updated all three prompt execution functions and the `extractSupportReferences` helper

## Expected Behavior After Fix
When executing the "fetch translation helps for passage" prompt:

1. ✅ **Scripture** fetches successfully
2. ✅ **Translation Questions** fetch successfully
3. ✅ **Translation Word Links** fetch successfully (8 items)
4. ✅ **Translation Word Articles** fetch using `path=bible/kt/love` (instead of `path=undefined`)
5. ✅ **Translation Notes** fetch successfully
6. ✅ **Translation Academy Articles** fetch using `path=translate/figs-metaphor` (instead of `rcLink=rc://...`)

## Consistency with MCP Prompts
This fix brings the prompt execution code **in sync with the MCP prompt templates** (`src/mcp/prompts-registry.ts`), which were already updated to use the correct parameter names:

```typescript
// MCP Prompt (CORRECT) - from PROMPT_PARAMETER_FIX.md
For EACH item that has externalReference.path, 
use fetch_translation_word tool with path=<externalReference.path>

For each externalReference.path (where target=ta), 
use fetch_translation_academy tool with path=<path_value>
```

Now the **execute-prompt endpoint** (used by the UI) and the **MCP prompts** (used by AI agents) both use the same correct field structure.

## Testing
After restarting the dev server, test:
```bash
# Through the UI (localhost:8182/mcp-tools):
1. Select prompt: "fetch translation helps for passage"
2. Reference: John 3:16
3. Language: en
4. Organization: unfoldingWord
5. Execute prompt

# Expected: No more "path=undefined" errors in terminal logs
# Expected: 8 successful word article fetches
# Expected: Academy articles fetch using path parameter
```

## Related Documentation
- `PROMPT_PARAMETER_FIX.md` - Documents the MCP prompt template fixes
- `src/mcp/prompts-registry.ts` - Contains the corrected prompt instructions
- Terminal logs show the exact error pattern that was fixed
