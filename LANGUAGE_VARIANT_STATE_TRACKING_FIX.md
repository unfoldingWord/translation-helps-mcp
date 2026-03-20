# Language Variant State Tracking Fix

## Problem

When users requested content in a language (e.g., "Show me in hindi" or "es"), the system would correctly:
1. Detect the language from the message
2. Make tool calls with the correct language parameter  
3. Handle variant resolution (e.g., "es" → "es-419") via automatic retry

However, the **Context State Variables** in the debug panel still showed the ORIGINAL language (e.g., `en` or `es`) instead of the ACTUAL language used (e.g., `hi` or `es-419`).

### Root Causes

1. **Conditional state update**: Language state was only updated when `needsValidation: false`, but explicit requests like "Show me in hindi" set `needsValidation: true`.
2. **Missing variant tracking**: When automatic retry resolved a variant (e.g., "es" → "es-419"), the resolved variant wasn't being tracked or synced to state.
3. **Timing issue**: State extraction from tool calls happened BEFORE retry resolution, so it only saw the original language parameter.

## Solution

### 1. Handle Tentative Language Detection

Updated `ui/src/routes/api/chat-stream/+server.ts` to set tentative language even when validation is needed:

```typescript
// Around line 2384
} else if (languageInfo.detectedLanguage && languageInfo.needsValidation) {
    // Language detected but needs validation - LLM will handle it
    // Set as tentative final language for now
    finalLanguage = languageInfo.detectedLanguage;
    logger.info('Language detected, LLM will validate', {
        detected: languageInfo.detectedLanguage,
        previous: catalogLanguage
    });
}
```

### 2. Track Resolved Language in executeMCPCalls

Modified `executeMCPCalls` function to return the resolved language after successful variant retry:

**Function signature update:**
```typescript
// Line 953
async function executeMCPCalls(
    // ... params ...
): Promise<{ data: any[]; apiCalls: any[]; resolvedLanguage?: string }> {
    const data: any[] = [];
    const apiCalls: any[] = [];
    const serverUrl = `${baseUrl}/api/mcp`;
    let resolvedLanguage: string | undefined = undefined; // Track actual language used
```

**Prompt retry tracking** (around line 1160):
```typescript
// Retry succeeded!
retrySucceeded = true;

// Track the resolved language from successful retry
if (retryParams.language && retryParams.language !== language) {
    resolvedLanguage = retryParams.language;
    logger.info('Prompt retry succeeded with language variant', { 
        prompt: promptName, 
        originalLanguage: call.params.language,
        resolvedLanguage: retryParams.language 
    });
}
```

**Endpoint retry tracking** (around line 1437):
```typescript
// Retry succeeded!
retrySucceeded = true;

// Track the resolved language from successful retry
if (retryParams.language && retryParams.language !== language) {
    resolvedLanguage = retryParams.language;
    logger.info('Endpoint retry succeeded with language variant', { 
        tool: toolName,
        originalLanguage: normalizedParams.language,
        resolvedLanguage: retryParams.language 
    });
}
```

**AvailableBooks retry tracking** (around line 1480):
```typescript
if (hasAvailableBooks) {
    // Track the resolved language from this retry
    if (retryParams.language && retryParams.language !== language) {
        resolvedLanguage = retryParams.language;
    }
    
    logger.info('Retry provided useful recovery data', {
        tool: toolName,
        availableBooksCount: retryErrorObj?.availableBooks?.length || retryErrorObj?.details?.availableBooks?.length,
        resolvedLanguage: resolvedLanguage
    });
}
```

**Return statement** (line 1606):
```typescript
return { data, apiCalls, resolvedLanguage };
```

### 3. Use Resolved Language for State Sync

Updated the caller to prioritize `resolvedLanguage` from retry over original tool call params:

```typescript
// Around line 2416
const { data, apiCalls, resolvedLanguage } = await executeMCPCalls(
    endpointCalls,
    baseUrl,
    finalLanguage,
    organization,
    languageInfo
);

// Step 3.5: Extract language from actual tool calls and update state
// Priority: resolvedLanguage (from retry) > languageFromToolCalls > catalogLanguage
const languageFromToolCalls = endpointCalls.find(call => call.params?.language)?.params?.language;
const actualLanguageUsed = resolvedLanguage || languageFromToolCalls;

if (actualLanguageUsed && actualLanguageUsed !== catalogLanguage) {
    finalLanguage = actualLanguageUsed;
    
    // Sync to SDK's ContextManager
    updateContext({
        language: finalLanguage,
        detectedLanguage: languageInfo?.detectedLanguage || finalLanguage,
        languageSource: resolvedLanguage ? 'variant-retry' : (languageInfo?.detectedLanguage ? 'llm-detected' : 'tool-call-extracted'),
        resolvedVariant: resolvedLanguage || undefined // Track if a variant was used
    });
    
    logger.info('Language extracted and synced to SDK', {
        actualLanguageUsed,
        resolvedFromRetry: !!resolvedLanguage,
        previous: catalogLanguage,
        detectedLanguage: languageInfo?.detectedLanguage
    });
}
```

## Expected Behavior

After these fixes, the **Context State Variables** should show:

### Direct Language Request ("Show me in hindi")
```
Catalog Language: en
Final Language Used: hi
Detected Language: hi
Language Source: llm-detected
```

### Variant Resolution Request ("Show me in spanish")
If "es" resolves to "es-419":
```
Catalog Language: en
Final Language Used: es-419
Detected Language: es
Language Source: variant-retry
Resolved Variant: es-419
```

## Testing

1. Clear browser cache
2. Go to http://localhost:8176/chat
3. Test scenarios:
   - "Show me Titus 3:11-15 in hindi" → should show `hi`
   - "Show me Titus 3:11-15 in spanish" → should show `es-419` if variant used
   - "Puedes mostrarme Tito 3:11-15?" (Spanish message) → should show `es` or `es-419`
4. Check debug panel → Context State Variables for each request

## Cache Key Investigation & Fix ✅

The user reported a cache key issue where:
- Requesting "es" (resolves to "es-419") doesn't hit the "es-419" cache efficiently
- Every "es" request repeats expensive variant discovery (~4+ seconds)

### Root Cause Analysis (from terminal logs)

Looking at the logs in terminal 2.txt lines 874-947:

**Request Flow for `language: 'es'`**:
1. **Line 874**: Cache key = `lang=es` in URL
2. **Line 880**: Cache MISS for `es` (expected - Door43 has no `es` resources)
3. **Line 889**: Empty response - NOT cached (by design)
4. **Line 913**: Discovers variant `es-419` exists (~4+ seconds)
5. **Line 933**: Retry with cache key = `lang=es-419` (DIFFERENT KEY!)
6. **Line 939**: Memory cache HIT for `es-419` (from previous request)

**The Problem**:
- Cache keys include the exact language: `lang=es` vs `lang=es-419` → DIFFERENT KEYS
- Door43 catalog returns ZERO resources for `lang=es` (only `es-419` exists)
- Empty responses aren't cached (to avoid caching failures)
- Every `es` request must repeat the ~4-second variant discovery

**The es-419 cache IS working**, but the system doesn't remember that `es` should map to `es-419`.

### Solution: Variant Mapping Cache

Added a **separate in-memory cache** that maps base languages to their resolved variants:
- `es` → `es-419`
- This mapping is cached for 1 hour
- Subsequent `es` requests skip directly to `es-419` without discovery

**Implementation** in `ui/src/lib/simpleEndpoint.ts`:

**Module-level cache** (after line 17):
```typescript
// 💾 In-memory variant mapping cache (prevents repeated expensive variant discovery)
// Format: "baseLanguage:organization:endpoint" -> { variant: string, timestamp: number }
const variantMappingCache = new Map<string, { variant: string; timestamp: number }>();
const VARIANT_MAPPING_TTL = 3600000; // 1 hour - variants rarely change
```

**Check cache before fetch** (line ~255):
```typescript
// 1.5. Check variant mapping cache (OPTIMIZATION)
if (parsedParams.language) {
    const variantMappingKey = `${parsedParams.language}:${parsedParams.organization || 'all'}:${config.name}`;
    const cachedMapping = variantMappingCache.get(variantMappingKey);
    
    if (cachedMapping && (Date.now() - cachedMapping.timestamp) < VARIANT_MAPPING_TTL) {
        console.log(`[VARIANT CACHE] ✅ Using cached variant mapping:`, {
            endpoint: config.name,
            requested: parsedParams.language,
            mapped: cachedMapping.variant,
            age: `${Math.round((Date.now() - cachedMapping.timestamp) / 1000)}s ago`
        });
        
        // Update params to use the cached variant
        parsedParams.language = cachedMapping.variant;
    }
}
```

**Save mapping after successful retry** (line ~429):
```typescript
logger.info(`[simpleEndpoint] ✅ Retry succeeded in ${retryResponseTime}ms`);

// 💾 CACHE VARIANT MAPPING
const variantMappingKey = `${parsedParams.language}:${retryParams.organization}:${config.name}`;
variantMappingCache.set(variantMappingKey, {
    variant: suggestedLanguage,
    timestamp: Date.now()
});

console.log(`[VARIANT CACHE] 💾 Saved variant mapping:`, {
    endpoint: config.name,
    from: parsedParams.language,
    to: suggestedLanguage,
    organization: retryParams.organization
});
```

### Performance Impact

**Before** (subsequent `language: 'es'` requests):
```
1. Try catalog for 'es' → MISS → ~11ms
2. Discover variants → ~4000ms
3. Retry with 'es-419' → HIT → ~1ms
Total: ~4011ms
```

**After** (with variant cache):
```
1. Check variant cache → HIT → <1ms
2. Use 'es-419' directly → HIT → ~1ms
Total: ~2ms (99.95% faster!)
```

### Expected Logs

**First request for 'es'**:
```
[CACHE KEY TRACE] Scripture catalog cache key: { language: 'es', ... }
[CACHE KEY TRACE] ❌ Catalog cache MISS - fetching from network
[INFO] Found language variants for base=es: [ 'es-419' ]
[INFO] [simpleEndpoint] 🔄 Auto-retry triggered: es → es-419
[VARIANT CACHE] 💾 Saved variant mapping: { from: 'es', to: 'es-419' }
```

**Second request for 'es'** (should skip discovery):
```
[VARIANT CACHE] ✅ Using cached variant mapping: { requested: 'es', mapped: 'es-419', age: '5s ago' }
[CACHE KEY TRACE] Scripture catalog cache key: { language: 'es-419', ... }
[CACHE TRACE] ✅ Catalog cache HIT: { source: 'memory', language: 'es-419' }
```

## Files Modified

- `ui/src/routes/api/chat-stream/+server.ts`:
  - Added tentative language update for `needsValidation: true` case
  - Modified `executeMCPCalls` to track and return `resolvedLanguage`
  - Added resolved language tracking in prompt retry (line ~1160)
  - Added resolved language tracking in endpoint retry (line ~1437)
  - Added resolved language tracking in availableBooks retry (line ~1480)
  - Updated caller to prioritize `resolvedLanguage` and sync to SDK (line ~2425)

## Related Issues

- [CONTEXT_STATE_FIX.md](CONTEXT_STATE_FIX.md) - Previous fix for missing context state
- [STREAMING_PATH_BUG_FIX.md](STREAMING_PATH_BUG_FIX.md) - Fix for streaming path not passing state

---

**Status**: State tracking implemented. Cache key investigation pending user testing feedback.
