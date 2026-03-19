# Changelog - feature/unified-parameter-definitions → main

## Branch Overview

This feature branch (`feature/unified-parameter-definitions`) contains **11 commits** with major improvements to architecture, parameter handling, translation notes display, and resource discovery.

## Version Updates

- **Main Package**: 7.3.0 → **7.4.0**
- **JS SDK**: 1.4.0 → **1.4.1**
- **Python SDK**: 1.5.0 (no changes)

---

## 📋 Commit Summary (11 commits)

1. **71ed1cc** - feat: Improve translation notes display and resource discovery (v7.4.0)
2. **afe4801** - docs: Add comprehensive REST API vs MCP comparison report
3. **2b7a0ed** - refactor(prompts): Create shared prompts registry for MCP server
4. **308b1e8** - fix(zip-fetcher): Fix auto-detection for Vite SSR environment
5. **3bcef13** - fix(unified-services): Remove erroneous error checks in Notes and Questions
6. **f08adfa** - docs(validation): Add comprehensive DCS API validation report
7. **9f0c84f** - docs: add comprehensive unified architecture completion summary
8. **a443323** - feat: complete unified service layer for all tools
9. **834481d** - feat: update REST endpoint configs to use unified parameters
10. **63f68dd** - feat: implement unified architecture - single source of truth
11. **99e053d** - feat: implement multi-organization fetching and parameter consistency

---

## 🎯 Major Features

### 1. Translation Notes Display Enhancement (Commit 71ed1cc)

**Impact**: Dramatically improved user experience for translation notes in chat interface

**Changes**:

- LLM now quotes actual translated scripture words instead of raw Greek/Hebrew
- Format changed from generic labels to `**«scripture words»** - {Complete Note}`
- Added mandatory formatting section in system prompts with step-by-step instructions
- Updated context builder to include explicit note counts and formatting examples
- Ensures all notes shown individually without combining or merging

**Example Improvement**:

```
❌ Before: "**Términos de autoridad**: Estas palabras..."
❌ Before: "**ἀρχαῖς, ἐξουσίαις**: Estas palabras..."
✅ Now: "**«los gobernantes y a las autoridades»** - Estas palabras..."
```

**Files Modified**:

- `packages/js-sdk/src/prompts.ts`
- `ui/src/routes/api/chat-stream/+server.ts`

### 2. Language Variant Fallback for Resource Discovery (Commit 71ed1cc)

**Impact**: Significantly improved resource discovery for base language queries

**Changes**:

- Added automatic language variant fallback (e.g., `es` → `es-419`, `pt` → `pt-br`)
- Implemented two-tier caching strategy:
  - Cache language variant mappings for fast resolution
  - Cache resource lists per actual language used
- Negative caching to prevent repeated API calls for non-existent languages
- Returns `actualLanguageUsed` and explanatory `note` in responses
- Fixed cache key generation for consistent caching

**Performance**:

- First call with base language: ~6000ms (discovers variant, caches mapping)
- Subsequent calls: Use cached variant mapping immediately
- No performance degradation for direct language queries

**Files Modified**:

- `src/tools/listResourcesForLanguage.ts`
- `src/mcp/tools-registry.ts`

### 3. Unified Architecture - Single Source of Truth (Commits 63f68dd, 834481d, a443323)

**Impact**: Eliminated parameter inconsistencies across MCP tools and REST endpoints

**Changes**:

- Created `src/config/parameters/` directory structure:
  - `common.ts` - Common parameter definitions
  - `groups.ts` - Parameter groupings
  - `types.ts` - TypeScript types
  - `index.ts` - Exports
- Updated all REST endpoint configurations to use unified parameters
- Completed unified service layer for all tools
- Removed duplicate parameter definitions across the codebase

**Benefits**:

- Single source of truth for all parameter definitions
- Consistent validation across MCP and REST APIs
- Easier maintenance and updates
- Type safety improvements

**Files Created**:

- `src/config/parameters/common.ts`
- `src/config/parameters/groups.ts`
- `src/config/parameters/types.ts`
- `src/config/parameters/index.ts`
- `src/unified-services/BaseService.ts`
- `src/unified-services/ScriptureService.ts`
- `src/unified-services/TranslationAcademyService.ts`
- `src/unified-services/TranslationNotesService.ts`
- `src/unified-services/TranslationQuestionsService.ts`
- `src/unified-services/TranslationWordLinksService.ts`
- `src/unified-services/TranslationWordService.ts`
- `src/unified-services/index.ts`
- `src/unified-services/types.ts`

**Files Modified**:

- `src/config/endpoints/DiscoveryEndpoints.ts`
- `src/config/endpoints/ScriptureEndpoints.ts`
- `src/config/endpoints/TranslationHelpsEndpoints.ts`
- All tool handlers in `src/tools/`

### 4. Multi-Organization Fetching (Commit 99e053d)

**Impact**: Added support for fetching resources from multiple organizations

**Changes**:

- Updated parameter validation to accept arrays of organizations
- Modified resource fetching logic to handle multiple organizations
- Enhanced caching to account for multi-organization queries
- Improved error handling for organization-specific issues

**Files Modified**:

- `src/functions/resources-service.ts`
- `src/functions/scripture-service.ts`
- `src/functions/translation-notes-service.ts`
- `src/functions/translation-questions-service.ts`

### 5. Shared Prompts Registry (Commit 2b7a0ed)

**Impact**: Centralized prompt management for consistency

**Changes**:

- Created `src/mcp/prompts-registry.ts` for centralized prompt definitions
- Eliminated duplicate prompt definitions across tools
- Easier maintenance and updates for prompts
- Consistent prompt behavior across all tools

**Files Created**:

- `src/mcp/prompts-registry.ts`

---

## 🐛 Bug Fixes

### 1. Zip Fetcher Auto-Detection (Commit 308b1e8)

**Issue**: Zip fetcher not correctly detecting Vite SSR environment
**Fix**: Updated environment detection logic in `ZipResourceFetcher2.ts` and `zip-fetcher-provider.ts`
**Files Modified**:

- `src/services/ZipResourceFetcher2.ts`
- `src/services/zip-fetcher-provider.ts`

### 2. Unified Services Error Handling (Commit 3bcef13)

**Issue**: Erroneous error checks causing false positives in Notes and Questions services
**Fix**: Removed incorrect error validation logic
**Files Modified**:

- `src/unified-services/TranslationNotesService.ts`
- `src/unified-services/TranslationQuestionsService.ts`

### 3. Cache Performance Issues

**Issue**: Poor cache performance due to inconsistent cache keys and lack of negative caching
**Fix**:

- Standardized cache key generation
- Added negative caching for non-existent resources
- Switched to more reliable cache implementation (`cache` vs `getKVCache`)
  **Files Modified**:
- `src/tools/listResourcesForLanguage.ts`
- `src/functions/kv-cache.ts`

---

## 📚 Documentation Updates

### 1. REST API vs MCP Comparison Report (Commit afe4801)

**Added**: `REST_API_MCP_COMPARISON_REPORT.md`

- Comprehensive comparison of REST API and MCP endpoints
- Parameter consistency analysis
- Response format documentation

### 2. DCS API Validation Report (Commit f08adfa)

**Added**: Comprehensive validation report for Door43 Content Service API

- API endpoint verification
- Response format validation
- Performance benchmarks

### 3. Unified Architecture Documentation (Commit 9f0c84f)

**Added**: `UNIFIED_ARCHITECTURE_COMPLETE.md`

- Complete architectural overview
- Parameter flow diagrams
- Implementation guides

### 4. Version 7.4.0 Changelog (Commit 71ed1cc)

**Added**: `CHANGELOG_V7.4.0.md`

- Detailed release notes for v7.4.0
- Feature descriptions with examples
- Testing verification results

---

## 🔧 Technical Improvements

### Architecture

1. **Single Source of Truth**: Unified parameter definitions eliminate inconsistencies
2. **Service Layer**: Complete unified service layer for all tools
3. **Type Safety**: Enhanced TypeScript types across the codebase
4. **Modular Design**: Better separation of concerns with config directory structure

### Performance

1. **Two-Tier Caching**: Language variant mapping cache + resource list cache
2. **Negative Caching**: Prevents repeated API calls for non-existent data
3. **Cache Key Consistency**: Standardized cache key generation
4. **Memory Cache**: Switched to more reliable cache implementation

### Developer Experience

1. **Centralized Prompts**: Easier to maintain and update prompts
2. **Consistent Parameters**: Single source for all parameter definitions
3. **Comprehensive Docs**: Detailed documentation for all major features
4. **Type Safety**: Better TypeScript support throughout

---

## 📊 Files Changed Summary

### Created Files (15)

- `CHANGELOG_V7.4.0.md`
- `UNIFIED_ARCHITECTURE_COMPLETE.md`
- `REST_API_MCP_COMPARISON_REPORT.md`
- `src/config/parameters/common.ts`
- `src/config/parameters/groups.ts`
- `src/config/parameters/types.ts`
- `src/config/parameters/index.ts`
- `src/mcp/prompts-registry.ts`
- `src/unified-services/*.ts` (7 files)

### Modified Files (Core - 25+)

- `package.json`
- `packages/js-sdk/package.json`
- `packages/js-sdk/src/prompts.ts`
- `packages/js-sdk/src/client.ts`
- `packages/python-sdk/translation_helps/client.py`
- `src/config/endpoints/*.ts` (3 files)
- `src/functions/*.ts` (9+ files)
- `src/tools/*.ts` (8+ files)
- `ui/src/routes/api/chat-stream/+server.ts`
- `ui/src/routes/api/*.ts` (multiple endpoints)

---

## ✅ Testing & Validation

### Manual Tests Performed

1. ✅ Translation notes display with Titus 3:1 (all 6 notes, scripture words)
2. ✅ Spanish base language (`es`) → Falls back to `es-419` (7 resources)
3. ✅ English direct (`en`) → Returns 9 resources directly
4. ✅ Language variant direct (`es-419`) → Returns 7 resources
5. ✅ Multi-organization fetching with array parameters
6. ✅ Unified parameter definitions across MCP and REST
7. ✅ Cache performance with language variants

### Performance Benchmarks

- Resource discovery with variant fallback: ~6000ms (first), cached thereafter
- Translation notes comprehensive response: ~18000ms
- Cache hit performance: < 200ms (warm cache)
- No performance degradation for direct language queries

---

## 🚀 Deployment Notes

### Pre-Deployment Checklist

1. ✅ All tests passing
2. ✅ Version numbers updated (7.4.0, SDK 1.4.1)
3. ✅ Changelog created and verified
4. ✅ No breaking changes
5. ✅ Documentation updated

### Post-Deployment Tasks

1. Merge feature branch into main
2. Deploy to production (Cloudflare Workers)
3. Publish JS SDK v1.4.1 to npm
4. Update documentation website
5. Notify stakeholders of improvements

### Rollback Plan

If issues are detected post-deployment:

1. Revert to previous version (7.3.0)
2. Unpublish SDK v1.4.1 if necessary
3. Investigate and fix issues
4. Re-deploy with fixes

---

## 🔮 Future Improvements

Based on this release, potential future enhancements include:

1. **SDK Parity**: Ensure Python SDK has same prompt improvements as JS SDK
2. **Additional Language Variants**: Support for more language variants beyond es-419, pt-br
3. **Cache TTL Tuning**: Optimize cache expiration times based on usage patterns
4. **Prompt Optimization**: Further refine LLM prompts based on user feedback
5. **Performance Monitoring**: Add telemetry for cache hit rates and performance metrics

---

## 📞 Contact & Support

For questions or issues related to this release:

- GitHub Issues: https://github.com/unfoldingWord/translation-helps-mcp/issues
- Documentation: https://tc-helps.mcp.servant.bible

---

## ✨ Credits

This release represents significant improvements to the Translation Helps MCP Server, with contributions spanning architecture, performance, user experience, and documentation. Special thanks to the Spanish-speaking Bible translators whose feedback on Titus 3:1 directly influenced the translation notes display improvements.

---

**Release Date**: March 16, 2026
**Branch**: `feature/unified-parameter-definitions`
**Target**: `main`
**Commits**: 11
**Version**: 7.3.0 → 7.4.0
