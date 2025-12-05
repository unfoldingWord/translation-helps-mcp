# API Test Suite

This directory contains comprehensive tests for all REST API endpoints.

## Test Structure

### Integration Tests

- **`fetch-scripture.test.ts`** - Tests for scripture fetching endpoint
- **`fetch-translation-notes.test.ts`** - Tests for translation notes endpoint
- **`fetch-translation-questions.test.ts`** - Tests for translation questions endpoint
- **`fetch-translation-academy.test.ts`** - Tests for translation academy endpoint
- **`fetch-translation-word.test.ts`** - Tests for translation word endpoint
- **`fetch-translation-word-links.test.ts`** - Tests for translation word links endpoint
- **`list-languages.test.ts`** - Tests for language listing endpoint
- **`list-subjects.test.ts`** - Tests for subject listing endpoint
- **`multi-org-integration.test.ts`** - Integration tests for multi-organization support
- **`chat-stream.test.ts`** - Tests for chat streaming endpoint

### Contract Tests

- **`external-api-contracts.test.ts`** - Tests that verify git.door43.org API contracts haven't changed

## Test Categories

Each test file includes:

1. **Basic Functionality** - Valid requests and expected responses
2. **Multi-Organization Support** - Testing with no org, single org, and multiple orgs
3. **Parameter Validation** - Required parameters, invalid formats, defaults
4. **Format Support** - JSON (default), Markdown, Text, TSV (where applicable)
5. **CORS Support** - CORS headers and OPTIONS preflight handling

## Running Tests

### Run All API Tests

```bash
npm test -- ui/tests/api/
```

### Run Specific Test File

```bash
npm test -- ui/tests/api/fetch-scripture.test.ts
```

### Run Contract Tests Only

```bash
npm test -- ui/tests/api/external-api-contracts.test.ts
```

## Test Environment

Tests run against the **dev server** on `http://localhost:8174` by default.

Make sure the dev server is running:

```bash
npm run dev
```

## External API Dependencies

Our endpoints call git.door43.org APIs:

- `/catalog/list/languages` - Language listing
- `/catalog/list/subjects` - Subject listing
- `/catalog/search` - Resource search
- `/catalog/list/owners` - Owner listing
- ZIP archives - `/{org}/{repo}/archive/{ref}.zip`
- Raw files - `/{org}/{repo}/raw/branch/{branch}/{path}`

### Contract Tests

The `external-api-contracts.test.ts` file verifies that these external APIs maintain their expected contracts. These tests:

- Verify response structures haven't changed
- Check that required parameters still work
- Detect breaking changes in external APIs

**Note**: Contract tests make real HTTP requests to git.door43.org. They should be run periodically (e.g., in CI/CD) but not on every test run to avoid rate limiting.

## Test Utilities

All tests use the `makeRequest` utility from `tests/test-utils.ts` which:

- Handles URL construction with query parameters
- Sets appropriate Accept headers based on format
- Parses responses (JSON, text, binary)
- Returns standardized response objects

## Future Enhancements

Consider adding:

1. **Unit Tests with Mocks** - Test error handling and edge cases without external API calls
2. **Performance Tests** - Measure response times and identify bottlenecks
3. **Load Tests** - Test behavior under concurrent requests
4. **Error Scenario Tests** - Test handling of external API failures
