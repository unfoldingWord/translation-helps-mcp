# Translation Helps MCP - Comprehensive Test Suite

This directory contains comprehensive tests to ensure MCP tools, prompts, and REST endpoints are working correctly and are synchronized.

## Quick Start

```bash
# Run all tests
npm run test:all

# Run specific test suites
npm run test:parity           # Endpoint parity tests
npm run test:equivalence      # Response equivalence tests
npm run test:prompts          # Prompt tests
npm run test:validation       # Parameter validation tests

# Watch mode (auto-rerun on changes)
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Test Categories

### 1. Endpoint Parity Tests (`endpoint-parity.test.ts`)

**Purpose**: Ensure MCP tools and REST endpoints are synchronized.

**Tests:**
- ✅ Every MCP tool has a corresponding REST endpoint
- ✅ Every core REST endpoint has a corresponding MCP tool
- ✅ Parameter names are consistent between MCP and REST
- ✅ Naming conventions are followed (underscores in MCP, hyphens in REST)
- ✅ Tool metadata (descriptions, input schemas) is complete

**Why It Matters**: Prevents drift between MCP and REST APIs. Users should be able to use either interface with the same parameters and get the same results.

---

### 2. Response Equivalence Tests (`response-equivalence.test.ts`)

**Purpose**: Ensure MCP and REST return structurally equivalent data.

**Tests:**
- ✅ Both APIs return the same data structure
- ✅ Both APIs return the same content (accounting for MCP text formatting)
- ✅ Error responses are consistent
- ✅ Format parameter works consistently (json, md, markdown)
- ✅ Organization parameter filtering works correctly
- ✅ Language parameter and variant discovery work correctly

**Why It Matters**: Ensures data consistency across interfaces. Users should get equivalent data regardless of which API they use.

---

### 3. Prompt Tests (`prompts.test.ts`)

**Purpose**: Verify all MCP prompts execute successfully and return properly formatted responses.

**Tests:**
- ✅ All expected prompts are available
- ✅ Required arguments are enforced
- ✅ Optional arguments work correctly
- ✅ Responses are properly formatted
- ✅ Responses contain expected content
- ✅ Prompts complete in reasonable time

**Prompts Tested:**
1. `translation-helps-report` - Condensed report
2. `translation-helps-for-passage` - Comprehensive report
3. `get-translation-words-for-passage` - Translation words
4. `get-translation-academy-for-passage` - Translation academy
5. `discover-resources-for-language` - Resource discovery
6. `discover-languages-for-subject` - Language discovery

**Why It Matters**: Prompts are the primary interface for AI assistants. They must be reliable and return well-formatted data.

---

### 4. Parameter Validation Tests (`parameter-validation.test.ts`)

**Purpose**: Ensure parameters are validated correctly and consistently.

**Tests:**
- ✅ Organization parameter (empty = all, specific = filtered)
- ✅ Language parameter (base language, variants, auto-discovery)
- ✅ Format parameter (json, md, markdown, unsupported)
- ✅ Topic parameter (tc-ready, custom topics)
- ✅ Category parameter (kt, names, other)
- ✅ Path parameter (Translation Words and Academy)
- ✅ Cache isolation across parameter combinations

**Why It Matters**: Prevents bugs from incorrect parameter handling. Ensures explicit user choices are respected (especially for organization and language).

---

## Test Infrastructure

### Helper Files

**`helpers/test-client.ts`**
- Unified client for calling REST and MCP APIs
- Handles request formatting and error handling
- Provides comparison utilities

**`helpers/test-data.ts`**
- Sample test data (references, languages, organizations, etc.)
- Test parameter combinations
- Expected response structures
- Error scenarios

### Configuration

**`vitest.config.ts`**
- Test environment configuration
- Coverage settings
- Timeout settings
- Reporter configuration

**`run-all-tests.sh`**
- Bash script to run all test suites
- Checks server availability
- Generates coverage reports
- Provides colored output and summary

---

## Requirements

### Environment

1. **Server Running**: Tests require the dev server to be running
   ```bash
   npm run dev  # In one terminal
   npm run test:all  # In another terminal
   ```

2. **Environment Variables** (optional):
   ```bash
   TEST_SERVER_URL=http://localhost:8174  # Default
   ```

3. **Dependencies**:
   ```bash
   npm install vitest @vitest/coverage-v8
   ```

---

## Test Data

### Sample References
- `John 3:16` - Single verse (English, Spanish available)
- `Genesis 1:1-3` - Verse range
- `Psalm 23` - Whole chapter

### Sample Languages
- `en` - English (primary)
- `es` - Spanish (with variant es-419)
- `es-419` - Spanish Latin America (variant)
- `pt-br` - Portuguese Brazil

### Sample Organizations
- (empty) - Search all organizations
- `unfoldingWord` - Specific organization
- `es-419_gl` - Gateway Language organization

### Sample Paths
- **Translation Words**:
  - `kt/faith` - Key Term
  - `names/abraham` - Proper Name
  - `other/altar` - Other Term
  
- **Translation Academy**:
  - `figs-metaphor` - Figure of Speech: Metaphor
  - `figs-idiom` - Figure of Speech: Idiom
  - `figs-hyperbole` - Figure of Speech: Hyperbole

---

## Continuous Integration

### GitHub Actions

```yaml
name: Comprehensive Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build
      - run: npm run dev &
      - run: sleep 10
      - run: npm run test:all
      - run: npm run test:coverage
```

---

## Common Issues

### Server Not Running
```bash
Error: Server not responding after 30s
Solution: Start server with `npm run dev`
```

### Resource Not Found (404)
```
⚠️  Resource not found for language 'es-419'
Note: This is expected for some language/organization combinations
```

### Timeout Errors
```
Error: Test timeout (30000ms)
Solution: 
1. Check network connection
2. Increase timeout in vitest.config.ts
3. Check server logs for slow responses
```

### Coverage Too Low
```
Error: Coverage for lines (55%) does not meet threshold (60%)
Solution:
1. Add tests for uncovered code paths
2. Remove dead code
3. Adjust thresholds if appropriate
```

---

## Adding New Tests

### When to Add Tests

1. **New Tool Added**: Add to endpoint parity, response equivalence, and integration tests
2. **Parameter Added/Changed**: Update schema validation tests
3. **Error Handling Changed**: Update error handling tests
4. **Prompt Added**: Add to prompt tests
5. **Cache Logic Changed**: Update cache isolation tests

### How to Add a Test

1. **Identify the test category** (parity, equivalence, prompts, etc.)
2. **Add test case** to the appropriate test file
3. **Add test data** to `helpers/test-data.ts` if needed
4. **Run tests** to verify
5. **Update documentation** in this README

---

## Test Metrics

### Coverage Goals
- **Lines**: 60%+
- **Functions**: 60%+
- **Branches**: 60%+
- **Statements**: 60%+

### Success Criteria
- **Critical Tests**: 100% pass rate (endpoint parity, response equivalence, prompts)
- **Validation Tests**: 95%+ pass rate
- **Integration Tests**: 95%+ pass rate
- **Performance Tests**: 80%+ pass rate (may vary by system)

---

## Maintenance

### Weekly
- Review failed tests
- Fix flaky tests
- Update test data if APIs change

### Monthly
- Review test coverage
- Identify gaps
- Refactor tests for maintainability
- Update documentation

### Quarterly
- Performance baseline review
- Test strategy review
- Tool usage analysis

---

## Related Documentation

- [**COMPREHENSIVE_TEST_PLAN.md**](../COMPREHENSIVE_TEST_PLAN.md) - Full test strategy and plan
- [**PARAMETER_VALIDATION_TESTS.md**](../PARAMETER_VALIDATION_TESTS.md) - Detailed parameter testing docs
- [**ORGANIZATION_FIX_COMPLETE.md**](../ORGANIZATION_FIX_COMPLETE.md) - Organization parameter fix details

---

## Questions?

- **How do I run tests for a specific endpoint?**
  ```typescript
  // In test file, use `.only`:
  it.only('should test specific thing', async () => { ... });
  ```

- **How do I debug a failing test?**
  ```bash
  # Add console.log statements in test
  # Run test in watch mode
  npm run test:watch
  ```

- **How do I test against production?**
  ```bash
  TEST_SERVER_URL=https://production.example.com npm run test:all
  ```

- **How do I add a new test suite?**
  1. Create `tests/my-new-test.test.ts`
  2. Add npm script: `"test:my-new": "vitest run tests/my-new-test.test.ts"`
  3. Add to `run-all-tests.sh`

---

**Last Updated**: 2026-03-17  
**Status**: Active  
**Maintainer**: Translation Helps MCP Team
