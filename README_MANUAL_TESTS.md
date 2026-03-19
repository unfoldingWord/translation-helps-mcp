# Manual Test Suite - README

## Quick Start

### Run All Tests
```bash
npm run test:manual:all
```

### Run Individual Tests
```bash
npm run test:dcs:manual           # DCS Source Verification
npm run test:parity:manual        # Endpoint Parity
npm run test:equivalence:manual   # Response Equivalence
npm run test:prompts:manual       # Prompts Execution
npm run test:schema:manual        # Schema Validation
npm run test:errors:manual        # Error Handling
npm run test:integration:manual   # Integration Workflows
npm run test:performance:manual   # Performance Benchmarks
npm run test:cache:manual         # Cache Isolation
```

## Last Execution Results

**Date**: 2026-03-17  
**Total Tests**: 75  
**Passed**: 63 (84%)  
**Failed**: 12 (16%)  

### Suite Breakdown

| Suite | Tests | Pass Rate | Status |
|-------|-------|-----------|--------|
| DCS Source Verification | 3 | 100% | ✅ |
| Performance Benchmarks | 10 | 100% | ✅ |
| Cache Isolation | 10 | 100% | ✅ |
| Schema Validation | 12 | 92% | ⚠️ |
| Prompts Execution | 9 | 89% | ⚠️ |
| Error Handling | 11 | 82% | ⚠️ |
| Integration Workflows | 8 | 63% | ⚠️ |
| Endpoint Parity | 5 | 60% | ⚠️ |
| Response Equivalence | 7 | 57% | ⚠️ |

## Key Findings

### ✅ What Works Perfectly

1. **DCS Accuracy**: 100% match with Door43 catalog
2. **Performance**: All operations under target thresholds
3. **Cache**: Perfect isolation, 2.7x speedup

### ❌ Issues to Fix (13 total)

**HIGH Priority** (5):
- `fetch_translation_academy` returns 404
- `fetch_translation_word` returns 404
- Response format differs (REST vs MCP)
- Translation Notes fetch fails

**MEDIUM Priority** (7):
- Missing validation and format support

**LOW Priority** (1):
- Error response standardization

## Documentation

- **TEST_EXECUTION_COMPLETE.md** - Summary
- **COMPLETE_MANUAL_TEST_REPORT.md** - Full results
- **MANUAL_TEST_ISSUES_TRACKER.md** - All issues
- **MANUAL_TESTS_FINAL_SUMMARY.md** - Executive summary
- **MANUAL_TEST_QUICK_REFERENCE.md** - Quick reference

---

**Status**: Tests Complete ✅  
**Pass Rate**: 84%  
**Action Required**: Fix 13 issues
