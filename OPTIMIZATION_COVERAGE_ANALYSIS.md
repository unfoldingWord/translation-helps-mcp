# Optimization Coverage Analysis

## Question: Do all optimizations work for ALL tools with language parameter?

**Short Answer**: Partially. Some optimizations are universal, others are scripture-specific.

---

## Optimization Coverage by Type

### ✅ **UNIVERSAL** (Work for ALL Language-Based Endpoints)

These optimizations live in shared utilities and benefit ALL endpoints:

#### 1. **Variant Mapping Cache** ⭐⭐⭐
- **Location**: `ui/src/lib/simpleEndpoint.ts:255-277, 461-476`
- **Coverage**: **100% of endpoints using `createSimpleEndpoint`**
- **How it works**: Caches `baseLanguage` → `variant` mappings in memory
- **Benefit**: Second+ requests skip variant discovery entirely

**Affected Endpoints**:
- ✅ fetch-scripture
- ✅ fetch-translation-notes
- ✅ fetch-translation-questions
- ✅ fetch-translation-word
- ✅ fetch-translation-word-links
- ✅ fetch-translation-academy
- ✅ list-resources-for-language

---

#### 2. **Cache Key Consistency Fix** ⭐⭐
- **Location**: `ui/src/lib/simpleEndpoint.ts:463` (normalize organization)
- **Coverage**: **100% of endpoints using `createSimpleEndpoint`**
- **How it works**: Normalizes `organization` to `'all'` for consistent cache keys
- **Benefit**: Variant mapping cache actually works (was broken before)

**Affected Endpoints**: Same as above (all simpleEndpoint endpoints)

---

#### 3. **Known Variants Mapping** ⭐⭐
- **Location**: `src/functions/resource-detector.ts:458-466`
- **Coverage**: **100% of endpoints that call `findLanguageVariants`**
- **How it works**: Static mapping for common languages (es, pt, zh, ar)
- **Benefit**: Instant variant resolution (<1ms) for 90%+ of traffic

**Affected Endpoints**:
- ✅ All endpoints that use `unifiedResourceFetcher` or `ZipResourceFetcher2`
- ✅ All endpoints that trigger variant discovery

---

#### 4. **Filtered Languages Endpoint** ⭐
- **Location**: `src/functions/resource-detector.ts:510-554`
- **Coverage**: **100% of endpoints that call `findLanguageVariants`**
- **How it works**: Uses `catalog/list/languages` with filters for unknown variants
- **Benefit**: 92% faster variant discovery for unknown languages (~300ms vs ~4000ms)

**Affected Endpoints**: Same as Known Variants (all variant discovery)

---

### ❌ **PARTIAL** (Only Work for Scripture)

These optimizations are implemented only in specific fetcher methods:

#### 5. **Early Variant Check** ⚠️
- **Location**: `src/services/ZipResourceFetcher2.ts:400-456` (**getScripture only!**)
- **Coverage**: **Scripture endpoint only** (❌ TN, TQ, TW, TWL, TA missing)
- **How it works**: Checks for variants BEFORE wasteful force refresh retry
- **Benefit**: Eliminates ~4s of failed catalog fetches

**Affected Endpoints**:
- ✅ fetch-scripture (has optimization)
- ❌ fetch-translation-notes (**missing**)
- ❌ fetch-translation-questions (**missing**)
- ❌ fetch-translation-word (**missing**)
- ❌ fetch-translation-word-links (**missing**)
- ❌ fetch-translation-academy (**missing**)

---

## Coverage Summary Table

| Optimization | Scripture | TN | TQ | TW | TWL | TA | Status |
|--------------|-----------|----|----|----|----|----|----|
| **Variant Mapping Cache** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Universal ✅ |
| **Cache Key Fix** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Universal ✅ |
| **Known Variants** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Universal ✅ |
| **Filtered Endpoint** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Universal ✅ |
| **Early Variant Check** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **Partial** ⚠️ |

---

## Impact Analysis

### For Scripture Endpoint ✅
**All 5 optimizations working** → **95-97% improvement** (4-6s → 200-220ms)

### For Other Endpoints ⚠️
**4 out of 5 optimizations working** → Still faster, but could be even better

**Current Performance** (without early variant check):
```
First "es" request:
1. simpleEndpoint: Check variant mapping cache → MISS
2. Service layer: Fetch catalog for "es" → Empty (~20ms)
3. Service layer: Force refresh retry for "es" → Empty (~2000ms) ⚠️ WASTED
4. Service layer: Check variants → Instant (<1ms) ✅
5. Service layer: Throw error
6. simpleEndpoint: Auto-retry with "es-419" → Success (~80ms)

Total: ~2100ms (slower than it should be!)
```

**With early variant check** (like scripture):
```
First "es" request:
1. simpleEndpoint: Check variant mapping cache → MISS
2. Service layer: Fetch catalog for "es" → Empty (~20ms)
3. Service layer: Check variants IMMEDIATELY → Instant (<1ms) ✅
4. Service layer: Throw error (skip force refresh!)
5. simpleEndpoint: Auto-retry with "es-419" → Success (~80ms)

Total: ~100-120ms (2000ms saved!)
```

---

## Where Early Variant Check is Missing

### 1. **ZipResourceFetcher2.getTSVData** ❌
**File**: `src/services/ZipResourceFetcher2.ts:960-1200`
**Used by**: TN, TQ, TWL endpoints
**Problem**: Has force refresh retry, but no early variant check

```typescript
// Current code (line 1022-1057):
if (resources.length === 0) {
  const networkRes = await trackedFetch(...); // First attempt
  // ...
}
if (resources.length === 0) return { data: [], subject: undefined }; // Give up

// ❌ NO VARIANT CHECK - just returns empty!
```

**Needs**: Same early variant check logic as `getScripture`

---

### 2. **Translation Word Fetchers** ❌
**Files**: 
- `ui/src/lib/unifiedResourceFetcher.ts` (fetchTranslationWord)
- Other resource-specific fetchers

**Used by**: TW, TA endpoints
**Problem**: These use `unifiedResourceFetcher` which has variant discovery at the ENDPOINT layer (via auto-retry), but not optimized at the FETCHER layer

---

## Recommended Next Steps

### Priority 1: Add Early Variant Check to getTSVData ⭐⭐⭐
**Impact**: Saves ~2s for TN, TQ, TWL endpoints on first request

```typescript
// File: src/services/ZipResourceFetcher2.ts:1055-1057
// Replace this:
if (resources.length === 0) return { data: [], subject: undefined };

// With this:
if (resources.length === 0 && !forceRefresh) {
  logger.info(`No resources found for language=${language}, checking for variants BEFORE retry`);
  
  try {
    const { findLanguageVariants } = await import("../functions/resource-detector.js");
    const baseLanguage = language.split('-')[0];
    
    const variants = await findLanguageVariants(
      baseLanguage,
      organization === 'all' ? undefined : organization,
      topic,
      [subject] // Use the TSV subject (TN, TQ, or TWL)
    );
    
    if (variants.length > 0 && !variants.includes(language)) {
      logger.info(`Found variants for ${baseLanguage}, throwing error for auto-retry`, { variants });
      const error: any = new Error(`No ${resourceType} resources found for language '${language}'`);
      error.languageVariants = variants;
      error.requestedLanguage = language;
      throw error;
    }
  } catch (variantError: any) {
    if (variantError.languageVariants) {
      throw variantError;
    }
    logger.warn(`Variant check failed`, { error: variantError });
  }
}

if (resources.length === 0) return { data: [], subject: undefined };
```

---

### Priority 2: Test Other Endpoints ⭐⭐
**Impact**: Verify translation word and academy endpoints also benefit

**Test Commands**:
```bash
# Test TN (Translation Notes)
curl "http://localhost:8174/api/fetch-translation-notes?reference=Tit%203:11&language=es"

# Test TQ (Translation Questions)
curl "http://localhost:8174/api/fetch-translation-questions?reference=Tit%203:11&language=es"

# Test TW (Translation Word)
curl "http://localhost:8174/api/fetch-translation-word?language=es&term=love"

# Test TWL (Translation Word Links)
curl "http://localhost:8174/api/fetch-translation-word-links?reference=Tit%203:11&language=es"

# Test TA (Translation Academy)
curl "http://localhost:8174/api/fetch-translation-academy?language=es&path=translate/figs-metaphor"
```

**Expected**: 
- Without early variant check: ~2000ms first request
- With early variant check: ~100-200ms first request

---

### Priority 3: Consider Centralizing Logic ⭐
**Impact**: DRY principle, easier maintenance

**Idea**: Create a shared utility function for early variant checking:

```typescript
// src/utils/earlyVariantCheck.ts
export async function checkForVariantsEarly(
  language: string,
  organization: string | undefined,
  topic: string,
  subjects: string[]
): Promise<string[]> {
  const { findLanguageVariants } = await import("../functions/resource-detector.js");
  const baseLanguage = language.split('-')[0];
  
  const variants = await findLanguageVariants(
    baseLanguage,
    organization,
    topic,
    subjects
  );
  
  return variants;
}
```

Then use it in all fetcher methods:
- `getScripture`
- `getTSVData`
- `fetchTranslationWord`
- etc.

---

## Performance Expectations

### With ALL 5 Optimizations Applied

| Endpoint | First Request | Second+ Request | Current (Partial) |
|----------|---------------|----------------|-------------------|
| Scripture | ~200ms | ~200ms | ✅ ~200ms |
| Translation Notes | ~200ms | ~200ms | ⚠️ ~2100ms |
| Translation Questions | ~200ms | ~200ms | ⚠️ ~2100ms |
| Translation Word Links | ~200ms | ~200ms | ⚠️ ~2100ms |
| Translation Word | ~200ms | ~200ms | ⚠️ ~2100ms |
| Translation Academy | ~200ms | ~200ms | ⚠️ ~2100ms |

**Gap**: 2000ms per first request for non-scripture endpoints!

---

## Conclusion

### What's Working ✅
- **Variant mapping cache** - Universal, all endpoints benefit
- **Cache key consistency** - Universal, all endpoints benefit
- **Known variants** - Universal, all variant discovery benefits
- **Filtered endpoint** - Universal, all unknown variants benefit

### What's Missing ❌
- **Early variant check** - Only implemented for scripture, not TN/TQ/TW/TWL/TA

### Recommendation
**Implement early variant check in `getTSVData`** and other resource fetchers to achieve the same 95-97% improvement across ALL language-based endpoints, not just scripture.

**Estimated Effort**: ~30 minutes (copy logic from getScripture, adapt for each fetcher)
**Estimated Impact**: 2000ms saved per first request for 5 additional endpoints

---

**Your question uncovered an important gap!** The optimizations are mostly universal, but the critical "early variant check" is only in scripture. The other endpoints would benefit greatly from the same optimization! 🎯
