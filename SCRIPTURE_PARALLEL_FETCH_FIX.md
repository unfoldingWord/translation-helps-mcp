# Scripture Parallel Fetch Performance Fix

## Problem
The `fetch_scripture` endpoint was significantly slower than expected, despite having made optimizations for parallel fetching in the lower-level `ZipResourceFetcher2.ts`.

## Root Cause
In `src/functions/scripture-service.ts`, resources were being processed **sequentially** in a `for` loop (line 214):

```typescript
for (const resource of resourcesToProcess) {
  const usfmData = await zipFetcher.getRawUSFMContent(...);
  // ... process each resource one by one
  scriptures.push(result);
}
```

This meant that if there were 3 resources (ULT, UST, UHB), they would be fetched and processed one after another, even though they could be fetched in parallel.

## Solution
**Converted sequential loop to parallel `Promise.all` pattern:**

### Before (Sequential):
```typescript
const scriptures = [];
for (const resource of resourcesToProcess) {
  // await processing...
  scriptures.push(result);
}
```

### After (Parallel):
```typescript
const resourcePromises = resourcesToProcess.map(async (resource) => {
  // ... processing ...
  return result;
});

const scriptureResults = await Promise.all(resourcePromises);
const scriptures = scriptureResults.filter(s => s !== null);
```

## Performance Impact
**Expected improvement:**
- **1 resource:** No change (~same time)
- **2 resources:** ~2x faster (from 2s → 1s)
- **3 resources:** ~3x faster (from 3s → 1s)

Actual performance depends on cache hits and network latency, but resources are now fetched **simultaneously** instead of **sequentially**.

## Technical Details

### Changes Made
**File:** `src/functions/scripture-service.ts`

1. **Converted loop to `map` + `Promise.all`** (lines 213-240):
   ```typescript
   const resourcePromises = resourcesToProcess.map(async (resource) => {
     // ... existing processing logic ...
     return scriptureResult;
   });
   const scriptureResults = await Promise.all(resourcePromises);
   ```

2. **Changed `scriptures.push()` to `return`** (line 391):
   ```typescript
   // Before: scriptures.push({...})
   // After:  return {...}
   ```

3. **Changed `continue` to `return null`** (lines 232, 414):
   ```typescript
   // Before: continue;
   // After:  return null;
   ```

4. **Filter null results** (line 447):
   ```typescript
   const scriptures = scriptureResults.filter((s): s is NonNullable<typeof s> => s !== null);
   ```

5. **Added parallel fetch logging:**
   ```typescript
   logger.info(`[PARALLEL FETCH] Starting parallel fetch for ${resourcesToProcess.length} resources`);
   logger.info(`[PARALLEL FETCH] Completed ${scriptureResults.length} fetches in parallel`);
   ```

## Consistency with Other Services
This change brings `scripture-service.ts` into alignment with the parallel fetching pattern already implemented in:
- `ZipResourceFetcher2.ts` (lines 610-663 for raw files, 1042-1120 for TSV)
- Translation Notes service (multi-resource fetching)
- Translation Questions service (multi-resource fetching)
- Translation Word Links service (multi-resource fetching)

## Expected Behavior
When fetching scripture for a reference like "John 3:16":
1. **Discovery:** All available resources (ULT, UST, etc.) are discovered from the catalog
2. **Parallel Fetch:** All resources are fetched **simultaneously** from R2/cache
3. **Parallel Processing:** USFM extraction and alignment processing happens in parallel
4. **Aggregation:** Results are collected and returned together

## Related Optimizations
This change complements the existing parallel fetch optimizations:
- ✅ `ZipResourceFetcher2.ts` parallel ZIP downloads
- ✅ `ZipResourceFetcher2.ts` parallel TSV fetches
- ✅ `ZipResourceFetcher2.ts` parallel markdown fetches
- ✅ `scripture-service.ts` parallel resource processing (NEW)

---

**Status:** ✅ Fixed
**Date:** 2026-03-13
**Files Changed:** 
- `src/functions/scripture-service.ts`
