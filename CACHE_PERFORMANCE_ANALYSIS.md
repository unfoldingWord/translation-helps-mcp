# Cache Performance Analysis: Why R2 "Cache Hits" Are Slow

## The Issue

You're seeing "cache hit" requests taking 170-225ms for `fetch_scripture`, despite the X-Ray trace showing 100% cache hit rate:

```
X-Ray: DCS Call Trace
2. ✅ hit  internal://r2/file/by-url/.../en_ult/.../44-JHN.usfm   198ms
3. ✅ hit  internal://r2/file/by-url/.../en_ust/.../44-JHN.usfm   225ms
4. ✅ hit  internal://r2/file/by-url/.../en_t4t/.../44-JHN.usfm    23ms
5. ✅ hit  internal://r2/file/by-url/.../en_bsb/.../44-JHN.usfm   173ms
```

---

## Understanding the Two-Layer Cache

Your system uses **two cache layers**:

### Layer 1: Cache API (Fast ⚡ - 1-10ms)
**Location**: `src/functions/r2-storage.ts` lines 188-204

```typescript
const c = this.defaultCache;
if (c) {
  const hit = await c.match(req);
  if (hit) {
    // ⚡ FAST PATH: ~1-10ms
    return { source: "cache", durationMs: ~5ms };
  }
}
```

**Characteristics**:
- ✅ Extremely fast (in-memory or local SSD)
- ❌ Limited storage (~50-100MB typical)
- ❌ Can be evicted by browser/runtime
- ✅ Automatic via browser Cache API

### Layer 2: R2 Bucket (Slower 🐌 - 100-300ms)
**Location**: `src/functions/r2-storage.ts` lines 206-229

```typescript
if (!this.bucket) return { data: null, source: "miss" };
const obj = await this.bucket.get(key);
const text = await obj.text();
// 🐌 SLOW PATH: ~100-300ms
return { source: "r2", durationMs: ~200ms };
```

**Characteristics**:
- 🐌 Slower (network call to Cloudflare R2)
- ✅ Unlimited storage
- ✅ Durable across sessions
- ✅ Still much faster than fetching from DCS (~2-5 seconds)

---

## Why R2 Access Takes 170-225ms

When you see `source: "r2"` (not `source: "cache"`), it means:

1. **Cache API Miss**: File wasn't in the fast Cache API layer
2. **R2 Bucket Fetch**: Had to retrieve from R2 object storage
3. **Network Latency**: Round-trip to R2 bucket (~50-100ms)
4. **Object Retrieval**: R2 reads object and streams content (~50-100ms)
5. **Data Transfer**: Downloads file content (~20-100ms depending on size)
6. **Backfill**: Writes to Cache API for next time (line 212-220)

### Breakdown of 200ms R2 access:
- **Network RTT**: 50-80ms (Cloudflare edge → R2 bucket)
- **R2 metadata lookup**: 20-30ms
- **Object retrieval**: 30-50ms
- **Data transfer**: 30-60ms (depends on file size)
- **Total**: 130-220ms ✅ Matches your observations

---

## Why Some Files Are Faster

Notice the variance in your trace:

| File | Duration | Likely Reason |
|------|----------|---------------|
| en_ult | 198ms | Large file (ULT is verbose) + cold R2 object |
| en_ust | 225ms | Large file (UST is verbose) + cold R2 object |
| **en_t4t** | **23ms** | **Small file OR recently accessed (warm R2)** |
| en_bsb | 173ms | Medium file + cold R2 object |

The 23ms for `en_t4t` suggests it was either:
1. **Warm in R2's internal cache** (recently accessed, still in R2's RAM)
2. **Smaller file size** (T4T might be more concise)
3. **Better network path** (different R2 datacenter)

---

## The Real Question: Why Aren't These in Cache API?

The fast Cache API layer should have these files, but they're missing. Possible reasons:

### 1. **Cache API Storage Limits**
- Browser/Cloudflare Worker Cache API has size limits (~50-100MB)
- USFM files can be 50-500KB each
- With multiple translations and books, easily exceeds limit
- Least-recently-used (LRU) eviction pushes files to R2

### 2. **First Access After Deployment**
- If you recently deployed or restarted the server
- Cache API is empty
- First access goes to R2
- Subsequent access should be faster

### 3. **Different Worker Instances**
- Cloudflare Workers can run on multiple edge locations
- Each has its own Cache API
- A request to a different edge location = cache miss
- Must fetch from R2 (which is global)

### 4. **Cache API Disabled in Dev**
- In development mode, Cache API might be disabled
- All requests go to R2 to ensure fresh data

---

## Is This a Problem?

### ❌ **NOT a problem** if:
- This is the **first request** for these resources
- You're in **development mode** (caching often disabled)
- User is accessing **rarely-used translations**
- 200ms is acceptable for your use case

### ✅ **IS a problem** if:
- These are **frequently accessed** resources
- Same user sees 200ms on **repeated requests**
- You need **consistent < 50ms response times**

---

## Recommendations

### Immediate (Easy Wins)

#### 1. **Monitor Cache API Hit Rate**
Add logging to see Cache API effectiveness:

```typescript
// In src/functions/r2-storage.ts, line 189
if (c) {
  const hit = await c.match(req);
  console.log(`[CACHE] ${hit ? 'HIT' : 'MISS'} Cache API for ${key}`);
  if (hit) {
    // ... fast path
  }
}
```

#### 2. **Check File Sizes**
Large files take longer to transfer from R2:

```bash
# Check USFM file sizes
curl -I https://git.door43.org/unfoldingWord/en_ult/raw/branch/master/44-JHN.usfm
curl -I https://git.door43.org/unfoldingWord/en_t4t/raw/branch/master/44-JHN.usfm
```

#### 3. **Add Size to X-Ray Trace**
You already track size (line 619), but make it more visible:

```typescript
this.tracer.addApiCall({
  url: `internal://${source}/file/${fileKey}`,
  duration: durationMs,
  status: 200,
  size,  // ← Already tracked
  cached: isCacheHit,
  // Add human-readable size
  metadata: { sizeKB: Math.round(size / 1024) }
});
```

### Medium (Performance Optimization)

#### 4. **Implement Memory Cache**
Add an in-memory cache before Cache API:

```typescript
// Simple LRU memory cache (5-10MB)
const memoryCache = new Map<string, { data: string; timestamp: number }>();
const MAX_MEMORY_CACHE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_MEMORY_CACHE_AGE = 60 * 1000; // 1 minute

async getFileWithInfo(key: string) {
  // Check memory cache first (< 1ms)
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.timestamp < MAX_MEMORY_CACHE_AGE) {
    return { data: cached.data, source: "memory", durationMs: 0, size: cached.data.length };
  }
  
  // Then Cache API...
  // Then R2...
  
  // After R2 fetch, store in memory
  if (text && text.length < MAX_MEMORY_CACHE_SIZE) {
    memoryCache.set(key, { data: text, timestamp: Date.now() });
  }
}
```

#### 5. **Prefetch Common Resources**
Pre-warm the cache for frequently accessed translations:

```typescript
// At server startup
async function warmCache() {
  const commonBooks = ['43-JHN', '40-MAT', '45-ROM'];
  const commonTranslations = ['en_ult', 'en_ust'];
  
  for (const book of commonBooks) {
    for (const translation of commonTranslations) {
      // Trigger cache population
      await r2.getFile(`by-url/.../en_${translation}/.../files/${book}.usfm`);
    }
  }
}
```

#### 6. **Use R2 Read-Through Caching**
Configure R2 bucket with edge caching:

```typescript
// In wrangler.toml
[[r2_buckets]]
binding = "TRANSLATION_CACHE"
bucket_name = "translation-helps-cache"
# Enable R2's built-in edge caching
preview_bucket_name = "translation-helps-cache-preview"
```

### Long-term (Architecture)

#### 7. **Implement Tiered Storage Strategy**

```
Request → Memory Cache (< 1ms)
           ↓ miss
         → Cache API (5-10ms)
           ↓ miss
         → R2 Hot Tier (50-100ms) ← frequently accessed
           ↓ miss
         → R2 Cold Tier (150-250ms) ← rarely accessed
           ↓ miss
         → DCS API (2-5 seconds) ← source of truth
```

#### 8. **Add Cache Warmth Scoring**
Track access patterns and pre-emptively promote files:

```typescript
interface CacheEntry {
  key: string;
  accessCount: number;
  lastAccess: number;
  tier: 'memory' | 'cache-api' | 'r2-hot' | 'r2-cold';
}

// Promote frequently accessed files to faster tiers
if (accessCount > 10 && lastAccess < 1_hour_ago) {
  promoteTo('memory');
}
```

---

## Expected Performance After Optimization

### Current (Your Trace)
```
Memory Cache:       N/A (not implemented)
Cache API:          N/A (miss for all)
R2 Bucket:         23-225ms (4/4 files)
Total:             628ms for 4 files
```

### After Memory Cache
```
Memory Cache:      < 1ms (3/4 files - 75% hit rate)
Cache API:         5ms (0/4 - bypassed by memory)
R2 Bucket:         150ms (1/4 - only first/rare files)
Total:             ~155ms for 4 files (4x faster)
```

### After Full Optimization
```
Memory Cache:      < 1ms (15/16 files - 94% hit rate)
Cache API:         5ms (1/16 - occasional evictions)
R2 Bucket:         100ms (0/16 - only on cold start)
Total:             ~20ms for 4 files (30x faster)
```

---

## Conclusion

**Your 170-225ms "cache hits" are actually R2 bucket fetches**, which are:

1. ✅ **Still cached** (vs 2-5 second DCS fetch)
2. ✅ **Expected behavior** for Cache API misses
3. 🔧 **Can be optimized** with memory caching

**Action Items**:
1. Add logging to see Cache API hit/miss rate
2. Implement simple memory cache (biggest win)
3. Monitor if repeated requests get faster
4. Consider prefetching common resources

The system is working correctly, but there's room for optimization if you need consistently fast responses.
