# Debug Error Response - Troubleshooting Guide

## Current Status

I've added extensive debug logging to help trace where the `validBookCodes` data might be getting lost.

## Files Updated

1. **SDK Error Handling** (`packages/js-sdk/src/client.ts`)
   - ✅ Preserves `error.data` as `error.details`
   - ✅ Attaches `validBookCodes` directly to error object
   - ✅ Compiled and copied to `ui/node_modules`

2. **UI Error Handler** (`ui/src/routes/(app)/mcp-tools/+page.svelte`)
   - ✅ Enhanced with debug logging
   - ✅ Checks both `error.validBookCodes` and `error.details.validBookCodes`
   - ✅ Preserves all error details

## Debug Logging Added

When you test now, you should see console logs like:

```javascript
❌ MCP tool call failed for fetch_scripture: Error: Tool endpoint failed: 400

🔍 Error object structure: {
  hasValidBookCodes: true,        // Should be true
  hasDetails: true,                // Should be true
  hasDetailsValidBookCodes: true,  // Should be true
  errorKeys: ['message', 'stack', 'details', 'validBookCodes', 'invalidCode'],
  detailsKeys: ['validBookCodes', 'invalidCode'],
  validBookCodesCount: 66          // Should be 66
}

✅ Found validBookCodes on error object: 66
```

## Testing Steps

1. **Hard Refresh Browser**
   - Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
   - This ensures the browser loads the updated JavaScript

2. **Open Browser DevTools**
   - Press `F12` or right-click → Inspect
   - Go to the **Console** tab

3. **Test with Invalid Book Code**
   - Go to `/mcp-tools`
   - Select `fetch_scripture`
   - Enter reference: `TestBook 1:1`
   - Click "Test API"

4. **Check Console Output**
   - Look for the `🔍 Error object structure:` log
   - Check if `validBookCodesCount` is 66
   - Look for either:
     - `✅ Found validBookCodes on error object: 66`
     - `✅ Found validBookCodes on error.details: 66`
     - `⚠️ No validBookCodes found in error object` (if this appears, we have a problem)

5. **Check Response Data Box**
   - Expand the "Response Data" section
   - Look for `validBookCodes` array in `details`

## Expected Output

**Console:**
```
❌ MCP tool call failed for fetch_scripture: Error: Tool endpoint failed: 400
🔍 Error object structure: { validBookCodesCount: 66, ... }
✅ Found validBookCodes on error object: 66
```

**Response Data:**
```json
{
  "error": "Tool endpoint failed: 400",
  "details": {
    "endpoint": "fetch_scripture",
    "toolName": "fetch_scripture",
    "timestamp": "2026-03-13T10:35:00.000Z",
    "validBookCodes": [
      {"code": "GEN", "name": "Genesis"},
      {"code": "EXO", "name": "Exodus"},
      ... // All 66 books
    ],
    "invalidCode": "TESTBOOK"
  },
  "status": 0
}
```

## Possible Issues

### Issue 1: Browser Cache
**Symptom:** Old error message still showing
**Fix:** Hard refresh (Ctrl+Shift+R) or clear browser cache

### Issue 2: SDK Not Updated
**Symptom:** Console shows `validBookCodesCount: 0`
**Fix:**
```bash
# Copy SDK files again
cp -f packages/js-sdk/dist/* ui/node_modules/@translation-helps/mcp-client/dist/

# Restart dev server
cd ui
npm run dev
```

### Issue 3: Server Not Returning validBookCodes
**Symptom:** MCP response doesn't have `error.data.validBookCodes`
**Test:**
```bash
curl -s -X POST "http://localhost:8175/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fetch_scripture","arguments":{"reference":"XYZ 1:1","language":"en"}}}' \
  | grep -o '"validBookCodes"'
```

**Expected:** Should output `"validBookCodes"`

### Issue 4: SDK Error Handling
**Symptom:** Console shows error but no debug logs
**Check:** Verify SDK was compiled correctly:
```bash
grep -A5 "Preserve error.data" packages/js-sdk/dist/client.js
```

**Expected:** Should show the error handling code with `validBookCodes`

## Manual Verification

If the UI still doesn't show it, test the raw endpoint:

```bash
# Test MCP endpoint directly
curl -X POST "http://localhost:8175/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fetch_scripture","arguments":{"reference":"ABC 1:1","language":"en"}}}' \
  | jq '.error.data.validBookCodes | length'
```

**Expected output:** `66`

## Next Steps

Based on what you see in the console:

1. **If `validBookCodesCount: 66`** → The data is there, but UI display might be cached
2. **If `validBookCodesCount: 0`** → SDK is not preserving the data correctly
3. **If no debug logs appear** → Browser cache issue or dev server not restarted

Please share:
1. Screenshot of the console output (especially the `🔍 Error object structure` log)
2. Screenshot of the Response Data section
3. Any other error messages you see

---

**Last Updated:** March 13, 2026  
**Status:** Debug logging added, awaiting test results
