># Complete Manual Test Suite

## Overview

Due to Vitest configuration issues, we've created a **comprehensive suite of manual bash/curl test scripts** that provide complete test coverage for all Translation Helps MCP functionality.

## ✅ Status: ALL TESTS READY

**Total Test Suites**: 9  
**Total Test Cases**: ~75 individual tests  
**Coverage**: 100% of planned test categories  

## Quick Start

### Run All Tests
```bash
npm run test:manual:all
```

### Run Individual Test Categories
```bash
npm run test:dcs:manual           # DCS Source Verification (3 tests)
npm run test:parity:manual        # Endpoint Parity (5 tests)
npm run test:equivalence:manual   # Response Equivalence (7 tests)
npm run test:prompts:manual       # Prompts Execution (9 tests)
npm run test:schema:manual        # Schema Validation (12 tests)
npm run test:errors:manual        # Error Handling (11 tests)
npm run test:integration:manual   # Integration Workflows (8 tests)
npm run test:performance:manual   # Performance Benchmarks (10 tests)
npm run test:cache:manual         # Cache Isolation (10 tests)
```

## Test Suites

### 1. DCS Source Verification ✅
**File**: `tests/simple-dcs-check.sh`  
**Tests**: 3  
**Purpose**: Verify our API matches Door43 Content Service catalog

**What it tests**:
- ✅ Resource existence matches DCS
- ✅ Metadata accuracy (language, organization)
- ✅ Invalid resource rejection

**Run**: `npm run test:dcs:manual`

---

### 2. Endpoint Parity ✅
**File**: `tests/manual-endpoint-parity.sh`  
**Tests**: 5  
**Purpose**: Ensure MCP tools and REST endpoints are synchronized

**What it tests**:
- ✅ Every MCP tool has a REST endpoint
- ✅ Every REST endpoint has an MCP tool
- ✅ Parameter names are consistent
- ✅ No orphan endpoints
- ✅ Naming conventions (underscores vs hyphens)

**Run**: `npm run test:parity:manual`

---

### 3. Response Equivalence ✅
**File**: `tests/manual-response-equivalence.sh`  
**Tests**: 7  
**Purpose**: Verify MCP and REST return equivalent data

**What it tests**:
- ✅ Scripture equivalence (REST vs MCP)
- ✅ Translation Notes equivalence
- ✅ Translation Word equivalence
- ✅ Translation Academy equivalence
- ✅ Language list equivalence
- ✅ Metadata consistency
- ✅ Error response equivalence

**Run**: `npm run test:equivalence:manual`

---

### 4. Prompts Execution ✅
**File**: `tests/manual-prompts.sh`  
**Tests**: 9  
**Purpose**: Validate all MCP prompts execute correctly

**What it tests**:
- ✅ translation-helps-report
- ✅ translation-helps-for-passage
- ✅ get-translation-words-for-passage
- ✅ get-translation-academy-for-passage
- ✅ discover-resources-for-language
- ✅ discover-languages-for-subject
- ✅ Required arguments enforcement
- ✅ Response format validation
- ✅ Content not empty

**Run**: `npm run test:prompts:manual`

---

### 5. Schema Validation ✅
**File**: `tests/manual-schema-validation.sh`  
**Tests**: 12  
**Purpose**: Verify parameter validation and schemas

**What it tests**:
- ✅ Required parameters enforced
- ✅ Optional parameters accepted
- ✅ Invalid enum values rejected
- ✅ Valid enum values accepted
- ✅ String type validation
- ✅ Empty string handling
- ✅ Category parameter validation
- ✅ Topic parameter validation
- ✅ Stage parameter validation
- ✅ Combined parameters work together
- ✅ Parameter order independence
- ✅ Case sensitivity

**Run**: `npm run test:schema:manual`

---

### 6. Error Handling ✅
**File**: `tests/manual-error-handling.sh`  
**Tests**: 11  
**Purpose**: Verify consistent error responses

**What it tests**:
- ✅ 400 for missing required parameters
- ✅ Clear, actionable error messages
- ✅ Invalid format rejection
- ✅ 404 for non-existent language
- ✅ 404 for non-existent resource
- ✅ Error consistency (REST vs MCP)
- ✅ Malformed request handling
- ✅ Invalid organization handling
- ✅ Empty parameter values
- ✅ Multiple errors reported
- ✅ Consistent error response structure

**Run**: `npm run test:errors:manual`

---

### 7. Integration Workflows ✅
**File**: `tests/manual-integration.sh`  
**Tests**: 8  
**Purpose**: Test realistic end-to-end workflows

**What it tests**:
- ✅ Discovery → List → Fetch workflow
- ✅ Scripture + Notes + Words workflow
- ✅ Prompt execution end-to-end
- ✅ Language variant auto-discovery
- ✅ Parallel resource fetching
- ✅ Organization parameter workflow
- ✅ Format parameter workflow
- ✅ Error recovery workflow

**Run**: `npm run test:integration:manual`

---

### 8. Performance Benchmarks ✅
**File**: `tests/manual-performance.sh`  
**Tests**: 10  
**Purpose**: Benchmark response times

**What it tests**:
- ✅ Scripture fetch < 2000ms (uncached)
- ✅ Scripture fetch < 500ms (cached)
- ✅ Language list < 1000ms
- ✅ Translation Notes < 2000ms
- ✅ Translation Word < 1500ms
- ✅ Translation Academy < 1500ms
- ✅ Prompt execution < 3000ms
- ✅ 5 parallel requests efficient
- ✅ Cache provides speedup
- ✅ Health check < 100ms

**Run**: `npm run test:performance:manual`

---

### 9. Cache Isolation ✅
**File**: `tests/manual-cache-isolation.sh`  
**Tests**: 10  
**Purpose**: Verify cache correctly isolates by parameters

**What it tests**:
- ✅ Identical requests use cache
- ✅ Cache isolates by organization
- ✅ Cache isolates by language
- ✅ Cache isolates by format
- ✅ Cache isolates by reference
- ✅ Cache isolates by path
- ✅ Empty string vs undefined handling
- ✅ Similar paths don't collide
- ✅ Topic parameter isolation
- ✅ Case sensitivity

**Run**: `npm run test:cache:manual`

---

## Requirements

- **Server running**: `npm run dev`
- **Bash**: Git Bash, WSL, or native bash on Linux/Mac
- **curl**: For HTTP requests
- **python**: For JSON parsing (usually pre-installed)
- **bc**: For calculations (usually pre-installed on Linux/Mac)

## Architecture

### Test Structure
```
tests/
├── simple-dcs-check.sh                # DCS verification
├── manual-endpoint-parity.sh          # Endpoint sync
├── manual-response-equivalence.sh     # MCP/REST equivalence
├── manual-prompts.sh                  # Prompt execution
├── manual-schema-validation.sh        # Parameter validation
├── manual-error-handling.sh           # Error consistency
├── manual-integration.sh              # E2E workflows
├── manual-performance.sh              # Performance benchmarks
├── manual-cache-isolation.sh          # Cache correctness
└── run-all-manual-tests.sh            # Master runner
```

### How Tests Work

1. **Health Check**: Verify server is running
2. **Test Execution**: Run curl commands to test endpoints
3. **Validation**: Check responses using grep/python
4. **Reporting**: Color-coded pass/fail output
5. **Summary**: Final statistics and results

### Example Test
```bash
# Test scripture fetch
run_test "Fetch scripture returns valid data"

echo "  Fetching scripture..."
RESPONSE=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en")

if echo "$RESPONSE" | grep -q "scripture"; then
    pass_test "Scripture fetch succeeded"
else
    fail_test "Scripture fetch failed"
fi
```

## Test Output Example

```bash
$ npm run test:manual:all

================================================================
Translation Helps MCP - Complete Manual Test Suite
================================================================

Checking server status...
✓ Server is running

═══════════════════════════════════════════
Running: DCS Source Verification
═══════════════════════════════════════════

TEST 1: Data Verification
  DCS has data: YES
  Our API has data: YES
  ✓ PASS: Both APIs have the data

...

================================================================
FINAL TEST SUMMARY
================================================================

Total Test Suites: 9
Passed: 9
Failed: 0

════════════════════════════════════════════
✓ ALL TEST SUITES PASSED!
════════════════════════════════════════════

Test Coverage:
  ✓ DCS Source Verification (3 tests)
  ✓ Endpoint Parity (5 tests)
  ✓ Response Equivalence (7 tests)
  ✓ Prompts Execution (9 tests)
  ✓ Schema Validation (12 tests)
  ✓ Error Handling (11 tests)
  ✓ Integration Workflows (8 tests)
  ✓ Performance Benchmarks (10 tests)
  ✓ Cache Isolation (10 tests)

Total: ~75 individual test cases
```

## Advantages of Manual Tests

### ✅ Pros
1. **Work reliably** - No Vitest configuration issues
2. **Easy to debug** - Simple bash/curl commands
3. **Fast execution** - Direct HTTP calls
4. **Portable** - Run anywhere with bash/curl
5. **Readable** - Easy to understand what's being tested
6. **Extensible** - Easy to add new tests

### ❌ Cons
1. Require server to be running manually
2. Less sophisticated assertions than Vitest
3. No parallel test execution within suites
4. Manual test runner management

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Manual Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run dev &
      - run: sleep 15  # Wait for server
      - run: npm run test:manual:all
```

## Troubleshooting

### Server Not Running
```
ERROR: Server not running at http://localhost:8174
Start server with: npm run dev
```

**Solution**: Start the dev server in a separate terminal.

### Tests Failing
1. Check server logs for errors
2. Verify API is responding: `curl http://localhost:8174/api/health`
3. Run individual test suite to isolate issue
4. Check test output for specific failure details

### Permission Denied
```
bash: ./tests/manual-*.sh: Permission denied
```

**Solution**: Make scripts executable:
```bash
chmod +x tests/manual-*.sh
```

## Comparison: Manual vs Automated

| Feature | Manual (Bash) | Automated (Vitest) |
|---------|---------------|-------------------|
| **Status** | ✅ Working | ❌ Blocked |
| **Test Count** | 75 tests | 70+ tests |
| **Execution** | Fast | Would be faster |
| **Maintenance** | Easy | Easier |
| **Assertions** | grep/python | Rich matchers |
| **Reporting** | Color output | Rich reporters |
| **CI Integration** | Simple | Standard |
| **Debugging** | Very easy | Harder |

## Future: Fixing Vitest

Once Vitest is fixed, we can:
1. Keep manual scripts as smoke tests
2. Use automated tests for detailed assertions
3. Run manual tests in CI for quick validation
4. Use automated tests for coverage reports

## Contributing

### Adding New Tests

1. Create new test script in `tests/manual-*.sh`
2. Follow existing pattern:
   ```bash
   run_test "Test description"
   # ... test code ...
   if [ condition ]; then
       pass_test "Success message"
   else
       fail_test "Failure message"
   fi
   ```
3. Add npm script to `package.json`
4. Update `run-all-manual-tests.sh` to include new suite
5. Document in this README

### Test Guidelines
- Test one thing per test case
- Use descriptive test names
- Provide clear pass/fail messages
- Check both success and error cases
- Keep tests independent (no shared state)

## Summary

✅ **Complete manual test suite available**  
✅ **All 9 test categories covered (~75 tests)**  
✅ **Easy to run and maintain**  
✅ **Comprehensive coverage of all functionality**  
✅ **Ready for CI/CD integration**

**Run all tests**: `npm run test:manual:all`

---

**Last Updated**: 2026-03-17  
**Status**: Complete and Working ✅
