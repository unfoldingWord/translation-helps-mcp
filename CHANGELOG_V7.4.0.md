# Changelog - v7.4.0

## Release Date: March 16, 2026

## Overview
This release improves the LLM's translation notes formatting and adds language variant fallback support to the `list_resources_for_language` tool, making resource discovery more robust.

---

## 🎯 Major Features

### 1. Enhanced Translation Notes Display Format
**Impact**: Improved user experience for translation notes in chat interface

The LLM now displays translation notes using the actual translated words from scripture instead of raw Greek/Hebrew text, making the notes more accessible and contextually relevant.

**Changes**:
- Updated system prompts to instruct LLM to quote scripture words instead of Greek/Hebrew
- Added step-by-step matching process: Greek Quote field → Find in scripture → Quote translated words
- Format: `**«scripture words»** - {Complete Note}` instead of `**«Greek text»** - {Note}`
- Prevents LLM from creating generic labels like "Términos de autoridad"
- Ensures all notes are shown individually (no combining or merging)

**Example**:
- Scripture: "Recuérdales que se sometan a los gobernantes y a las autoridades"
- Greek Quote: "ἀρχαῖς, ἐξουσίαις"
- ❌ Before: "**Términos de autoridad**: Estas palabras..." (generic label)
- ❌ Before: "**ἀρχαῖς, ἐξουσίαις**: Estas palabras..." (Greek text)
- ✅ Now: "**«los gobernantes y a las autoridades»** - Estas palabras..." (scripture words)

**Files Modified**:
- `packages/js-sdk/src/prompts.ts` - Core prompt and contextual rules
- `ui/src/routes/api/chat-stream/+server.ts` - System prompt and context builder
- Context builder now includes explicit formatting instructions with note counts

### 2. Language Variant Fallback for Resource Discovery
**Impact**: Better resource discovery and user experience for base language queries

The `list_resources_for_language` tool now automatically falls back to language variants when the base language has no resources.

**Changes**:
- Added automatic fallback: `es` → `es-419`, `pt` → `pt-br`, etc.
- Implemented two-tier caching strategy:
  - Cache language variant mappings (`es` → `es-419`)
  - Cache resource lists per actual language
- Improved cache key generation for consistent caching
- Added response fields: `actualLanguageUsed` and `note` to inform users of fallback
- Implemented negative caching (cache empty results to prevent repeated API calls)

**Example**:
```json
{
  "language": "es",
  "actualLanguageUsed": "es-419",
  "note": "No resources found for 'es'. Showing results for language variant 'es-419' instead.",
  "totalResources": 7,
  "subjects": ["Bible", "Translation Notes", ...]
}
```

**Files Modified**:
- `src/tools/listResourcesForLanguage.ts` - Added variant fallback logic
- `src/mcp/tools-registry.ts` - Updated tool description
- Switched from `getKVCache()` to `cache` for better caching performance

**Performance Impact**:
- First call with base language (e.g., `es`): ~6000ms (finds variant, caches mapping)
- Subsequent calls: Uses cached variant mapping immediately
- No performance degradation for direct language queries (e.g., `en`, `es-419`)

---

## 📦 SDK Updates

### JavaScript SDK (v1.4.0 → v1.4.1)
**Changes**:
- Updated system prompts for improved translation notes formatting
- No breaking changes to public API
- Improved LLM instruction clarity for note display

**Files Modified**:
- `packages/js-sdk/src/prompts.ts`
- `packages/js-sdk/package.json`

### Python SDK (v1.5.0)
**Changes**:
- No changes required for this release
- SDK methods remain compatible

---

## 🔧 Technical Improvements

### System Prompt Enhancements
1. **Prominent Format Instructions**: Added 🚨 emoji-tagged mandatory format section at top of prompt
2. **Step-by-Step Process**: Clear 3-step process for matching Greek to scripture
3. **Multiple Examples**: Wrong vs. correct formatting examples throughout prompt
4. **Count Verification**: Explicit instruction to count `verseNotes.length` and show all notes
5. **Tool Calling Updates**: Instructs LLM to call both `fetch_scripture` and `fetch_translation_notes` together

### Context Builder Updates
1. **Structured Format**: Reformatted note context with `Quote (Greek):` and `Note:` on separate lines
2. **Explicit Count**: Shows note count in context: "COUNT: 6 notes - you MUST show all 6 individually"
3. **Clear Instructions**: Added matching instructions directly in the context
4. **Example Included**: Provides format example in the context itself

### Caching Strategy
1. **Two-Tier Caching**: Variant mapping cache + resource list cache
2. **Consistent Cache Keys**: Fixed organization parameter handling in cache keys
3. **Negative Caching**: Cache empty results to prevent repeated API calls for non-existent languages
4. **Memory Cache**: Switched to `cache` module for better performance over `getKVCache()`

---

## 🐛 Bug Fixes

### Translation Notes Display
- **Fixed**: LLM creating generic labels instead of quoting scripture
- **Fixed**: LLM showing Greek text when scripture was available
- **Fixed**: LLM combining or merging similar notes
- **Fixed**: LLM showing incomplete note content

### Resource Discovery
- **Fixed**: `list_resources_for_language` not finding resources for base languages (e.g., `es`)
- **Fixed**: Poor cache performance due to incorrect cache key generation
- **Fixed**: No fallback when base language has no resources

---

## 📊 Comparison with main Branch

### Branch: `feature/unified-parameter-definitions`
This branch includes the unified parameter definitions architecture plus the improvements in this session.

**Major Changes from main**:
1. Unified parameter definitions and types
2. Shared prompts registry
3. Enhanced MCP tools and REST API consistency
4. Improved validation and error handling
5. **NEW**: Translation notes formatting improvements
6. **NEW**: Language variant fallback for list_resources_for_language

**Commits Added** (from main to current):
- 9 commits with unified architecture improvements
- Plus uncommitted changes from this session

---

## ✅ Testing

### Manual Tests Performed
1. ✅ Spanish base language (`es`) → Falls back to `es-419` (7 resources)
2. ✅ English direct (`en`) → Returns 9 resources directly
3. ✅ Language variant direct (`es-419`) → Returns 7 resources
4. ✅ Translation notes display using scripture words (tested with Titus 3:1)
5. ✅ All 6 notes shown for Titus 3:1 with complete content
6. ✅ Chat stream integration with Spanish queries

### Performance Verification
- Resource discovery with variant: ~6000ms (first call), cached thereafter
- Translation notes response: ~18000ms (comprehensive with scripture)
- Cache hit performance: < 200ms (when cache is warm)

---

## 📝 Breaking Changes
None. All changes are backward compatible.

---

## 🔮 Next Steps
1. Merge this branch into main
2. Deploy updated version to production
3. Publish SDK updates to npm/PyPI (JS SDK v1.4.1)
4. Update documentation website with new formatting examples

---

## 🙏 Credits
This release improves user experience based on real-world usage feedback from Spanish-speaking Bible translators working with Titus 3:1-16.
