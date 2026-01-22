# Python SDK Synchronization Fix

## Issues Found and Fixed

### ✅ 1. Removed Deprecated `get_languages()` Method

**Issue**: Python SDK had `get_languages()` method but MCP server only registers `list_languages` tool.

**Fix**: Removed `get_languages()` method and `GetLanguagesOptions` type from Python SDK.

**Files Changed**:

- `packages/python-sdk/translation_helps/client.py` - Removed method
- `packages/python-sdk/translation_helps/types.py` - Removed `GetLanguagesOptions` type

### ✅ 2. Removed `get_system_prompt()` Method

**Issue**: Python SDK had `get_system_prompt()` method but MCP server does not register `get_system_prompt` tool.

**Fix**: Removed `get_system_prompt()` method from Python SDK.

**Files Changed**:

- `packages/python-sdk/translation_helps/client.py` - Removed method

**Note**: The tool file exists (`src/tools/getSystemPrompt.ts`) but is not registered in the tools registry. If needed in the future, it should be added to `src/mcp/tools-registry.ts` and handled in `src/index.ts`.

### ✅ 3. Added Missing Parameters to `fetch_scripture`

**Issue**: MCP server supports `resource` and `includeAlignment` parameters, but Python SDK was missing them.

**Fix**:

- Added `resource` and `includeAlignment` to `FetchScriptureOptions` type
- Updated `fetch_scripture()` method to pass these parameters when provided

**Files Changed**:

- `packages/python-sdk/translation_helps/types.py` - Added parameters to `FetchScriptureOptions`
- `packages/python-sdk/translation_helps/client.py` - Updated `fetch_scripture()` method

**Parameter Details**:

- `resource`: Optional[str] - 'ult', 'ust', 't4t', 'ueb', 'all', or comma-separated (e.g., 'ult,ust')
- `includeAlignment`: Optional[bool] - Include word alignment data (only available with USFM format)

## Verification

### MCP Server Tools (9 total):

1. ✅ `fetch_scripture` - **FIXED** (added missing parameters)
2. ✅ `fetch_translation_notes`
3. ✅ `fetch_translation_questions`
4. ✅ `fetch_translation_word_links`
5. ✅ `fetch_translation_word`
6. ✅ `fetch_translation_academy`
7. ✅ `list_languages` - **FIXED** (removed deprecated `get_languages`)
8. ✅ `list_subjects`
9. ✅ `list_resources_for_language`

### Python SDK Methods (9 total, matching MCP server):

1. ✅ `fetch_scripture()` - **UPDATED**
2. ✅ `fetch_translation_notes()`
3. ✅ `fetch_translation_questions()`
4. ✅ `fetch_translation_word_links()`
5. ✅ `fetch_translation_word()`
6. ✅ `fetch_translation_academy()`
7. ✅ `list_languages()` - **FIXED**
8. ✅ `list_subjects()`
9. ✅ `list_resources_for_language()`

## Status

✅ **Python SDK is now synchronized with MCP server**

All methods in the Python SDK now correspond to tools available in the MCP server, and all parameters match the MCP server's parameter schemas.
