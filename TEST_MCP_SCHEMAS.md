# MCP Schema Validation Testing Guide

## 🐛 Bug Fixed: Empty Input Schemas

**Issue:** MCP `tools/list` endpoint was returning empty `inputSchema` objects due to Zod version mismatch between root package and UI package.

**Root Cause:**

- Root package used Zod v3.22.4
- UI package used Zod v4.0.10
- `zod-to-json-schema` in UI expected v4 internals (`._zod.def`) but got v3 schemas (`._def`)

**Fix Applied:**

- Changed `ui/package.json` line 64 from `"zod": "^4.0.10"` to `"zod": "^3.22.4"`
- Aligned `zod-to-json-schema` to v3.24.6 (compatible with Zod v3)

---

## ✅ Testing Methods

### Method 1: Quick TypeScript Test (Recommended)

Run the standalone test script:

```bash
npm run test:mcp-schemas
```

Or directly:

```bash
npx tsx scripts/test-mcp-schemas.mts
```

**What it tests:**

- ✅ All tools have non-empty schemas
- ✅ Schemas have proper properties
- ✅ Total parameter count across tools
- ✅ Shows example schema output

**Expected output:**

```
✅ Found 9 tools
✅ fetch_scripture - Has 7 properties
✅ fetch_translation_notes - Has 6 properties
... (all tools passing)

📊 Summary:
   Total tools: 9
   Total parameters across all tools: 45

✅ SUCCESS: All tools have complete schemas!
```

---

### Method 2: Unit Tests with Vitest

Run comprehensive unit tests:

```bash
npm run test:mcp-schemas:unit
```

**What it tests:**

- ✅ All tools have non-empty schemas
- ✅ No tools have empty schemas (regression test)
- ✅ Critical tools exist with proper schemas
- ✅ Reference-based tools have `reference` parameter
- ✅ Schema structure validation

**Expected output:**

```
✓ tests/mcp-schema-validation.test.ts (6 tests)
   ✓ MCP Tools Schema Validation
     ✓ should return tool definitions with complete input schemas
     ✓ should have non-empty input schemas for all tools
     ✓ should NOT have any empty schemas (the bug we fixed)
     ✓ should have specific expected tools with proper schemas
     ✓ should have "reference" parameter in scripture/notes/questions tools

Test Files  1 passed (1)
     Tests  6 passed (6)
```

---

### Method 3: HTTP Endpoint Test (Production-like)

Test the actual MCP HTTP endpoint:

```bash
# Start dev server
cd ui && npm run dev

# In another terminal, test the endpoint:
curl -X POST http://localhost:5173/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }' | jq '.result.tools[0].inputSchema'
```

**Expected output:** A complete schema with properties, not just:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Instead, you should see:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "language": {
      "type": "string",
      "default": "en",
      "description": "Language code (default: \"en\")"
    },
    "organization": { ... },
    ...
  },
  "required": ["reference"],
  ...
}
```

---

## 🔧 Reinstall Dependencies (After Fix)

To apply the fix, reinstall UI dependencies:

```bash
cd ui
rm -rf node_modules package-lock.json
npm install
```

Then verify Zod version:

```bash
npm list zod
```

**Expected output:**

```
tc-helps-ui@7.3.0
└── zod@3.22.4  ✓ (correct version)
```

---

## 🚀 Deploy to Production

After verifying tests pass:

```bash
# 1. Build with fixed dependencies
npm run build:cloudflare

# 2. Deploy to Cloudflare Pages
npm run deploy
```

---

## 📊 Test Results Summary

### ✅ Current Status (After Fix)

| Test Method           | Status              | Details                             |
| --------------------- | ------------------- | ----------------------------------- |
| Quick TypeScript Test | ✅ PASSING          | All 9 tools have complete schemas   |
| Unit Tests            | ✅ PASSING          | 6/6 tests passing                   |
| HTTP Endpoint         | ⏳ Requires rebuild | Will pass after `npm install` in UI |

### 📈 Schema Statistics

- **Total Tools:** 9
- **Total Parameters:** 45 across all tools
- **Empty Schemas:** 0 (was 9 before fix)

### 🎯 Critical Tools Validated

All these tools now have complete schemas:

1. ✅ `fetch_scripture` - 7 parameters
2. ✅ `fetch_translation_notes` - 6 parameters
3. ✅ `fetch_translation_questions` - 4 parameters
4. ✅ `fetch_translation_word_links` - 4 parameters
5. ✅ `fetch_translation_word` - 7 parameters
6. ✅ `fetch_translation_academy` - 6 parameters
7. ✅ `list_languages` - 2 parameters
8. ✅ `list_subjects` - 3 parameters
9. ✅ `list_resources_for_language` - 6 parameters

---

## 🐞 Debugging Failed Tests

If tests fail after reinstall, check:

1. **Verify Zod version alignment:**

   ```bash
   npm list zod    # Root should show v3.22.4
   cd ui && npm list zod  # UI should show v3.22.4
   ```

2. **Check for mixed versions:**

   ```bash
   cd ui
   npm list zod --all | grep zod@4
   # Should return empty (no v4 dependencies)
   ```

3. **Rebuild after dependency changes:**

   ```bash
   cd ui
   npm run build:cloudflare
   ```

4. **Clear caches if needed:**
   ```bash
   rm -rf node_modules/.cache
   npm cache clean --force
   ```

---

## 📝 What Each Test Validates

### Quick Test (`test:mcp-schemas`)

- ✅ Schemas are not empty (have > 1 key)
- ✅ Parameter counts are correct
- ✅ Visual confirmation of schema structure

### Unit Tests (`test:mcp-schemas:unit`)

- ✅ Regression prevention (empty schema detection)
- ✅ Schema structure validation
- ✅ Required parameter validation
- ✅ Tool existence verification
- ✅ Parameter type validation

### HTTP Endpoint Test

- ✅ End-to-end validation
- ✅ Production-like environment
- ✅ JSON-RPC protocol compliance
- ✅ Schema serialization correctness

---

## 🎉 Success Criteria

Your MCP server is working correctly when:

1. ✅ `npm run test:mcp-schemas` shows all tools passing
2. ✅ Each tool shows "Has X properties" (not "EMPTY SCHEMA")
3. ✅ Total parameters count is 45+
4. ✅ HTTP endpoint returns schemas with `properties` field
5. ✅ MCP clients (like Claude) can discover tool parameters without errors

---

## 📚 Additional Resources

- **Zod Documentation:** https://zod.dev/
- **MCP Protocol Spec:** https://modelcontextprotocol.io/
- **JSON Schema Spec:** https://json-schema.org/

---

**Last Updated:** 2026-02-03  
**Fix Version:** 7.3.0  
**Bug Reporter:** BT-Servant developer
