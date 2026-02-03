# MCP Schema Bug Fix - Summary & Test Results

## 🎯 Issue Reported

**From:** BT-Servant developer  
**Date:** 2026-02-03  
**Severity:** High - Breaking MCP tool discovery

### Problem

MCP `tools/list` endpoint returning empty input schemas:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

**Impact:**

- MCP clients (like Claude) can't discover tool parameters
- Causes retry loops and guessing on every tool call
- Increases latency and error rates
- Poor developer experience

---

## 🔍 Root Cause Analysis

### Zod Version Mismatch

| Package | File                 | Zod Version  | Status     |
| ------- | -------------------- | ------------ | ---------- |
| Root    | `package.json:71`    | ^3.22.4 (v3) | ✅ Correct |
| UI      | `ui/package.json:64` | ^4.0.10 (v4) | ❌ Wrong   |

### Technical Details

1. `src/mcp/tools-registry.ts` creates Zod v3 schemas
2. `ui/src/lib/mcp/tools-list.ts:11` imports them via `../../../../src/mcp/tools-registry.js`
3. `ui/src/lib/mcp/tools-list.ts:28` calls `zodToJsonSchema(tool.inputSchema)`
4. But `zod-to-json-schema` in UI was installed with Zod v4 as peer dependency
5. **Zod v4 changed internal structure:** `._def` → `._zod.def`
6. The converter can't find schema definitions → returns empty schema

---

## ✅ Fix Applied

### Changes Made

**File:** `ui/package.json`

**Before:**

```json
{
  "dependencies": {
    "zod": "^4.0.10",
    "zod-to-json-schema": "^3.25.1"
  }
}
```

**After:**

```json
{
  "dependencies": {
    "zod": "^3.22.4",
    "zod-to-json-schema": "^3.24.6"
  }
}
```

### Version Alignment

All packages now use Zod v3:

- ✅ Root: Zod ^3.22.4
- ✅ UI: Zod ^3.22.4
- ✅ JS SDK: Zod ^3.22.4

---

## 🧪 Test Results

### ✅ Quick TypeScript Test

**Command:** `npm run test:mcp-schemas`

**Result:** ✅ **PASSING**

```
✅ Found 9 tools

✅ fetch_scripture
   Has 7 properties
   Parameters: language, organization, includeVerseNumbers...

✅ fetch_translation_notes
   Has 6 properties
   Parameters: language, organization, includeIntro...

✅ fetch_translation_questions
   Has 4 properties
   Parameters: language, organization, format...

✅ fetch_translation_word_links
   Has 4 properties
   Parameters: language, organization, format...

✅ fetch_translation_word
   Has 7 properties
   Parameters: term, path, rcLink...

✅ fetch_translation_academy
   Has 6 properties
   Parameters: moduleId, path, rcLink...

✅ list_languages
   Has 2 properties
   Parameters: organization, stage

✅ list_subjects
   Has 3 properties
   Parameters: language, organization, stage

✅ list_resources_for_language
   Has 6 properties
   Parameters: language, organization, stage...

📊 Summary:
   Total tools: 9
   Total parameters across all tools: 45

✅ SUCCESS: All tools have complete schemas!
```

### Example Schema Output

**Before Fix:**

```json
{
  "name": "fetch_scripture",
  "description": "Fetch Bible scripture text for a specific reference",
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

**After Fix:**

```json
{
  "name": "fetch_scripture",
  "description": "Fetch Bible scripture text for a specific reference",
  "inputSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
      "language": {
        "type": "string",
        "default": "en",
        "description": "Language code (default: \"en\")"
      },
      "organization": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        ],
        "description": "Organization(s) to fetch from (default: \"unfoldingWord\")",
        "default": "unfoldingWord"
      },
      "reference": {
        "type": "string",
        "description": "Bible reference (e.g., \"John 3:16\", \"Genesis 1:1-3\", \"Matthew 5\")"
      },
      ... (4 more properties)
    },
    "required": ["reference"],
    "additionalProperties": false
  }
}
```

---

## 📊 Validation Summary

### Tools with Complete Schemas

| Tool Name                      | Parameters | Status |
| ------------------------------ | ---------- | ------ |
| `fetch_scripture`              | 7          | ✅     |
| `fetch_translation_notes`      | 6          | ✅     |
| `fetch_translation_questions`  | 4          | ✅     |
| `fetch_translation_word_links` | 4          | ✅     |
| `fetch_translation_word`       | 7          | ✅     |
| `fetch_translation_academy`    | 6          | ✅     |
| `list_languages`               | 2          | ✅     |
| `list_subjects`                | 3          | ✅     |
| `list_resources_for_language`  | 6          | ✅     |

**Total:** 9 tools, 45 parameters

---

## 🚀 Deployment Steps

### 1. Reinstall UI Dependencies

```bash
cd ui
rm -rf node_modules package-lock.json
npm install
```

### 2. Verify Zod Version

```bash
npm list zod
# Should show: zod@3.22.4 (not 4.x.x)
```

### 3. Rebuild UI

```bash
npm run build:cloudflare
```

### 4. Test Locally (Optional)

```bash
# In repo root:
npm run test:mcp-schemas

# Should output: ✅ SUCCESS: All tools have complete schemas!
```

### 5. Deploy to Cloudflare

```bash
npm run deploy
```

---

## 🎉 Expected Impact

After deployment:

- ✅ **MCP clients can discover all tool parameters**
- ✅ **No more guessing or retry loops**
- ✅ **Reduced latency on tool calls**
- ✅ **Better error messages** (parameter validation works)
- ✅ **Improved developer experience**

---

## 📝 Testing Tools Created

### 1. Quick Test Script

- **Location:** `scripts/test-mcp-schemas.mts`
- **Command:** `npm run test:mcp-schemas`
- **Purpose:** Fast validation (< 10 seconds)

### 2. Unit Test Suite

- **Location:** `tests/mcp-schema-validation.test.ts`
- **Command:** `npm run test:mcp-schemas:unit`
- **Purpose:** Comprehensive regression testing

### 3. Documentation

- **Location:** `TEST_MCP_SCHEMAS.md`
- **Purpose:** Complete testing guide with all methods

---

## ✅ Compatibility Verified

**Zod Usage in UI:** Only basic features used in `ui/src/lib/mcp/chat-server.ts`:

- ✅ `z.object()`, `z.string()`, `z.array()`, `z.enum()`
- ✅ `.optional()`, `.default()`, `.describe()`, `.parse()`
- ✅ `z.infer<>`, `z.ZodError`

**All features are 100% compatible between Zod v3 and v4.**

---

## 🐛 Regression Prevention

The unit test suite now includes specific tests to prevent this bug from returning:

```typescript
it("should NOT have any empty schemas (the bug we fixed)", () => {
  const tools = getMCPToolsList();

  const emptySchemas = tools.filter((tool) => {
    const keys = Object.keys(tool.inputSchema);
    return keys.length === 1 && keys[0] === "$schema";
  });

  expect(emptySchemas).toHaveLength(0);
});
```

---

## 📚 References

- **Issue Reporter:** BT-Servant developer
- **Zod v3 Docs:** https://zod.dev/?version=v3
- **Zod v4 Breaking Changes:** https://github.com/colinhacks/zod/releases/tag/v4.0.0
- **zod-to-json-schema:** https://github.com/StefanTerdell/zod-to-json-schema
- **MCP Protocol:** https://modelcontextprotocol.io/

---

**Status:** ✅ **FIXED & TESTED**  
**Version:** 7.3.0  
**Date:** 2026-02-03

## 🙏 Thank You

Big thanks to the BT-Servant developer for the detailed bug report with root cause analysis. This saved significant debugging time and helped us fix the issue quickly! 🎉
