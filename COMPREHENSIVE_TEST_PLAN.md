# Comprehensive Test Plan for Translation Helps MCP

## Overview

This document outlines a comprehensive testing strategy to ensure:
1. **MCP tools work properly** - All tools execute and return expected data
2. **Prompts work properly** - All prompts execute and return formatted responses
3. **REST endpoints work properly** - All API endpoints respond correctly
4. **Endpoint parity** - MCP tools and REST endpoints are in sync

## Current Inventory

### MCP Tools (11 total)
From `src/config/tools-registry.ts`:

1. `fetch_scripture` → `/api/fetch-scripture`
2. `fetch_translation_notes` → `/api/fetch-translation-notes`
3. `fetch_translation_questions` → `/api/fetch-translation-questions`
4. `fetch_translation_word_links` → `/api/fetch-translation-word-links`
5. `fetch_translation_word` → `/api/fetch-translation-word`
6. `fetch_translation_academy` → `/api/fetch-translation-academy`
7. `test_mockup_tool` → `/api/test-mockup-tool`
8. `list_tools` → `/api/list-tools`
9. `list_languages` → `/api/list-languages`
10. `list_subjects` → `/api/list-subjects`
11. `list_resources_for_language` → `/api/list-resources-for-language`

### REST Endpoints (14 total)
From `ui/src/routes/api/`:

**Core Translation Helps Endpoints:**
1. `/api/fetch-scripture`
2. `/api/fetch-translation-notes`
3. `/api/fetch-translation-questions`
4. `/api/fetch-translation-word-links`
5. `/api/fetch-translation-word`
6. `/api/fetch-translation-academy`
7. `/api/list-tools`
8. `/api/list-languages`
9. `/api/list-subjects`
10. `/api/list-resources-for-language`
11. `/api/list-resources-by-language` ⚠️ **NOT in MCP tools**

**Utility Endpoints:**
12. `/api/health`
13. `/api/health-dcs`
14. `/api/cache-stats`
15. `/api/kv-status`
16. `/api/deployment`
17. `/api/mcp` (MCP dispatcher)
18. `/api/mcp-config` (MCP configuration)
19. `/api/chat-stream` (Chat interface)
20. `/api/execute-prompt` (Prompt execution)
21. `/api/tools-metadata` (Tool documentation)
22. `/api/discover-language-orgs` (Language discovery)

### Prompts (6 total)
From `packages/js-sdk/src/prompts.ts`:

1. `translation-helps-report` - Condensed report
2. `translation-helps-for-passage` - Comprehensive report
3. `get-translation-words-for-passage` - Translation words for passage
4. `get-translation-academy-for-passage` - Translation academy for passage
5. `discover-resources-for-language` - Resource discovery
6. `discover-languages-for-subject` - Language discovery

## Discovered Issues

### 1. Endpoint Parity Gap
- `list-resources-by-language` REST endpoint exists but has NO corresponding MCP tool
- This endpoint is likely deprecated or superseded by `list-resources-for-language`
- **Action Required**: Verify if this endpoint is needed or should be removed

### 2. Missing Documentation
- Utility endpoints (health, cache-stats, etc.) are not documented in MCP metadata
- **Action Required**: Determine if these should be exposed via MCP or kept as internal REST-only endpoints

## Test Categories

### 1. Endpoint Parity Tests ✅ **CRITICAL**

**Purpose**: Ensure every MCP tool has a corresponding REST endpoint and vice versa.

**Test Cases**:
- [ ] Verify every MCP tool in `TOOLS_REGISTRY` has a matching REST endpoint
- [ ] Verify every core REST endpoint has a matching MCP tool
- [ ] Test that both MCP and REST use the same parameter names
- [ ] Test that both MCP and REST accept the same parameter values
- [ ] Verify endpoint naming conventions are consistent (underscores vs hyphens)

**Expected Result**: 100% parity between MCP tools and REST endpoints for core translation helps features.

**Files to Create**:
- `tests/endpoint-parity.test.ts`

---

### 2. Response Format Equivalence Tests ✅ **CRITICAL**

**Purpose**: Ensure MCP and REST return structurally equivalent data.

**Test Cases**:
- [ ] Call both MCP tool and REST endpoint with identical parameters
- [ ] Verify both return the same data structure
- [ ] Verify both return the same content (accounting for text formatting in MCP)
- [ ] Test with various parameter combinations (language, organization, format, etc.)
- [ ] Test error responses are consistent

**Test Matrix**:

| Tool | Parameters | Expected Fields |
|------|------------|----------------|
| `fetch_scripture` | `reference=John 3:16` | `text`, `reference`, `language`, `version` |
| `fetch_translation_notes` | `reference=John 3:16` | `notes[]`, `reference`, `language` |
| `fetch_translation_questions` | `reference=John 3:16` | `questions[]`, `reference`, `language` |
| `fetch_translation_word` | `term=faith, path=kt/faith` | `term`, `content`, `language` |
| `fetch_translation_academy` | `path=figs-metaphor` | `title`, `content`, `language` |
| `list_languages` | (none) | `languages[]` |
| `list_subjects` | (none) | `subjects[]` |
| `list_resources_for_language` | `language=es-419` | `resources{}` |

**Files to Create**:
- `tests/response-equivalence.test.ts`

---

### 3. Prompt Tests ✅ **HIGH PRIORITY**

**Purpose**: Verify all prompts execute successfully and return properly formatted responses.

**Test Cases**:
- [ ] Test `translation-helps-report` with sample passage
- [ ] Test `translation-helps-for-passage` with sample passage
- [ ] Test `get-translation-words-for-passage` with sample passage
- [ ] Test `get-translation-academy-for-passage` with sample passage
- [ ] Test `discover-resources-for-language` with sample language
- [ ] Test `discover-languages-for-subject` with sample subject
- [ ] Verify prompt responses include all required tools' data
- [ ] Verify prompt response formatting is consistent
- [ ] Test prompt argument validation

**Test Matrix**:

| Prompt | Arguments | Expected Response Structure | Expected Tools Called |
|--------|-----------|---------------------------|----------------------|
| `translation-helps-report` | `reference=John 3:16, language=en` | Condensed report with titles/summaries | `fetch_scripture`, `fetch_translation_notes`, `fetch_translation_words_for_passage` |
| `translation-helps-for-passage` | `reference=John 3:16, language=en` | Comprehensive report with full content | All translation helps tools |
| `get-translation-words-for-passage` | `reference=John 3:16, language=en` | Translation words with definitions | `fetch_translation_word_links`, `fetch_translation_word` |
| `get-translation-academy-for-passage` | `reference=John 3:16, language=en` | Translation academy articles | `fetch_translation_academy` |
| `discover-resources-for-language` | `language=es-419` | Resource list with metadata | `list_resources_for_language` |
| `discover-languages-for-subject` | `subject=bible` | Language list with metadata | `list_languages`, `list_subjects` |

**Files to Create**:
- `tests/prompts.test.ts`

---

### 4. Schema Validation Tests ✅ **HIGH PRIORITY**

**Purpose**: Ensure tool schemas accurately reflect actual parameter requirements.

**Test Cases**:
- [ ] Verify required parameters are enforced
- [ ] Verify optional parameters work with defaults
- [ ] Verify invalid parameters are rejected
- [ ] Verify parameter types are validated (string, number, boolean)
- [ ] Verify enum parameters only accept valid values
- [ ] Test parameter transformations (e.g., `reference` parsing)

**Files to Create**:
- `tests/schema-validation.test.ts`

---

### 5. Error Handling Tests ✅ **MEDIUM PRIORITY**

**Purpose**: Ensure errors are consistent and helpful across MCP and REST.

**Test Cases**:
- [ ] Test missing required parameters → 400 error
- [ ] Test invalid parameter values → 400 error
- [ ] Test resource not found → 404 error
- [ ] Test language variant fallback → successful retry with suggested language
- [ ] Test organization parameter handling → respects explicit values, searches all when omitted
- [ ] Verify error messages are clear and actionable
- [ ] Verify error responses are consistent between MCP and REST

**Test Matrix**:

| Scenario | Parameters | Expected Error | Expected Message |
|----------|------------|---------------|------------------|
| Missing required param | `fetch_scripture` without `reference` | 400 | "Missing required parameter: reference" |
| Invalid reference format | `reference=InvalidReference` | 400 | "Invalid reference format" |
| Resource not found | `language=zz-ZZ, reference=John 3:16` | 404 | "Resource not found for language 'zz-ZZ'" |
| Invalid enum value | `format=invalid` | 400 | "Invalid format. Must be one of: json, md, markdown" |
| Organization mismatch | `language=es-419, organization=unfoldingWord` | 404 | "Resource not found for organization 'unfoldingWord'" (with auto-retry suggestion) |

**Files to Create**:
- `tests/error-handling.test.ts`

---

### 6. Integration Tests ✅ **MEDIUM PRIORITY**

**Purpose**: Test realistic end-to-end workflows.

**Test Cases**:
- [ ] **Discovery → Fetch workflow**: List languages → List resources → Fetch scripture
- [ ] **Translation workflow**: Fetch scripture → Fetch notes → Fetch words → Fetch academy
- [ ] **Prompt workflow**: Execute prompt → Verify all expected tools called → Verify response format
- [ ] **Language variant workflow**: Request es-419 → Auto-retry with variant → Success
- [ ] **Organization filtering workflow**: Request with organization → Verify only matching results
- [ ] **Multi-resource workflow**: Fetch multiple resources in parallel → Verify all succeed

**Files to Create**:
- `tests/integration.test.ts`

---

### 7. Performance Tests ✅ **LOW PRIORITY**

**Purpose**: Ensure response times are acceptable.

**Test Cases**:
- [ ] Test single resource fetch < 500ms (cached)
- [ ] Test single resource fetch < 2000ms (uncached)
- [ ] Test prompt execution < 3000ms
- [ ] Test list operations < 1000ms
- [ ] Test parallel fetches complete successfully
- [ ] Monitor cache hit rates

**Files to Create**:
- `tests/performance.test.ts`

---

### 8. Cache Tests ✅ **MEDIUM PRIORITY**

**Purpose**: Verify caching works correctly and doesn't cause conflicts.

**Test Cases**:
- [ ] Test same request twice → second request uses cache
- [ ] Test different `organization` values → separate cache entries
- [ ] Test different `language` values → separate cache entries
- [ ] Test different `format` values → separate cache entries
- [ ] Test cache invalidation on errors
- [ ] Test cache TTL expiration
- [ ] Test variant mapping cache

**Key Scenarios**:
```typescript
// Scenario 1: Cache isolation by organization
await fetch('/api/fetch-translation-academy?path=figs-metaphor&language=es-419'); // No org - searches all
await fetch('/api/fetch-translation-academy?path=figs-metaphor&language=es-419&organization=unfoldingWord'); // Specific org
// → Should return different results (not from same cache entry)

// Scenario 2: Cache isolation by language variant
await fetch('/api/fetch-scripture?reference=John 3:16&language=es'); // Auto-detects es-419
await fetch('/api/fetch-scripture?reference=John 3:16&language=es-419'); // Explicit variant
// → Should both succeed but be separate cache entries

// Scenario 3: Cache isolation by format
await fetch('/api/fetch-translation-word?path=kt/faith&format=json');
await fetch('/api/fetch-translation-word?path=kt/faith&format=md');
// → Should return different formats from separate cache entries
```

**Files to Create**:
- `tests/cache-isolation.test.ts`

---

### 9. Language Variant Tests ✅ **HIGH PRIORITY**

**Purpose**: Test auto-discovery and retry logic for language variants.

**Test Cases**:
- [ ] Test base language (e.g., `es`) → discovers variant (e.g., `es-419`)
- [ ] Test explicit variant → no discovery needed
- [ ] Test invalid language → proper error (no infinite retry)
- [ ] Test multiple variants available → returns best match
- [ ] Test variant discovery respects `organization` parameter
- [ ] Test variant mapping cache works correctly

**Scenario Matrix**:

| Input Language | Organization | Expected Result | Expected Language |
|----------------|--------------|-----------------|-------------------|
| `es` | (omitted) | Success | `es-419` (auto-discovered) |
| `es-419` | (omitted) | Success | `es-419` |
| `es` | `unfoldingWord` | 404 or auto-retry | Depends on availability |
| `es-419` | `unfoldingWord` | 404 | N/A (no resources for unfoldingWord es-419) |
| `zz-ZZ` | (omitted) | 404 | N/A (invalid language) |

**Files to Create**:
- `tests/language-variants.test.ts`

---

### 10. DCS Source of Truth Verification Tests ✅ **CRITICAL**

**Purpose**: Verify our API responses match the actual data available in the Door43 Content Service (DCS) catalog - the authoritative source of truth.

**Test Cases**:
- [ ] Test language list matches DCS catalog exactly
- [ ] Test language variant discovery only finds variants that exist in DCS
- [ ] Test scripture exists in our API if and only if it exists in DCS
- [ ] Test Translation Academy exists in our API if and only if it exists in DCS
- [ ] Test Translation Words exist in our API if and only if they exist in DCS
- [ ] Test metadata (language, organization) matches DCS exactly
- [ ] Test organization parameter filtering matches DCS behavior
- [ ] Test "search all" (empty org) behavior matches DCS
- [ ] Test we don't hallucinate resources (return data DCS doesn't have)
- [ ] Test we don't miss resources (fail to find data DCS does have)

**Verification Approach**:
1. Call DCS API directly with same parameters
2. Call our API with same parameters
3. Compare responses for:
   - Resource existence (200 vs 404)
   - Metadata accuracy (language, organization)
   - Variant discovery validity

**DCS API Endpoints Used**:
```bash
# Catalog search
GET https://git.door43.org/api/v1/catalog/search
  ?lang={language}
  &owner={organization}
  &subject={resource_type}
  &stage=prod

# Languages list
GET https://git.door43.org/catalog/list/languages
  ?stage=prod
```

**Scenario Matrix**:

| Test Scenario | DCS Result | Our API Expected | Pass Condition |
|---------------|------------|------------------|----------------|
| en scripture @ unfoldingWord | Exists | 200 with data | ✅ Found |
| xyz scripture @ unfoldingWord | Not exists | 404 | ✅ Correctly rejected |
| es → es-419 discovery | es-419 exists | 200 with es-419 | ✅ Valid variant |
| Metadata check | DCS: en/unfoldingWord | Response: en/unfoldingWord | ✅ Matches |
| Empty org | DCS: Returns any org | Response: Returns same org | ✅ Behavior matches |

**Files Created**:
- ✅ `tests/helpers/dcs-client.ts` - DCS API client utilities
- ✅ `tests/dcs-source-verification.test.ts` - Comprehensive DCS validation tests
- ✅ `DCS_VERIFICATION_TESTS.md` - Complete documentation
- ✅ `DCS_VERIFICATION_TEST_REPORT.md` - Implementation report

**Integration with Other Tests**:
- **Endpoint Parity**: Tests API structure ✓
- **Response Equivalence**: Tests interface consistency ✓
- **DCS Verification**: Tests data accuracy against source of truth ✨

---

## Test Implementation Strategy

### Phase 1: Critical Tests (Week 1)
1. ✅ **Endpoint Parity Tests** - Ensure MCP and REST are synchronized
2. ✅ **Response Equivalence Tests** - Verify data consistency
3. ✅ **Prompt Tests** - Validate all prompts work

### Phase 2: Validation Tests (Week 2)
4. ✅ **Schema Validation Tests** - Ensure parameters are validated correctly
5. ✅ **Language Variant Tests** - Verify auto-discovery works
6. ✅ **Cache Tests** - Ensure cache isolation

### Phase 3: Quality Tests (Week 3)
7. ✅ **Error Handling Tests** - Verify error consistency
8. ✅ **Integration Tests** - Test realistic workflows
9. ✅ **Performance Tests** - Ensure acceptable response times

---

## Test Infrastructure

### Required Files

```
tests/
├── endpoint-parity.test.ts          # Verify MCP/REST sync
├── response-equivalence.test.ts     # Verify data consistency
├── prompts.test.ts                  # Test all prompts
├── schema-validation.test.ts        # Parameter validation
├── error-handling.test.ts           # Error consistency
├── integration.test.ts              # E2E workflows
├── performance.test.ts              # Response time benchmarks
├── cache-isolation.test.ts          # Cache correctness
├── language-variants.test.ts        # Variant discovery
├── dcs-source-verification.test.ts  # DCS source of truth validation
├── helpers/
│   ├── test-client.ts               # Reusable MCP/REST client
│   ├── test-data.ts                 # Sample test data
│   ├── dcs-client.ts                # DCS API client (source of truth)
│   └── assertions.ts                # Custom assertions
└── run-all-tests.sh                 # Test runner script
```

### Test Configuration

**vitest.config.ts**:
```typescript
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000, // 30s for network calls
    hookTimeout: 10000,
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'ui/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**']
    }
  }
});
```

### Environment Setup

**Required Environment Variables**:
```bash
# Server URL for testing
TEST_SERVER_URL=http://localhost:8174

# Enable verbose logging
DEBUG=translation-helps:*

# Test data
TEST_LANGUAGE=en
TEST_REFERENCE=John 3:16
```

---

## Success Criteria

### Must Pass (100%)
- ✅ All endpoint parity tests
- ✅ All response equivalence tests
- ✅ All prompt tests
- ✅ All schema validation tests
- ✅ All cache isolation tests

### Should Pass (>95%)
- ✅ Error handling tests
- ✅ Language variant tests
- ✅ Integration tests

### Nice to Pass (>80%)
- ✅ Performance tests (may vary by network/system)

---

## Continuous Integration

### GitHub Actions Workflow

```yaml
name: Comprehensive Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm run dev &  # Start server
      - run: sleep 10       # Wait for server
      - run: npm run test:all
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
```

---

## Maintenance

### When to Update Tests

1. **New tool added** → Add to endpoint parity, response equivalence, and integration tests
2. **Parameter added/changed** → Update schema validation tests
3. **Error handling changed** → Update error handling tests
4. **Prompt added** → Add to prompt tests
5. **Cache logic changed** → Update cache isolation tests
6. **Language variant logic changed** → Update language variant tests

### Test Review Schedule

- **Weekly**: Review failed tests, fix flaky tests
- **Monthly**: Review test coverage, identify gaps
- **Quarterly**: Refactor tests for maintainability

---

## Appendix: Quick Reference

### Run All Tests
```bash
npm run test:all
```

### Run Specific Test Suite
```bash
npm run test:parity        # Endpoint parity tests
npm run test:equivalence   # Response equivalence tests
npm run test:prompts       # Prompt execution tests
npm run test:validation    # Parameter validation tests
npm run test:schema        # Schema validation tests
npm run test:errors        # Error handling tests
npm run test:integration   # Integration workflow tests
npm run test:performance   # Performance benchmark tests
npm run test:cache         # Cache isolation tests
npm run test:variants      # Language variant tests
npm run test:dcs           # DCS source verification tests (NEW)
```

### Test Individual Endpoint (Manual)
```bash
# REST API
curl "http://localhost:8174/api/fetch-scripture?reference=John 3:16"

# MCP Tool
curl -X POST "http://localhost:8174/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "fetch_scripture",
      "arguments": {"reference": "John 3:16"}
    }
  }'

# Prompt
curl -X POST "http://localhost:8174/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "prompts/get",
    "params": {
      "name": "translation-helps-report",
      "arguments": {"reference": "John 3:16", "language": "en"}
    }
  }'
```

---

## Manual Tests Execution Summary

### Status: ✅ COMPLETE

**Date Executed**: 2026-03-17  
**Total Suites Created**: 9  
**Total Tests Executed**: 75  
**Pass Rate**: 84% (63/75 tests passing)  

### Results Overview

| Suite | Tests | Status | Pass Rate |
|-------|-------|--------|-----------|
| DCS Source Verification | 3 | ✅ PASS | 100% |
| Endpoint Parity | 5 | ❌ FAIL | 60% |
| Response Equivalence | 7 | ❌ FAIL | 57% |
| Prompts Execution | 9 | ❌ FAIL | 89% |
| Schema Validation | 12 | ❌ FAIL | 92% |
| Error Handling | 11 | ❌ FAIL | 82% |
| Integration Workflows | 8 | ❌ FAIL | 63% |
| Performance Benchmarks | 10 | ✅ PASS | 100% |
| Cache Isolation | 10 | ✅ PASS | 100% |

### Key Findings

**✅ Production Ready**:
- Performance: All operations under target thresholds
- Cache: Perfect isolation (10/10 tests pass)
- DCS Accuracy: 100% match with source of truth

**❌ Issues Found**: 13 issues across 6 test suites
- 5 HIGH priority
- 7 MEDIUM priority
- 1 LOW priority

### Run Manual Tests

```bash
# Run all manual tests
npm run test:manual:all

# Run individual suites
npm run test:dcs:manual           # DCS verification
npm run test:parity:manual        # Endpoint parity
npm run test:equivalence:manual   # Response equivalence
npm run test:prompts:manual       # Prompts execution
npm run test:schema:manual        # Schema validation
npm run test:errors:manual        # Error handling
npm run test:integration:manual   # Integration workflows
npm run test:performance:manual   # Performance benchmarks
npm run test:cache:manual         # Cache isolation
```

### Complete Results

See detailed reports:
- **MANUAL_TESTS_FINAL_SUMMARY.md** - Overall summary
- **COMPLETE_MANUAL_TEST_REPORT.md** - Full test results
- **MANUAL_TEST_ISSUES_TRACKER.md** - All 13 issues with fix estimates
- **MANUAL_TEST_QUICK_REFERENCE.md** - Quick reference card

---

**Last Updated**: 2026-03-17  
**Status**: Tests Executed - 84% Pass Rate - 13 Issues Found  
**Priority**: Fix HIGH priority issues (5 issues, ~5 hours estimated)
