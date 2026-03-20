# Language Variant Discovery Implementation

## Problem

When users request scripture in a language using a base language code (e.g., `"es"` for Spanish), the system may fail with a 400 error if no resources exist for that exact code. However, language-specific variants might be available (e.g., `"es-419"` for Latin American Spanish).

Example failure:
```
User: "show me john 3:16 in spanish"
Parameters: { reference: "JHN 3:16", language: "es", format: "json" }
Error: 400 - No scripture resources found
```

## Solution

When a language code fails to find resources, the system now automatically searches for available language variants and includes them in the error response. This allows the LLM to react intelligently and suggest alternatives to the user.

## Implementation

### 1. Language Variant Discovery Function

**File:** `src/functions/resource-detector.ts`

Added `findLanguageVariants()` function:
- Searches Door43 catalog for all resources matching a base language code
- Extracts unique language codes from resource names
- Returns sorted list of available variants
- Includes caching (1 hour TTL) for performance

```typescript
export async function findLanguageVariants(
  baseLanguage: string,
  organization?: string,
  topic: string = "tc-ready",
): Promise<string[]>
```

### 2. Enhanced Error Handling in Unified Resource Fetcher

**File:** `ui/src/lib/unifiedResourceFetcher.ts`

Modified `fetchScripture()` method (lines 158-174):
- When no results found, attempts to discover language variants
- Queries catalog for resources matching base language code
- Extracts language codes from resource names (pattern: `{lang}_{resource}`)
- Enhances error message with available variants
- Attaches `languageVariants` array to error object for downstream handling

**Enhanced Error Message Format:**
```
No scripture found for language='es' and reference 'JHN 3:16'.

Available language variants for 'es': es-419

Please try one of these language codes instead.
```

### 3. Error Metadata

Errors now include:
- `languageVariants`: Array of available language codes
- `requestedLanguage`: The language code that failed
- `validBookCodes`: List of valid book codes (existing)
- `invalidCode`: The book code that was attempted (existing)

This metadata helps the LLM provide more intelligent suggestions.

## Flow Diagram

```
User: "show me john 3:16 in spanish"
↓
Language Detection: es-419
↓
LLM: Use base code "es" (per instructions)
↓
fetch_scripture(reference="JHN 3:16", language="es")
↓
UnifiedResourceFetcher.fetchScripture()
↓
ZipResourceFetcher2.getScripture() → No results
↓
Discover language variants:
  Catalog search: lang=es&tag=tc-ready
  → Found: es-419
↓
Throw enhanced error:
  "No scripture found for language='es'...
   Available variants: es-419
   Please try one of these instead."
↓
Error propagates to LLM
↓
LLM Response: "I see Spanish resources are available as 'es-419'. 
               Let me fetch that for you..."
↓
fetch_scripture(reference="JHN 3:16", language="es-419") ✅
```

## Testing

**Dev Server:** `http://localhost:8178/chat`

### Test Case 1: Base Language Code with Variants

Input: `"show me john 3:16 in spanish"`

Expected behavior:
1. LLM tries `language="es"` (base code)
2. Fetch fails, discovers variant `es-419`
3. Error message includes: `"Available language variants for 'es': es-419"`
4. LLM can then retry with `language="es-419"`

### Test Case 2: Debug Console

Check debug console → Error details should show:
```json
{
  "error": "No scripture found for language='es'...\n\nAvailable language variants for 'es': es-419\n\nPlease try one of these language codes instead.",
  "languageVariants": ["es-419"],
  "requestedLanguage": "es"
}
```

### Test Case 3: Other Languages

Try other base codes:
- `"show me john 3:16 in french"` → should discover `fr` variants
- `"show me john 3:16 in portuguese"` → should discover `pt-BR` variants
- `"show me john 3:16 in english"` → should work with `en` directly

## Benefits

1. **Better UX:** LLM can guide users to available language variants instead of dead-end errors
2. **Intelligent Recovery:** System self-corrects by discovering alternatives
3. **Clear Guidance:** Users see exactly what language codes are available
4. **Cached Discovery:** Variant discovery is cached for 1 hour (in resource-detector) or per-request (in UnifiedResourceFetcher)
5. **No Breaking Changes:** Existing successful requests work exactly as before

## Related Files

- `src/functions/resource-detector.ts` - `findLanguageVariants()` function (unused in current flow, but available for future)
- `src/unified-services/ScriptureService.ts` - Enhanced with variant discovery (not used by UI currently)
- `ui/src/lib/unifiedResourceFetcher.ts` - Main implementation for UI/API endpoints
- `ui/src/routes/api/fetch-scripture/+server.ts` - Endpoint that benefits from enhanced errors
- `ui/src/routes/api/chat-stream/+server.ts` - LLM receives enhanced error messages

## Performance Impact

- **Minimal:** Variant discovery only happens on error (not on successful requests)
- **Fast:** Catalog search is lightweight (returns metadata only, no zip downloads)
- **Cached:** Results cached at multiple levels (catalog cache, resource discovery cache)
- **Async:** Discovery runs in parallel with error handling

## Token Impact

Enhanced error messages add ~30-50 tokens to error responses:
- Before: `"No scripture found for reference 'JHN 3:16'..."` (~15 tokens)
- After: `"No scripture found...Available variants: es-419...Please try..."` (~45 tokens)

This is acceptable since:
1. Only applies to error cases (not normal flow)
2. Prevents additional back-and-forth conversation turns
3. Enables one-shot recovery instead of multi-turn discovery

## Automatic Retry Implementation

### Retry Logic in Chat Stream

**File:** `ui/src/routes/api/chat-stream/+server.ts`

Added automatic retry logic in the `executeMCPCalls()` function:

**For Individual Tool Calls (lines 1244-1347):**
```typescript
} catch (error) {
  // Extract error details
  // ...
  
  // AUTOMATIC RETRY: Check if error has structured recovery data
  const hasLanguageVariants = errorResponse?.details?.languageVariants?.length > 0;
  const hasValidBookCodes = errorResponse?.details?.validBookCodes?.length > 0;

  if (hasLanguageVariants || hasValidBookCodes) {
    try {
      const retryParams = { ...normalizedParams };
      
      if (hasLanguageVariants) {
        // Retry with first available language variant
        retryParams.language = errorResponse.details.languageVariants[0];
      }
      
      // Execute retry
      const retryResponse = await callTool(toolName, retryParams, serverUrl);
      
      // Success! Add retry result to data
      data.push({ type: endpointName, params: retryParams, result: retryResult });
      
      // Log both attempts
      apiCalls.push({ ...originalError, error: `${errorMessage} (auto-retried)` });
      apiCalls.push({ ...retrySuccess, isRetry: true });
      
      retrySucceeded = true;
    } catch (retryError) {
      // Retry failed - continue with original error
    }
  }
  
  // Log original error if retry didn't succeed
  if (!retrySucceeded) {
    apiCalls.push({ ...originalError });
  }
}
```

**For Prompt Calls (lines 1108-1234):**
Similar retry logic implemented for prompts that internally call tools (e.g., `translation-helps-for-passage`).

### Error Context Enhancement

**Enhanced error messages passed to LLM (lines 1985-2007):**
```typescript
if (err.response?.details?.languageVariants) {
  errorContext += `  Available language variants: ${err.response.details.languageVariants.join(', ')}\n`;
  errorContext += `  Requested language: ${err.response.details.requestedLanguage}\n`;
  errorContext += `  IMPORTANT: Retry the same request using one of the available language variants.\n`;
}
```

### Retry Flow

```
User: "show me john 3:16 in spanish"
↓
LLM Decision: fetch_scripture(reference="JHN 3:16", language="es")
↓
executeMCPCalls() → callTool("fetch_scripture", { reference: "JHN 3:16", language: "es" })
↓
UnifiedResourceFetcher.fetchScripture() → Error: No resources for "es"
  - Discovers variants: ["es-419"]
  - Throws error with languageVariants: ["es-419"]
↓
Error caught in executeMCPCalls() catch block
↓
Auto-retry logic detects languageVariants
↓
callTool("fetch_scripture", { reference: "JHN 3:16", language: "es-419" }) ← AUTOMATIC RETRY
↓
Success! Data returned to user ✅
↓
apiCalls log shows:
  [1] fetch-scripture: status=404, params={language:"es"}, error="No resources (auto-retried)"
  [2] fetch-scripture: status=200, params={language:"es-419"}, isRetry=true ✅
```

### Benefits of Automatic Retry

1. **Transparent Recovery:** Errors are automatically corrected without user interaction
2. **No Additional Latency:** Retry happens immediately in the same request
3. **Full Visibility:** Debug console shows both the failed attempt and successful retry
4. **Graceful Degradation:** If retry fails, original error is preserved
5. **Single Round Trip:** User gets correct data in one chat turn instead of back-and-forth

### Retry Safeguards

1. **Single Retry Only:** Each call retries at most once (no infinite loops)
2. **Parameter Validation:** Only retries if parameters actually changed
3. **Error Preservation:** Original error logged even on successful retry
4. **Scoped Retries:** Only retries when structured recovery data exists
5. **Failure Tolerance:** If retry fails, original error context passed to LLM

### Debug Console Output

The debug sidebar now shows retry attempts clearly:

```
🔧 MCP TOOL - ERROR - 404 - fetch-scripture
  User asked: "show me john 3:16 in spanish"
  Tool endpoint failed: 400 (auto-retried)
  
  Parameters:
  { "reference": "JHN 3:16", "language": "es" }
  
  Available language variants: es-419
  Requested language: es

🔧 MCP TOOL - SUCCESS - 200 - fetch-scripture [RETRY]
  Parameters:
  { "reference": "JHN 3:16", "language": "es-419" }
  
  Response: [scripture data...]
```

## Future Enhancements

1. **Book Code Auto-Retry:** Implement reference re-parsing for invalid book codes
2. **Multi-Variant Fallback:** Try multiple language variants if first retry fails
3. **Proactive Validation:** Validate language codes before first attempt
4. **Smart Defaults:** If user says "Spanish" and only one variant exists, use it automatically
5. **Regional Preferences:** Learn user's preferred language variants over time
6. **Cross-Resource Discovery:** Apply variant discovery to other fetch tools (TN, TW, TQ, TA)
7. **Retry Metrics:** Track retry success rate and common recovery patterns
