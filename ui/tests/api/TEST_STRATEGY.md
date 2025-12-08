# REST API Endpoint Testing Strategy

## Purpose of REST API Endpoints

These REST API endpoints serve as **HTTP wrappers around MCP tools**, providing:

1. **Direct HTTP Access**: Allow any HTTP client (browsers, mobile apps, curl, Postman) to access MCP functionality without needing the MCP protocol
2. **Standard REST Patterns**: Use familiar GET requests with query parameters
3. **Multi-Organization Support**: Enable searching across single, multiple, or all organizations
4. **Consistent Response Format**: Standardized JSON responses with metadata
5. **Format Flexibility**: Support multiple output formats (JSON, Markdown, Text, etc.)
6. **Error Handling**: Graceful error responses with helpful messages

### Architecture

```
HTTP Request → REST Endpoint → MCP Tool Handler → Door43 API → Response
                ↓
         Parameter Validation
         Error Handling
         Format Conversion
         CORS Headers
```

## What We're Currently Testing

### ✅ Parameter Parsing & Validation

- **Organization Parameter**: None (all orgs), single org, multiple orgs
- **Required Parameters**: Missing parameter validation (e.g., `reference` for fetch-scripture)
- **Invalid Parameters**: Malformed or invalid values

### ✅ Response Structure

- **Data Format**: Correct array/object structure
- **Metadata**: Response time, timestamp, count
- **Organization Field**: Indicates which org(s) were queried

### ✅ Error Handling

- **Missing Parameters**: Returns 400 with error message
- **Invalid References**: Graceful handling (200 with empty results or 404)
- **Invalid Organizations**: Validation and error responses

### ✅ Multi-Organization Support

- **Single Organization**: `?organization=unfoldingWord`
- **Multiple Organizations**: `?organization=unfoldingWord&organization=es-419_gl`
- **All Organizations**: No organization parameter

## What We Should Test (But Currently Don't)

### 🔴 Format Parameter Support

**Why**: Endpoints support `?format=json|md|text` but we don't test it

```typescript
it('should return markdown format when requested', async () => {
	const response = await makeRequest('/api/fetch-scripture', {
		reference: 'John 3:16',
		language: 'en',
		format: 'md'
	});
	expect(response.headers['content-type']).toContain('text/markdown');
});
```

### 🔴 CORS Headers

**Why**: Endpoints should return proper CORS headers for cross-origin requests

```typescript
it('should include CORS headers in response', async () => {
	const response = await makeRequest('/api/list-languages');
	expect(response.headers['access-control-allow-origin']).toBeDefined();
});
```

### 🔴 OPTIONS Request Handling

**Why**: CORS preflight requests need OPTIONS endpoint

```typescript
it('should handle OPTIONS request for CORS preflight', async () => {
	const response = await fetch('http://localhost:8174/api/list-languages', {
		method: 'OPTIONS'
	});
	expect(response.status).toBe(200);
	expect(response.headers['access-control-allow-methods']).toContain('GET');
});
```

### 🔴 Response Consistency

**Why**: Same parameters should return consistent results

```typescript
it('should return consistent results for same parameters', async () => {
	const [r1, r2] = await Promise.all([
		makeRequest('/api/list-languages', { organization: 'unfoldingWord' }),
		makeRequest('/api/list-languages', { organization: 'unfoldingWord' })
	]);
	// Results should be identical (or at least same structure)
	expect(r1.data.languages.length).toBe(r2.data.languages.length);
});
```

### 🔴 Edge Cases

**Why**: Real-world usage includes edge cases we should handle

- Empty results (valid but no data)
- Very long parameter values
- Special characters in parameters
- Unicode in responses
- Large result sets

### 🔴 Performance Boundaries

**Why**: Set expectations for response times

- Single org: < 2 seconds
- Multiple orgs: < 5 seconds
- All orgs: < 10 seconds

### 🔴 Resource Parameter (fetch-scripture)

**Why**: `fetch-scripture` supports `resource` parameter but we don't test it

```typescript
it('should filter by resource type', async () => {
	const response = await makeRequest('/api/fetch-scripture', {
		reference: 'John 3:16',
		language: 'en',
		resource: 'ult,ust'
	});
	expect(response.data.scripture.length).toBeLessThanOrEqual(2);
	expect(
		response.data.scripture.every((s) => ['ult', 'ust'].includes(s.translation.toLowerCase()))
	).toBe(true);
});
```

### 🔴 Stage Parameter (list-languages, list-subjects)

**Why**: These endpoints support `stage` parameter but we don't test it

```typescript
it('should filter by stage', async () => {
	const response = await makeRequest('/api/list-languages', {
		stage: 'prod'
	});
	expect(response.status).toBe(200);
});
```

## Test Coverage Gaps

### Missing Test Categories

1. **Format Support Tests** (0% coverage)
   - JSON format (default)
   - Markdown format
   - Text format
   - Invalid format handling

2. **CORS Tests** (0% coverage)
   - CORS headers presence
   - OPTIONS request handling
   - Preflight request support

3. **Resource Parameter Tests** (0% coverage for fetch-scripture)
   - Single resource type
   - Multiple resource types
   - 'all' resource parameter
   - Invalid resource types

4. **Stage Parameter Tests** (0% coverage)
   - prod, preprod, draft stages
   - Invalid stage values

5. **Edge Case Tests** (Partial coverage)
   - Empty result sets
   - Unicode/special characters
   - Very long parameter values
   - Concurrent requests

6. **Performance Tests** (Basic coverage)
   - Response time expectations
   - Timeout handling
   - Large result sets

## Recommended Test Structure

### Priority 1: Core Functionality (✅ Mostly Complete)

- Parameter parsing
- Response structure
- Error handling
- Multi-organization support

### Priority 2: Format Support (🔴 Missing)

- Format parameter validation
- Content-Type headers
- Format conversion accuracy

### Priority 3: CORS & Headers (🔴 Missing)

- CORS header presence
- OPTIONS request handling
- Header consistency

### Priority 4: Edge Cases (🟡 Partial)

- Empty results
- Special characters
- Boundary conditions

### Priority 5: Performance (🟡 Basic)

- Response time expectations
- Concurrent request handling

## What NOT to Test

❌ **Don't test MCP tool logic** - That's tested in MCP tool tests
❌ **Don't test Door43 API directly** - That's external
❌ **Don't test caching implementation** - That's infrastructure
❌ **Don't test X-Ray tracing internals** - That's diagnostic

✅ **DO test**:

- HTTP interface contract
- Parameter validation
- Response format
- Error responses
- CORS behavior
- Format conversion

## Summary

**Current State**: We have good coverage of core functionality (parameter parsing, response structure, error handling, multi-org support).

**Missing**: Format support, CORS, resource/stage parameters, edge cases, and performance boundaries.

**Recommendation**: Add tests for format support and CORS as Priority 2, then fill in edge cases and performance tests.


