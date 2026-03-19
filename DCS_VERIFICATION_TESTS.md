# DCS Source of Truth Verification Tests

## Overview

These tests verify that our Translation Helps MCP API responses match the actual data available in the **Door43 Content Service (DCS) catalog**, which is the authoritative source for all Bible translation resources.

## Why These Tests Are Critical

Without DCS verification, we could:
- ❌ **Hallucinate resources**: Return data that doesn't exist in DCS
- ❌ **Miss resources**: Fail to find resources that DO exist in DCS  
- ❌ **Return wrong metadata**: Provide incorrect language/organization info
- ❌ **Auto-discover invalid variants**: Find language variants that don't exist

## What We Verify

### 1. Resource Existence Validation

**Rule**: If DCS has a resource, we should be able to fetch it. If DCS doesn't have it, we should return 404.

```typescript
// Test: Verify scripture exists in both DCS and our API
const dcsResult = await dcsScriptureExists({
  language: 'en',
  organization: 'unfoldingWord',
});

const ourResponse = await client.callREST('/api/fetch-scripture', {
  reference: 'John 3:16',
  language: 'en',
  organization: 'unfoldingWord',
});

// If DCS has it, we should find it
if (dcsResult.exists) {
  expect(ourResponse.statusCode).toBe(200);
} else {
  expect(ourResponse.statusCode).toBe(404);
}
```

### 2. Metadata Accuracy

**Rule**: Our response metadata (language, organization) must match the actual values from DCS.

```typescript
// Test: Verify metadata matches DCS
const ourResponse = await client.callREST('/api/fetch-scripture', {
  reference: 'Genesis 1:1',
  language: 'en',
  organization: 'unfoldingWord',
});

const dcsResult = await dcsScriptureExists({
  language: 'en',
  organization: 'unfoldingWord',
});

// Our metadata should match DCS exactly
expect(ourResponse.body.metadata.language).toBe(dcsResult.actualLanguage);
expect(ourResponse.body.metadata.organization).toBe(dcsResult.actualOrganization);
```

### 3. Language Variant Discovery

**Rule**: Auto-discovered language variants must actually exist in DCS.

```typescript
// Test: Verify discovered variants exist in DCS
const dcsSpanishVariants = await dcsGetLanguageVariants('es');

const ourResponse = await client.callREST('/api/fetch-scripture', {
  reference: 'John 1:1',
  language: 'es', // Base language
  organization: 'unfoldingWord',
});

if (ourResponse.statusCode === 200) {
  const actualLanguage = ourResponse.body.metadata?.language;
  
  // The language we found should be in DCS variants
  expect(dcsSpanishVariants).toContain(actualLanguage);
}
```

### 4. Organization Parameter Behavior

**Rule**: Organization filtering must match DCS behavior exactly.

```typescript
// Test: Verify organization filtering matches DCS
const dcsResult = await dcsScriptureExists({
  language: 'en',
  organization: 'unfoldingWord',
});

const ourResponse = await client.callREST('/api/fetch-scripture', {
  reference: 'John 3:16',
  language: 'en',
  organization: 'unfoldingWord',
});

if (dcsResult.exists) {
  expect(ourResponse.statusCode).toBe(200);
  expect(ourResponse.body.metadata?.organization).toBe('unfoldingWord');
} else {
  expect(ourResponse.statusCode).toBe(404);
}
```

## Test Suites

### 1. Language Discovery Validation
- Verifies our language list matches DCS catalog
- Ensures variant discovery only finds real variants
- Tests base language → variant fallback logic

### 2. Scripture Resource Validation
- Checks scripture existence against DCS
- Verifies metadata accuracy
- Tests 404 handling for non-existent resources

### 3. Translation Academy Validation
- Verifies TA article existence
- Checks path resolution
- Validates metadata

### 4. Translation Word Validation
- Verifies word/article existence
- Tests category filtering
- Validates metadata

### 5. Organization Parameter Validation
- Tests explicit organization filtering
- Verifies "search all" behavior (empty/missing org)
- Ensures metadata reflects actual DCS source

### 6. Comprehensive Source Comparison
- Side-by-side DCS vs. Our API comparison
- Automated difference detection
- Full metadata validation

### 7. Edge Cases & Data Consistency
- Tests hallucination prevention (don't return what DCS doesn't have)
- Tests resource discovery (don't miss what DCS does have)
- Validates error responses for invalid inputs

## Running the Tests

### Run DCS Verification Tests Only
```bash
npm run test:dcs
```

### Run All Comprehensive Tests (including DCS)
```bash
npm run test:comprehensive
```

### Watch Mode (for development)
```bash
npx vitest run tests/dcs-source-verification.test.ts --watch
```

## How DCS Verification Works

### 1. Direct DCS API Calls

We make actual HTTP requests to the DCS API to get source-of-truth data:

```typescript
// DCS Catalog Search
const dcsResponse = await fetch(
  'https://git.door43.org/api/v1/catalog/search?lang=en&owner=unfoldingWord&subject=Bible'
);
```

### 2. Parameter Matching

We use the **same parameters** for both DCS and our API:

| Parameter | Our API | DCS API |
|-----------|---------|---------|
| Language | `language` | `lang` |
| Organization | `organization` | `owner` |
| Resource Type | Mapped to `subject` | `subject` (e.g., "Bible", "Translation Words") |
| Stage | Always `prod` | `stage=prod` |

### 3. Response Comparison

We compare:
- **Existence**: Does resource exist in both?
- **Metadata**: Do language/organization match?
- **Variants**: Are discovered variants real?

## DCS API Endpoints Used

### Catalog Search
```
GET https://git.door43.org/api/v1/catalog/search
Parameters:
  - lang: Language code (e.g., "en", "es-419")
  - owner: Organization (e.g., "unfoldingWord")
  - subject: Resource type (e.g., "Bible", "Translation Words")
  - stage: "prod" (production resources only)
  - metadataType: "rc" (Resource Container format)
```

### Language List
```
GET https://git.door43.org/catalog/list/languages
Parameters:
  - stage: "prod"
```

## Test Helpers

### `dcs-client.ts`

Utility functions for calling DCS API directly:

```typescript
// Check if resource exists in DCS
const result = await dcsResourceExists({
  language: 'en',
  organization: 'unfoldingWord',
  subject: 'Bible',
});
// Returns: { exists: boolean, resource?: DCSResource }

// Get all languages from DCS
const languages = await dcsGetLanguages();
// Returns: string[] (language codes)

// Get language variants
const variants = await dcsGetLanguageVariants('es');
// Returns: ["es", "es-419", "es-ES", ...]

// Compare responses
const comparison = await compareWithDCS({
  endpoint: '/api/fetch-scripture',
  language: 'en',
  organization: 'unfoldingWord',
  subject: 'Bible',
  ourResponse: apiResponse,
});
// Returns: { matches: boolean, differences: string[], dcsData: {...} }
```

## Expected Outcomes

### ✅ Passing Tests Mean

1. **No Hallucinations**: We never return data DCS doesn't have
2. **Complete Discovery**: We find all resources DCS provides
3. **Accurate Metadata**: Language/organization info is correct
4. **Valid Variants**: Auto-discovered variants are real
5. **Consistent Behavior**: Our API mirrors DCS exactly

### ❌ Failing Tests Indicate

1. **Cache Issues**: Stale data not matching DCS
2. **Variant Logic Errors**: Finding variants that don't exist
3. **Metadata Bugs**: Wrong language/organization in response
4. **Discovery Gaps**: Missing resources DCS provides
5. **False Positives**: Returning 200 for non-existent resources

## Troubleshooting

### Test Fails: "We returned 200 but DCS says resource doesn't exist"

**Problem**: Our API found a resource that DCS doesn't have.

**Possible Causes**:
- Cached data is stale
- Variant discovery is too aggressive
- Organization parameter not respected

**Debug**:
```bash
# Check cache entries
npm run dev
# Visit: http://localhost:8174/cache-inspector

# Manually verify in DCS:
curl "https://git.door43.org/api/v1/catalog/search?lang=LANGUAGE&owner=ORG&subject=SUBJECT"
```

### Test Fails: "We returned 404 but DCS has the resource"

**Problem**: Our API failed to find a resource DCS provides.

**Possible Causes**:
- Variant discovery not working
- Organization filter too strict
- Path resolution errors

**Debug**:
```bash
# Enable debug logging
LOGGER_LEVEL=debug npm run dev

# Check logs for:
# - "Language variant discovery"
# - "Catalog search"
# - "Resource metadata"
```

### Test Fails: "Metadata mismatch"

**Problem**: Our metadata doesn't match DCS source.

**Possible Causes**:
- Metadata not populated in response
- Wrong values from catalog
- Organization override bugs

**Debug**:
```typescript
// Check response metadata
const response = await client.callREST('/api/fetch-scripture', {...});
console.log('Our metadata:', response.body.metadata);

// Check DCS metadata
const dcsResult = await dcsScriptureExists({...});
console.log('DCS metadata:', dcsResult.actualLanguage, dcsResult.actualOrganization);
```

## Integration with Other Tests

DCS verification complements our existing test suites:

1. **Endpoint Parity**: Tests our API structure
2. **Response Equivalence**: Tests MCP vs REST consistency
3. **DCS Verification**: Tests accuracy against source of truth ✨

Together, these ensure:
- ✅ Correct API structure (Parity)
- ✅ Consistent interfaces (Equivalence)
- ✅ Accurate data (DCS Verification)

## Best Practices

### When to Run These Tests

- ✅ **Before every release**: Ensure data accuracy
- ✅ **After cache changes**: Verify cache doesn't break DCS sync
- ✅ **After variant logic updates**: Ensure variants are real
- ✅ **After organization parameter changes**: Verify filtering works
- ✅ **On CI/CD**: Catch data drift early

### Test Maintenance

- Update test cases when DCS API changes
- Add new test cases for new resource types
- Monitor DCS API status (if DCS is down, tests will fail)
- Keep DCS client helper functions in sync with API

## Contributing

When adding new endpoints or resource types:

1. Add corresponding DCS verification tests
2. Use the `dcs-client.ts` helpers
3. Test both existence and metadata
4. Add edge cases (missing resources, invalid params)
5. Document expected behavior

## Further Reading

- [DCS API Documentation](https://git.door43.org/api/swagger)
- [UW Translation Resources Guide](./docs/UW_TRANSLATION_RESOURCES_GUIDE.md)
- [Test Strategy Summary](./TEST_STRATEGY_SUMMARY.md)
- [Comprehensive Test Plan](./COMPREHENSIVE_TEST_PLAN.md)
