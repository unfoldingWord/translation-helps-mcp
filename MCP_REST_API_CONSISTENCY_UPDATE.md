# MCP Server & REST API Parameter Consistency Update

## Summary

Ensured that all MCP tools and their corresponding REST API endpoints have matching parameters, particularly the `topic` parameter which was missing from endpoint configurations.

## Changes Made

### 1. Scripture Endpoints (`src/config/endpoints/ScriptureEndpoints.ts`)

**Added `topic` parameter to `SCRIPTURE_BASE_CONFIG`:**
```typescript
topic: {
  type: "string",
  required: false,
  default: "tc-ready",
  description:
    "Filter by topic tag (e.g., 'tc-ready' for translationCore-ready resources). Topics are metadata tags that indicate resource status or readiness.",
  example: "tc-ready",
  options: ["tc-ready"],
}
```

**Affects endpoints:**
- `fetch-scripture`

### 2. Translation Helps Endpoints (`src/config/endpoints/TranslationHelpsEndpoints.ts`)

**Added `topic` parameter to `REFERENCE_PARAMS`:**
```typescript
topic: {
  type: "string" as const,
  required: false,
  default: "tc-ready",
  description:
    "Filter by topic tag (e.g., 'tc-ready' for translationCore-ready resources). Topics are metadata tags that indicate resource status or readiness.",
  example: "tc-ready",
  options: ["tc-ready"],
}
```

**Also added to `TERM_PARAMS` (inherited from REFERENCE_PARAMS):**
```typescript
topic: REFERENCE_PARAMS.topic,
```

**Affects endpoints:**
- `fetch-translation-notes`
- `fetch-translation-questions`
- `fetch-translation-word-links`
- `fetch-translation-word`
- `fetch-translation-academy`

### 3. Discovery Endpoints (`src/config/endpoints/DiscoveryEndpoints.ts`)

**Added `topic` parameter to:**

#### `LIST_LANGUAGES_CONFIG`:
```typescript
topic: {
  type: "string" as const,
  required: false,
  default: "tc-ready",
  description:
    "Filter by topic tag (e.g., 'tc-ready' for translationCore-ready resources). Topics are metadata tags that indicate resource status or readiness.",
  example: "tc-ready",
  options: ["tc-ready"],
}
```

#### `LIST_SUBJECTS_CONFIG`:
```typescript
topic: {
  type: "string" as const,
  required: false,
  default: "tc-ready",
  description:
    "Filter by topic tag (e.g., 'tc-ready' for translationCore-ready resources). Topics are metadata tags that indicate resource status or readiness.",
  example: "tc-ready",
  options: ["tc-ready"],
}
```

**Note:** `LIST_RESOURCES_FOR_LANGUAGE_CONFIG` already had the `topic` parameter.

**Affects endpoints:**
- `list-languages`
- `list-subjects`
- `list-resources-for-language` (already had it)

## Parameter Consistency Status

### ✅ Now Consistent

All MCP tools and REST API endpoints now share the following parameters where applicable:

| Tool/Endpoint | Core Params | Format | Topic | Organization | Other |
|---------------|-------------|--------|-------|--------------|-------|
| **Scripture** |
| `fetchScripture` / `fetch-scripture` | reference, language | ✅ | ✅ | ✅ | resource, includeAlignment, includeVerseNumbers |
| **Translation Helps** |
| `fetchTranslationNotes` / `fetch-translation-notes` | reference, language | ✅ | ✅ | ✅ | includeIntro, includeContext |
| `fetchTranslationQuestions` / `fetch-translation-questions` | reference, language | ✅ | ✅ | ✅ | - |
| `fetchTranslationWordLinks` / `fetch-translation-word-links` | reference, language | ✅ | ✅ | ✅ | - |
| `getTranslationWord` / `fetch-translation-word` | reference/term, language | ✅ | ✅ | ✅ | path, rcLink, category |
| `fetchTranslationAcademy` / `fetch-translation-academy` | moduleId, language | ✅ | ✅ | ✅ | path, rcLink |
| **Discovery** |
| `listLanguages` / `list-languages` | organization | - | ✅ | ✅ | stage |
| `listSubjects` / `list-subjects` | language, organization | - | ✅ | ✅ | stage |
| `listResourcesForLanguage` / `list-resources-for-language` | language, organization | - | ✅ | ✅ | stage, subject, limit |

## Key Benefits

1. **Consistency**: MCP tools and REST API endpoints now have identical parameter sets
2. **Topic Filtering**: All endpoints now support `tc-ready` topic filtering by default
3. **Multi-Organization Support**: `organization` parameter is optional (defaults to `undefined`) across all endpoints, enabling multi-organization fetching
4. **Documentation Alignment**: Parameter descriptions match between MCP and REST interfaces

## Testing Recommendations

1. Test each endpoint with `topic=tc-ready` parameter
2. Test each endpoint without `organization` parameter to verify multi-org fetching
3. Verify that the `topic` parameter correctly filters DCS catalog results
4. Check that default values (`tc-ready` for topic, `undefined` for organization) work as expected

## Related Files

### Core Service Files (already updated):
- `src/functions/scripture-service.ts`
- `src/functions/translation-notes-service.ts`
- `src/functions/translation-questions-service.ts`
- `src/functions/translation-words-service.ts`
- `src/functions/resources-service.ts`
- `src/functions/resource-detector.ts`
- `src/services/ResourceAggregator.ts`

### MCP Tools (already updated):
- `src/tools/fetchScripture.ts`
- `src/tools/fetchTranslationNotes.ts`
- `src/tools/fetchTranslationQuestions.ts`
- `src/tools/fetchTranslationWordLinks.ts`
- `src/tools/getTranslationWord.ts`
- `src/tools/fetchTranslationAcademy.ts`
- `src/tools/listLanguages.ts`
- `src/tools/listSubjects.ts`
- `src/tools/listResourcesForLanguage.ts`

### Common Schemas:
- `src/schemas/common-params.ts` (defines `TopicParam` and other shared parameters)

## Build Status

✅ Build completed successfully with all endpoint configs updated.

## Next Steps

1. Deploy to production to make these changes available
2. Update SDK documentation to reflect new parameter defaults
3. Consider adding `topic` parameter to SDK client methods if not already present
