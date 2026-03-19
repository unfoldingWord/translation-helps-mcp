# Parameter Validation Tests

Comprehensive test suite for Translation Academy and Translation Word endpoint parameters.

## Test Categories

### 1. **Organization Parameter Tests**

| Test | Endpoint | Language | Organization | Expected | Reason |
|------|----------|----------|--------------|----------|--------|
| Empty org, es → es-419 | TA | `es` | `''` (empty) | ✅ 200, Spanish content from `es-419_gl` | Empty org searches all organizations |
| Omitted org, es → es-419 | TA | `es` | (omitted) | ✅ 200, Spanish content from `es-419_gl` | Omitted org searches all organizations |
| Explicit unfoldingWord, es | TA | `es` | `unfoldingWord` | ❌ 404 | unfoldingWord doesn't have es-419 TA |
| Explicit es-419_gl | TA | `es-419` | `es-419_gl` | ✅ 200 | Direct match |
| English with unfoldingWord | TA | `en` | `unfoldingWord` | ✅ 200, "Metaphor" | unfoldingWord has English TA |
| Empty org, es TW | TW | `es` | `''` | ✅ 200 | Finds variant in another org |
| Explicit unfoldingWord TW | TW | `es` | `unfoldingWord` | ❌ 404 | unfoldingWord doesn't have es-419 TW |
| English TW unfoldingWord | TW | `en` | `unfoldingWord` | ✅ 200 | unfoldingWord has English TW |

**Key Principle**: When `organization` is explicitly specified, only that organization is searched. 404 is returned if the resource doesn't exist in that org.

### 2. **Format Parameter Tests**

| Test | Format | Expected | Response Type | Notes |
|------|--------|----------|---------------|-------|
| JSON format | `json` | ✅ 200 | Object with `{title, content, metadata}` | Default format |
| Markdown format | `md` | ✅ 200 | Plain markdown string | Starts with `# Title` |
| Markdown alias | `markdown` | ✅ 200 | Plain markdown string | Same as `md` |
| Invalid: text | `text` | ❌ 400 | Error | Not supported for TA/TW |
| Invalid: usfm | `usfm` | ❌ 400 | Error | Only for scripture |
| Invalid: random | `invalid` | ❌ 400 | Error | Unknown format |

**Supported Formats**:
- **Translation Academy**: `json`, `md`, `markdown`
- **Translation Word**: `json`, `md`, `markdown`
- **Scripture**: `json`, `text`, `usfm`

### 3. **Language & Variant Auto-Retry Tests**

| Test | Language | Organization | Expected Behavior |
|------|----------|--------------|-------------------|
| Base language, empty org | `es` | `''` | Auto-retry `es` → `es-419`, finds in `es-419_gl` ✅ |
| Base language, explicit org | `es` | `unfoldingWord` | Searches only unfoldingWord, returns 404 ❌ |
| Variant language directly | `es-419` | `''` | Direct match, no retry needed ✅ |
| Variant with explicit org | `es-419` | `es-419_gl` | Direct match in specified org ✅ |

**Key Principle**: Auto-retry respects the `organization` parameter. If org is explicit, retry stays within that org.

### 4. **Topic Parameter Tests**

| Test | Topic | Expected | Notes |
|------|-------|----------|-------|
| tc-ready explicitly | `tc-ready` | ✅ 200 | Standard readiness tag |
| Omitted topic | (omitted) | ✅ 200 | Defaults to `tc-ready` |

**Default**: If `topic` is not provided, defaults to `tc-ready` (translationCore-ready resources).

### 5. **Category Parameter Tests (Translation Words Only)**

| Test | Path | Category | Expected | Notes |
|------|------|----------|----------|-------|
| Key Terms | `bible/kt/love` | `kt` | ✅ 200 | Theological terms |
| Names | `bible/names/paul` | `names` | ✅ 200 | Proper names |
| Other | `bible/other/shepherd` | `other` | ✅ 200 | Other terms |
| Invalid category | any | `invalid` | ❌ 400 | Not a valid category |

**Valid Categories**: `kt`, `names`, `other`

### 6. **Path Parameter Tests**

| Test | Path | Expected | Notes |
|------|------|----------|-------|
| Valid TA path | `translate/figs-metaphor` | ✅ 200 | Module exists |
| Valid TA path 2 | `translate/figs-idiom` | ✅ 200 | Another module |
| Valid TA path 3 | `intro/ta-intro` | ✅ 200 | Different category |
| Invalid TA path | `invalid/nonexistent` | ❌ 404 | Module doesn't exist |
| Omitted TA path | (omitted) | ❌ 404 + TOC | Returns table of contents |
| Valid TW path | `bible/kt/love` | ✅ 200 | Term exists |
| Invalid TW path | `bible/kt/nonexistent` | ❌ 404 | Term doesn't exist |

### 7. **Combined Parameter Tests**

#### Valid Combinations

| Endpoint | Parameters | Expected |
|----------|------------|----------|
| TA | `path=translate/figs-metaphor, language=es-419, org=es-419_gl, format=json, topic=tc-ready` | ✅ 200 |
| TW | `path=bible/kt/love, language=en, org=unfoldingWord, category=kt, format=json, topic=tc-ready` | ✅ 200 |

#### Invalid Combinations

| Endpoint | Parameters | Expected | Reason |
|----------|------------|----------|--------|
| TA | `path=valid, language=en, org=valid, format=invalid, topic=tc-ready` | ❌ 400 | Invalid format |
| TA | `path=invalid, language=en, org=valid, format=json, topic=tc-ready` | ❌ 404 | Invalid path |
| TA | `path=valid, language=es-419, org=unfoldingWord, format=json, topic=tc-ready` | ❌ 404 | Org doesn't have resource |

### 8. **Cache Isolation Tests**

Tests that cache doesn't leak between different organization contexts:

```
Request 1: language=es-419, organization=''        → 200 (finds es-419_gl)
Request 2: language=es-419, organization=unfoldingWord → 404 (not in unfoldingWord)
Request 3: language=es-419, organization=''        → 200 (still finds es-419_gl)
```

**Expected**: Each organization context has isolated cache. Request 2 should NOT return cached data from Request 1.

## Running Tests

### Option 1: Bash Test Runner
```bash
bash tests/run-parameter-tests.sh
```

### Option 2: Vitest (if configured)
```bash
npm test tests/parameter-validation.test.ts
```

### Option 3: Manual curl Commands

#### Translation Academy Tests
```bash
# ✅ Should succeed - empty org with es
curl "http://localhost:8174/api/fetch-translation-academy?path=translate/figs-metaphor&language=es&organization=&format=json&topic=tc-ready"

# ❌ Should fail - explicit unfoldingWord with es
curl "http://localhost:8174/api/fetch-translation-academy?path=translate/figs-metaphor&language=es&organization=unfoldingWord&format=json&topic=tc-ready"

# ✅ Should succeed - markdown format
curl "http://localhost:8174/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&format=md"

# ❌ Should fail - invalid format
curl "http://localhost:8174/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&format=text"
```

#### Translation Word Tests
```bash
# ✅ Should succeed - empty org with es
curl "http://localhost:8174/api/fetch-translation-word?path=bible/kt/love&language=es&organization=&format=json"

# ❌ Should fail - explicit unfoldingWord with es
curl "http://localhost:8174/api/fetch-translation-word?path=bible/kt/love&language=es&organization=unfoldingWord&format=json"

# ✅ Should succeed - with category filter
curl "http://localhost:8174/api/fetch-translation-word?path=bible/kt/love&language=en&category=kt&format=json"
```

### Option 4: MCP Tool Tests

Via Cursor MCP tools panel or MCP inspector:

```javascript
// ✅ Should succeed
{
  "name": "fetch_translation_academy",
  "arguments": {
    "path": "translate/figs-metaphor",
    "language": "es",
    "organization": "",
    "format": "json",
    "topic": "tc-ready"
  }
}

// ❌ Should fail (404)
{
  "name": "fetch_translation_academy",
  "arguments": {
    "path": "translate/figs-metaphor",
    "language": "es",
    "organization": "unfoldingWord",
    "format": "json",
    "topic": "tc-ready"
  }
}

// ✅ Should succeed with markdown format
{
  "name": "fetch_translation_academy",
  "arguments": {
    "path": "translate/figs-metaphor",
    "language": "en",
    "format": "md"
  }
}
```

## Expected Outcomes Summary

### ✅ Should Succeed (200)
- Empty/omitted organization with any language that has variants
- Explicit organization that has the requested resource
- Direct variant language (es-419) with appropriate org
- Valid formats: json, md, markdown
- Valid paths and categories

### ❌ Should Fail (400)
- Invalid format values (text, usfm for TA/TW)
- Invalid category values (not kt, names, or other)
- Invalid parameter types

### ❌ Should Fail (404)
- Invalid/nonexistent paths
- Explicit organization that doesn't have the resource
- Language with no available variants
- Omitted required path parameter (returns TOC)

## Performance Expectations

Based on previous optimizations:

| Scenario | Expected Response Time |
|----------|------------------------|
| Direct language + cached catalog | 50-100ms |
| Base language → variant (first request) | 500-800ms |
| Base language → variant (cached mapping) | 80-150ms |
| Explicit unfoldingWord 404 | 300-500ms |

## Files Modified for These Tests

1. `ui/src/routes/api/fetch-translation-academy/+server.ts` - Removed default organization
2. `ui/src/routes/api/fetch-translation-word/+server.ts` - Removed default organization
3. `ui/src/lib/mcp/UnifiedMCPHandler.ts` - Skip empty strings in params
4. `ui/src/lib/simpleEndpoint.ts` - Preserve organization during auto-retry
5. `ui/src/lib/unifiedResourceFetcher.ts` - Respect explicit organization (6 locations)
6. `ui/src/lib/commonValidators.ts` - Added topic, format, category parameters
7. `src/config/tools-registry.ts` - Handle pre-formatted strings in MCP extractors

## Regression Prevention

These tests ensure:
- ✅ Explicit organization choices are respected
- ✅ Auto-retry doesn't silently switch organizations
- ✅ Cache doesn't leak between organization contexts
- ✅ Format parameter works for both REST and MCP
- ✅ Invalid parameters are properly rejected
- ✅ Language variants work correctly with organization filtering
