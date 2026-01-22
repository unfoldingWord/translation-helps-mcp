# TypeScript SDK Update Summary

## ✅ Changes Completed

### 1. Removed Deprecated Methods

#### `getLanguages()` - REMOVED

- **Reason**: MCP server only has `list_languages`, not `get_languages`
- **Replacement**: Use `listLanguages()` instead
- **Files Changed**:
  - `packages/js-sdk/src/client.ts` - Method removed
  - `packages/js-sdk/src/types.ts` - `GetLanguagesOptions` interface removed
  - `packages/js-sdk/README.md` - Documentation updated

#### `getSystemPrompt()` - REMOVED

- **Reason**: Tool exists in codebase but is not registered in MCP tools registry
- **Files Changed**:
  - `packages/js-sdk/src/client.ts` - Method removed
  - `packages/js-sdk/README.md` - Documentation removed (if present)

**Note**: The `getSystemPrompt` function in `packages/js-sdk/src/prompts.ts` is a different utility function for generating optimized system prompts - this is still available and documented.

### 2. Added Missing Parameters to `fetchScripture()`

#### New Parameters Added:

- `resource?: string` - Scripture resource type
  - Options: `'ult'`, `'ust'`, `'t4t'`, `'ueb'`, `'all'`, or comma-separated (e.g., `'ult,ust'`)
  - Optional parameter
- `includeAlignment?: boolean` - Include word alignment data
  - Only available with USFM format
  - Optional parameter

#### Files Changed:

- `packages/js-sdk/src/types.ts` - Added parameters to `FetchScriptureOptions` interface
- `packages/js-sdk/src/client.ts` - Updated `fetchScripture()` to pass new parameters
- `packages/js-sdk/README.md` - Updated documentation with new parameters

### 3. Updated Documentation

- Removed `getLanguages()` from API reference
- Added `listLanguages()`, `listSubjects()`, and `listResourcesForLanguage()` to API reference
- Updated `fetchScripture()` examples to show new parameters
- All examples now reflect current MCP server capabilities

## 📋 Current TypeScript SDK Methods (9 total)

All methods now match MCP server tools:

1. ✅ `fetchScripture()` - **UPDATED** with `resource` and `includeAlignment`
2. ✅ `fetchTranslationNotes()`
3. ✅ `fetchTranslationQuestions()`
4. ✅ `fetchTranslationWordLinks()`
5. ✅ `fetchTranslationWord()`
6. ✅ `fetchTranslationAcademy()`
7. ✅ `listLanguages()` - **FIXED** (replaces deprecated `getLanguages`)
8. ✅ `listSubjects()` - **ADDED** to documentation
9. ✅ `listResourcesForLanguage()` - **ADDED** to documentation

## 🧪 Verification

The comparison script confirms:

- ✅ 9 MCP Server Tools
- ✅ 9 TypeScript SDK Methods (matching)
- ✅ 0 Issues Found
- ✅ All parameters match

## 📝 Usage Examples

### Updated `fetchScripture()` Usage

```typescript
// Basic usage (unchanged)
const scripture = await client.fetchScripture({
  reference: "John 3:16",
});

// With resource parameter (NEW)
const scripture = await client.fetchScripture({
  reference: "John 3:16",
  resource: "ult", // Get only ULT
});

// With multiple resources (NEW)
const scripture = await client.fetchScripture({
  reference: "John 3:16",
  resource: "ult,ust", // Get both ULT and UST
});

// With alignment data (NEW - requires USFM format)
const scripture = await client.fetchScripture({
  reference: "John 3:16",
  format: "usfm",
  includeAlignment: true, // Include word alignment data
});
```

### Using `listLanguages()` (replaces `getLanguages()`)

```typescript
// Old way (deprecated - no longer works)
// const languages = await client.getLanguages({ organization: "unfoldingWord" });

// New way (current)
const languages = await client.listLanguages({
  organization: "unfoldingWord",
  stage: "prod",
});
```

## ✅ Verification Checklist

- [x] Removed `getLanguages()` method
- [x] Removed `getSystemPrompt()` method (client method, not prompts.ts utility)
- [x] Added `resource` parameter to `fetchScripture()`
- [x] Added `includeAlignment` parameter to `fetchScripture()`
- [x] Updated type definitions
- [x] Updated documentation
- [x] No linter errors
- [x] Comparison script passes

## 🚀 Next Steps

1. **Test the changes** by running the comparison script:

   ```bash
   node scripts/compare-js-sdk-mcp.js
   ```

2. **Update package version** if releasing:

   ```bash
   # Update version in package.json
   # Then build and publish
   npm run build
   npm publish
   ```

3. **Update changelog** with these breaking changes:
   - Removed `getLanguages()` (use `listLanguages()` instead)
   - Removed `getSystemPrompt()` client method
   - Added `resource` and `includeAlignment` to `fetchScripture()`

## 📚 Related Files

- `packages/js-sdk/src/client.ts` - Main client implementation
- `packages/js-sdk/src/types.ts` - Type definitions
- `packages/js-sdk/README.md` - Documentation
- `src/mcp/tools-registry.ts` - MCP server tools registry (source of truth)
