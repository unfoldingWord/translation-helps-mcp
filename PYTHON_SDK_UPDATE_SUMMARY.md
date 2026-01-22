# Python SDK Update Summary

## ✅ Changes Completed

### 1. Removed Deprecated Methods

#### `get_languages()` - REMOVED

- **Reason**: MCP server only has `list_languages`, not `get_languages`
- **Replacement**: Use `list_languages()` instead
- **Files Changed**:
  - `packages/python-sdk/translation_helps/client.py` - Method removed
  - `packages/python-sdk/translation_helps/types.py` - `GetLanguagesOptions` type removed
  - `packages/python-sdk/README.md` - Documentation removed

#### `get_system_prompt()` - REMOVED

- **Reason**: Tool exists in codebase but is not registered in MCP tools registry
- **Files Changed**:
  - `packages/python-sdk/translation_helps/client.py` - Method removed
  - `packages/python-sdk/README.md` - Documentation removed (if present)

### 2. Added Missing Parameters to `fetch_scripture()`

#### New Parameters Added:

- `resource: Optional[str]` - Scripture resource type
  - Options: `'ult'`, `'ust'`, `'t4t'`, `'ueb'`, `'all'`, or comma-separated (e.g., `'ult,ust'`)
  - Default: `None` (server uses `"all"` as default)
- `includeAlignment: Optional[bool]` - Include word alignment data
  - Only available with USFM format
  - Default: `None` (server uses `false` as default)

#### Files Changed:

- `packages/python-sdk/translation_helps/types.py` - Added parameters to `FetchScriptureOptions`
- `packages/python-sdk/translation_helps/client.py` - Updated `fetch_scripture()` to pass new parameters
- `packages/python-sdk/README.md` - Updated documentation with new parameters

### 3. Updated Documentation

- Removed `get_languages()` from API reference
- Updated `fetch_scripture()` examples to show new parameters
- All examples now reflect current MCP server capabilities

## 📋 Current Python SDK Methods (9 total)

All methods now match MCP server tools:

1. ✅ `fetch_scripture()` - **UPDATED** with `resource` and `includeAlignment`
2. ✅ `fetch_translation_notes()`
3. ✅ `fetch_translation_questions()`
4. ✅ `fetch_translation_word_links()`
5. ✅ `fetch_translation_word()`
6. ✅ `fetch_translation_academy()`
7. ✅ `list_languages()` - **FIXED** (replaces deprecated `get_languages`)
8. ✅ `list_subjects()`
9. ✅ `list_resources_for_language()`

## 🧪 Testing

A test script has been created at `packages/python-sdk/test_sdk_sync.py` to verify:

- All expected tools are available from MCP server
- Deprecated methods are removed
- New parameters work correctly
- All convenience methods exist and function

## 📝 Usage Examples

### Updated `fetch_scripture()` Usage

```python
# Basic usage (unchanged)
scripture = await client.fetch_scripture({
    "reference": "John 3:16"
})

# With resource parameter (NEW)
scripture = await client.fetch_scripture({
    "reference": "John 3:16",
    "resource": "ult"  # Get only ULT
})

# With multiple resources (NEW)
scripture = await client.fetch_scripture({
    "reference": "John 3:16",
    "resource": "ult,ust"  # Get both ULT and UST
})

# With alignment data (NEW - requires USFM format)
scripture = await client.fetch_scripture({
    "reference": "John 3:16",
    "format": "usfm",
    "includeAlignment": True  # Include word alignment data
})
```

### Using `list_languages()` (replaces `get_languages()`)

```python
# Old way (deprecated - no longer works)
# languages = await client.get_languages({"organization": "unfoldingWord"})

# New way (current)
languages = await client.list_languages({
    "organization": "unfoldingWord",
    "stage": "prod"
})
```

## ✅ Verification Checklist

- [x] Removed `get_languages()` method
- [x] Removed `get_system_prompt()` method
- [x] Added `resource` parameter to `fetch_scripture()`
- [x] Added `includeAlignment` parameter to `fetch_scripture()`
- [x] Updated type definitions
- [x] Updated documentation
- [x] Created test script
- [x] No linter errors

## 🚀 Next Steps

1. **Test the changes** by running `test_sdk_sync.py`:

   ```bash
   cd packages/python-sdk
   python test_sdk_sync.py
   ```

2. **Update package version** if releasing:

   ```bash
   # Update version in setup.py or pyproject.toml
   # Then build and publish
   python -m build
   python -m twine upload dist/*
   ```

3. **Update changelog** with these breaking changes:
   - Removed `get_languages()` (use `list_languages()` instead)
   - Removed `get_system_prompt()`
   - Added `resource` and `includeAlignment` to `fetch_scripture()`

## 📚 Related Files

- `packages/python-sdk/translation_helps/client.py` - Main client implementation
- `packages/python-sdk/translation_helps/types.py` - Type definitions
- `packages/python-sdk/README.md` - Documentation
- `packages/python-sdk/test_sdk_sync.py` - Test script
- `src/mcp/tools-registry.ts` - MCP server tools registry (source of truth)
