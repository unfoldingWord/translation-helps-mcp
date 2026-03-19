# Automatic Retry Implementation - Debugging Guide

## Changes Made

### 1. SDK Error Handling Enhancement

**File:** `packages/js-sdk/src/client.ts` (lines 160-172)

**Added:** Direct attachment of `languageVariants` to Error object (matching existing `validBookCodes` pattern)

```typescript
// Attach languageVariants directly for easy access
if (data.error.data.languageVariants) {
  console.log('[SDK] ✅ Attaching languageVariants:', data.error.data.languageVariants);
  error.languageVariants = data.error.data.languageVariants;
  error.requestedLanguage = data.error.data.requestedLanguage;
}
```

**Rebuilt:** `cd packages/js-sdk && npm run build` ✅

### 2. Chat Stream Retry Logic

**File:** `ui/src/routes/api/chat-stream/+server.ts`

**Added comprehensive logging:**
- Line 1232: Extract `languageVariants` directly from error object
- Line 1247: Log retry check decision
- Line 1256: Log when retry is triggered
- Line 1270: Extract variants from error details
- Line 1355: Log retry success

**Key Fix:** Check both `error.languageVariants` (direct) and `errorResponse.details.languageVariants` (nested)

```typescript
// Extract languageVariants from error object (SDK attaches directly)
if ('languageVariants' in error) {
  errorDetails.languageVariants = (error as any).languageVariants;
  errorDetails.requestedLanguage = (error as any).requestedLanguage;
  console.log('[CHAT] ✅ Found languageVariants:', errorDetails.languageVariants);
}

// Check for recovery data
const hasLanguageVariants = 
  errorDetails?.languageVariants?.length > 0 || 
  errorResponse?.details?.languageVariants?.length > 0;

console.log('[CHAT] 🔄 Retry check:', {
  hasLanguageVariants,
  languageVariants: errorDetails?.languageVariants
});

if (hasLanguageVariants) {
  console.log('[CHAT] ✅ RETRY TRIGGERED - Recovery data found');
  
  // Get variants from correct location
  const variants = errorDetails?.languageVariants || errorResponse?.details?.languageVariants;
  const suggestedLanguage = variants[0];
  retryParams.language = suggestedLanguage;
  
  // Execute retry...
}
```

### 3. Debug Console Enhancement

**File:** `ui/src/routes/(app)/chat/DebugSidebar.svelte`

**Added visual indicators:**
1. **Recovery Data Section:** Shows `languageVariants` and `validBookCodes` in error display
2. **Retry Badge:** Highlights successful retry attempts with green banner
3. **Better Response Display:** Full error response with details object

```svelte
{#if log.response?.details?.languageVariants}
  <div class="mt-2 border-t border-red-800/50 pt-2">
    <p class="text-xs font-semibold text-yellow-300 mb-1">
      🔄 Auto-Retry Data Available:
    </p>
    <p class="text-xs text-yellow-200">
      Available language variants: 
      <code>{log.response.details.languageVariants.join(', ')}</code>
    </p>
    <p class="text-xs text-yellow-200 mt-1">
      Requested: <code>{log.response.details.requestedLanguage}</code>
    </p>
  </div>
{/if}

{#if log.response?.isRetry}
  <div class="mb-2 rounded border border-green-900/50 bg-green-900/20 px-3 py-2">
    <p class="text-xs font-semibold text-green-300">
      🔄 This is an automatic retry that succeeded
    </p>
  </div>
{/if}
```

## Testing Instructions

### 1. Open Dev Tools Console

**IMPORTANT:** Open your browser's developer console (F12) to see the detailed logs:

- `[SDK] ✅ Attaching languageVariants:` - SDK received and attached variants
- `[CHAT] ✅ Found languageVariants:` - Chat handler extracted variants
- `[CHAT] 🔄 Retry check:` - Shows retry decision logic
- `[CHAT] ✅ RETRY TRIGGERED` - Confirms retry is happening
- `[CHAT] ✅ RETRY SUCCEEDED` - Confirms retry worked

### 2. Test Request

**URL:** `http://localhost:8178/chat`

**Input:** `"show me john 3:16 in spanish"`

### 3. Expected Console Logs

```
[SDK] 🚨 MCP Error Response: { message: "...", data: {...} }
[SDK] 🔍 Has data.error.data? true
[SDK] 🔍 data.error.data: { languageVariants: ["es-419"], requestedLanguage: "es", ... }
[SDK] ✅ Preserving error.data with: ["languageVariants", "requestedLanguage", ...]
[SDK] ✅ Attaching languageVariants: ["es-419"]
[SDK] 🎯 Throwing error with details: true validBookCodes: false

[CHAT] ✅ Error has details: ["languageVariants", "requestedLanguage"]
[CHAT] ✅ Found languageVariants: ["es-419"]
[CHAT] 🔍 Final errorDetails for retry check: {
  hasLanguageVariants: true,
  hasValidBookCodes: false,
  errorDetails: { languageVariants: ["es-419"], requestedLanguage: "es" }
}

[CHAT] 🔄 Retry check: {
  hasLanguageVariants: true,
  hasValidBookCodes: false,
  languageVariants: ["es-419"],
  validBookCodes: undefined
}

[CHAT] ✅ RETRY TRIGGERED - Recovery data found

[CHAT] Retrying with suggested language variant: {
  original: "es",
  suggested: "es-419",
  allVariants: ["es-419"]
}

[SDK] Executing retry: fetch_scripture with params: { reference: "JHN 3:16", language: "es-419", format: "json" }

[CHAT] ✅ RETRY SUCCEEDED with params: { reference: "JHN 3:16", language: "es-419", format: "json" }
```

### 4. Expected Debug Sidebar Display

**First Entry (Original Error):**
```
🔧 MCP TOOL - ERROR - 500 - fetch-scripture
  Duration: 3.2s
  User asked: "show me john 3:16 in spanish"
  Tool endpoint failed: 400 (auto-retried)
  
  🔄 Auto-Retry Data Available:
  Available language variants: es-419
  Requested: es
  
  Parameters:
  { "reference": "JHN 3:16", "language": "es", "format": "json" }
  
  📡 Full MCP Server Response:
  {
    "details": {
      "languageVariants": ["es-419"],
      "requestedLanguage": "es"
    }
  }
```

**Second Entry (Successful Retry):**
```
🔧 MCP TOOL - SUCCESS - 200 - fetch-scripture
  Duration: 2.4s
  
  🔄 This is an automatic retry that succeeded
  
  Parameters:
  { "reference": "JHN 3:16", "language": "es-419", "format": "json" }
  
  📡 Full MCP Server Response:
  {
    "scripture": [
      {
        "text": "Porque de tal manera amó Dios al mundo...",
        "translation": "ULT v86",
        "citation": { "language": "es-419", ... }
      },
      {
        "text": "Porque Dios amó tanto al mundo...",
        "translation": "UST v86",
        "citation": { "language": "es-419", ... }
      }
    ]
  }
```

### 5. Expected Chat Response

User should see scripture immediately without error messages:

```
📖 John 3:16 (Spanish - Latin America)

**ULT v86:**
Porque de tal manera amó Dios al mundo, que dio a su Hijo unigénito...

**UST v86:**
Porque Dios amó tanto al mundo que dio a su único Hijo...

[Citation information...]
```

## Debugging Checklist

If retry doesn't work, check these in order:

### ✅ Step 1: SDK Receives Error Data

**Console log:** `[SDK] ✅ Attaching languageVariants:`

**If missing:**
- Check `ui/src/lib/unifiedResourceFetcher.ts` is throwing error with `languageVariants`
- Check `ui/src/lib/simpleEndpoint.ts` is including `errorDetails.languageVariants`
- Check `/api/fetch-scripture` endpoint returns error with details

### ✅ Step 2: Chat Handler Extracts Variants

**Console log:** `[CHAT] ✅ Found languageVariants:`

**If missing:**
- Check SDK is attaching `error.languageVariants` property
- Check chat handler is extracting from `error.languageVariants`
- Verify `errorDetails` object contains variants

### ✅ Step 3: Retry Check Passes

**Console log:** `[CHAT] 🔄 Retry check: { hasLanguageVariants: true }`

**If false:**
- Check `errorDetails.languageVariants` is an array with length > 0
- Verify conditional: `errorDetails?.languageVariants?.length > 0`

### ✅ Step 4: Retry Triggered

**Console log:** `[CHAT] ✅ RETRY TRIGGERED - Recovery data found`

**If missing:**
- Retry check failed (see Step 3)
- OR exception thrown in retry logic (check for error logs)

### ✅ Step 5: Retry Executes

**Console log:** `[SDK] Executing retry: fetch_scripture with params:...`

**If missing:**
- Check `retryParams.language` is set correctly
- Check `callTool()` is being called with retry params

### ✅ Step 6: Retry Succeeds

**Console log:** `[CHAT] ✅ RETRY SUCCEEDED with params:`

**If missing:**
- Retry was executed but failed (check for 404/500 errors)
- Suggested language variant doesn't have resources either
- Network error during retry

## Quick Diagnostic Commands

### Check if error data is in response:

```bash
# In browser console after error:
# Check if error has details
console.log(window.lastError?.details);

# Check if error has languageVariants
console.log(window.lastError?.languageVariants);
```

### Check API endpoint directly:

```bash
# Test endpoint with bad language code
curl "http://localhost:8178/api/fetch-scripture?reference=JHN+3:16&language=es&format=json"

# Should return error with details:
# {
#   "error": "...",
#   "details": {
#     "languageVariants": ["es-419"],
#     "requestedLanguage": "es"
#   }
# }
```

### Force refresh:

```bash
# Clear browser cache
Ctrl+Shift+R (hard reload)

# Restart dev server
taskkill //F //PID <pid>
cd ui && npm run dev
```

## Current Status

✅ **SDK:** Modified to attach `languageVariants` to error object  
✅ **SDK:** Rebuilt successfully  
✅ **Chat Handler:** Enhanced to extract and check `languageVariants`  
✅ **Chat Handler:** Added comprehensive console logging  
✅ **Chat Handler:** Retry logic checks error details  
✅ **Debug Sidebar:** Enhanced to show recovery data visually  
✅ **Dev Server:** Reloaded with all changes  

🧪 **READY FOR TESTING**

## What Should Happen Now

1. **SDK throws error with `languageVariants`**  
   → Console: `[SDK] ✅ Attaching languageVariants: ["es-419"]`

2. **Chat handler extracts variants**  
   → Console: `[CHAT] ✅ Found languageVariants: ["es-419"]`

3. **Retry check passes**  
   → Console: `[CHAT] 🔄 Retry check: { hasLanguageVariants: true }`

4. **Retry triggered**  
   → Console: `[CHAT] ✅ RETRY TRIGGERED - Recovery data found`

5. **Retry executes with `language="es-419"`**  
   → Console: `[CHAT] ✅ RETRY SUCCEEDED`

6. **User sees scripture**  
   → Chat: "Here's John 3:16 in Spanish..."

7. **Debug panel shows both attempts**  
   → First: ERROR with recovery data badge  
   → Second: SUCCESS with retry badge

## If It Still Doesn't Work

Check these specific points:

1. **Is `/api/fetch-scripture` actually throwing error with languageVariants?**
   - Test endpoint directly in browser
   - Check if `ui/src/lib/unifiedResourceFetcher.ts` is executing variant discovery
   - Verify catalog search is finding variants

2. **Is SDK preserving the error data?**
   - Check console for `[SDK] ✅ Attaching languageVariants:`
   - If missing, check SDK's `sendRequest` method

3. **Is chat handler checking the right fields?**
   - Check console for `[CHAT] 🔍 Final errorDetails for retry check:`
   - Verify `errorDetails.languageVariants` exists

4. **Is retry actually executing?**
   - Check console for `[CHAT] ✅ RETRY TRIGGERED`
   - If present but no `[CHAT] ✅ RETRY SUCCEEDED`, retry call failed

---

**Test URL:** `http://localhost:8178/chat`  
**Test Input:** `"show me john 3:16 in spanish"`  
**Expected:** Scripture appears immediately, debug shows 2 entries (error + retry)
