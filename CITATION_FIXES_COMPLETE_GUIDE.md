# Citation Metadata - Complete Fix Guide

This document provides a comprehensive overview of all citation-related fixes across the Translation Helps MCP system.

---

## 🎯 Problem Overview

**Issue**: LLM responses were not properly citing the actual sources of translation resources, instead defaulting to generic names like "ULT" even when the actual source was different (e.g., "GLT v41" for Spanish resources).

**Example**:
```
❌ LLM Said: "Aquí tienes Tito 3:11-15 en la versión ULT:"

✅ Should Say: "Aquí tienes Tito 3:11-15 en la versión GLT v41 (Texto Puente Literal):"
```

---

## 📋 Root Causes (2 Layers)

### Layer 1: Data Layer (Backend) ✅ FIXED
**Issue**: Citation metadata was not being consistently included in API responses.

**Affected Files**:
- `src/functions/resources-service.ts` - Scripture citation extraction bug
- `src/unified-services/ScriptureService.ts` - Array vs single object handling
- `ui/src/routes/api/execute-prompt/+server.ts` - Prompt response stripping citations

**Documentation**: See [CITATION_METADATA_FIX.md](./CITATION_METADATA_FIX.md)

### Layer 2: LLM Instructions (Prompts) ✅ FIXED
**Issue**: Even with citation data present, LLMs were not instructed to read and use it.

**Affected Files**:
- `packages/shared-prompts/src/core-prompt.ts` - System prompt
- `packages/shared-prompts/python/prompts.py` - Python system prompt
- `src/mcp/prompts-registry.ts` - MCP prompt templates

**Documentation**: See [LLM_CITATION_USAGE_FIX.md](./LLM_CITATION_USAGE_FIX.md)

---

## ✅ Complete Fix Summary

### 1. Backend Data Fixes

#### A. Scripture Citation Extraction (`resources-service.ts`)
```typescript
// BEFORE: Only checked single scripture object
const scriptureData = res.data || res.scripture;
if (scriptureData?.citation) {
  result.citations.push(scriptureData.citation);
}

// AFTER: Handles both single and array formats
const scriptureData = res.data || res.scripture || res.scriptures;

if (Array.isArray(scriptureData)) {
  result.scripture = scriptureData;
  scriptureData.forEach(s => {
    if (s.citation) {
      result.citations.push(s.citation);
    }
  });
} else if (scriptureData) {
  result.scripture = scriptureData;
  if (scriptureData.citation) {
    result.citations.push(scriptureData.citation);
  }
}
```

#### B. Unified Service Metadata (`ScriptureService.ts`)
```typescript
// BEFORE: Assumed scripture was always an array
count: result.scripture?.length || 0,
resources: result.scripture?.map(...)

// AFTER: Normalizes to array first
const scriptureArray = result.scriptures || (result.scripture ? [result.scripture] : []);
const count = scriptureArray.length;
const resources = scriptureArray.map((s: any) => s.translation).filter(Boolean);
```

#### C. Prompt Response Aggregation (`execute-prompt/+server.ts`)
```typescript
// BEFORE: Only extracted text
results.scripture = { text: scriptureData.scripture[0].text };

// AFTER: Preserves full citation
results.scripture = {
  text: scripture.text,
  translation: scripture.translation,
  citation: scripture.citation  // ✅ PRESERVED
};
```

### 2. LLM Instruction Fixes

#### A. System Prompt Updates

**BEFORE** (`core-prompt.ts`):
```typescript
CORE RULES:
2. SCRIPTURE: Quote word-for-word with translation name (e.g., [ULT v86 - John 3:16]).
```

**AFTER**:
```typescript
CORE RULES:
2. SCRIPTURE CITATION: ALWAYS read the citation object from the response and use it to cite scripture:
   - Format: [Resource Version - Reference] (e.g., [GLT v41 - Tito 3:11-15])
   - Use citation.title OR citation.resource from the actual response data
   - Use citation.version from the actual response data
   - NEVER assume the resource name - read it from citation.resource or citation.title
   - Example citation object: {"resource": "glt", "title": "Texto Puente Literal", "version": "v41"}
   - Should be cited as: [GLT v41 - Reference] OR [Texto Puente Literal v41 - Reference]

CITATION READING EXAMPLES:
- If scripture.citation = {"resource": "glt", "version": "v41"} → Cite as [GLT v41 - Reference]
- If scripture.citation = {"title": "Literal Text", "version": "v88"} → Cite as [Literal Text v88 - Reference]
- ALWAYS extract resource name and version from the citation object, never assume!
```

#### B. MCP Prompt Template Updates

**BEFORE** (`prompts-registry.ts` - translation-helps-for-passage):
```typescript
1. **Get the Scripture Text:**
   - Use fetch_scripture tool with reference="..."
   - This provides the actual Bible text to work with
```

**AFTER**:
```typescript
**CITATION REQUIREMENTS**: Every resource returned includes a citation object. You MUST:
1. Read the citation object from each response
2. Extract citation.resource or citation.title for the resource name
3. Extract citation.version for the version number
4. Cite scripture and all resources using this format: [Resource Version - Reference]
5. NEVER assume resource names (like "ULT") - always read from citation object

1. **Get the Scripture Text:**
   - Use fetch_scripture tool with reference="..."
   - Read scripture.citation object from the response
   - Cite scripture using: [citation.resource version - reference] (e.g., [GLT v41 - TIT 3:11-15])
   - This provides the actual Bible text to work with
```

---

## 🧪 Testing Guide

### Test Scenario 1: Spanish Resources

```bash
# Call MCP Prompt
prompt: translation-helps-for-passage
args: {
  reference: "TIT 3:11-15",
  language: "es-419",
  organization: "unfoldingWord"
}

# Expected LLM Response Citations:
✅ Scripture: [GLT v41 - Tito 3:11-15] or [Texto Puente Literal v41 - Tito 3:11-15]
✅ Questions: [es-419_tq v38 - Tito 3:11-15]
✅ Notes: [es-419_tn v66 - Tito 3:11-15]
✅ Words: [es-419_tw v86 - amor], [es-419_tw v86 - pecado]
✅ Academy: [es-419_ta v86 - Metáfora], [es-419_ta v86 - Dobles negativos]

❌ Should NOT Say:
- [ULT - Tito 3:11-15] (for scripture)
- [TQ - Tito 3:11-15] (without language/version)
- Any citation without version number
```

### Test Scenario 2: English Resources

```bash
# Call MCP Prompt
prompt: translation-helps-for-passage
args: {
  reference: "JHN 3:16",
  language: "en",
  organization: "unfoldingWord"
}

# Expected LLM Response Citations:
✅ Scripture: [ULT v86 - John 3:16] (if ULT is actually the source)
✅ Questions: [en_tq v86 - John 3:16]
✅ Notes: [en_tn v86 - John 3:16]
✅ Words: [en_tw v86 - love], [en_tw v86 - believe]
```

### Verification Checklist

**Data Layer**:
- [ ] API responses include `citation` objects for all resources
- [ ] Scripture responses preserve citations (both single and array formats)
- [ ] Questions responses include top-level `citation` and item-level `citation`
- [ ] Notes responses include `citation` for each item
- [ ] Words responses include `citation` for each article
- [ ] Academy responses include `citation` for each article
- [ ] Execute-prompt aggregation preserves all citations

**LLM Instruction Layer**:
- [ ] System prompts include explicit citation reading instructions
- [ ] MCP prompt templates instruct LLM to read citation objects
- [ ] LLM responses cite actual resources (GLT, es-419_tn, etc.)
- [ ] LLM responses include version numbers in citations
- [ ] LLM responses don't assume generic names like "ULT"

---

## 🔧 Manual Testing

### Using MCP Inspector

```bash
# 1. Start MCP Inspector
npx @modelcontextprotocol/inspector dist/index.js

# 2. Test Individual Tools
- Call fetch_scripture with {reference: "TIT 3:11-15", language: "es-419"}
- Verify response includes scripture.citation object
- Check citation.resource = "glt" and citation.version = "v41"

# 3. Test MCP Prompts
- Call translation-helps-for-passage prompt
- Verify LLM response cites actual resources
- Check that LLM doesn't say "ULT" for GLT resources

# 4. Test All Resource Types
- Scripture: GLT v41
- Questions: es-419_tq v38
- Notes: es-419_tn v66
- Words: es-419_tw v86
- Academy: es-419_ta v86
```

### Using Validation Script

```bash
# Run comprehensive validation
npm run test:citations

# Or manually:
npx tsx scripts/validate-citations.ts
```

---

## 📊 Impact Analysis

### What Changed
1. ✅ Backend services now correctly extract and preserve citations
2. ✅ Aggregation layers maintain citations through all transformations
3. ✅ Prompt endpoints explicitly preserve citation metadata
4. ✅ System prompts instruct LLMs to read citation objects
5. ✅ MCP prompts include step-by-step citation handling instructions

### What Didn't Change
- ❌ No changes to core data fetching logic
- ❌ No changes to USFM parsing or processing
- ❌ No changes to alignment data structures
- ❌ No changes to caching mechanisms
- ❌ No database or API schema changes

### Affected Endpoints
**All** endpoints that return resource data:
- `/api/fetch-scripture`
- `/api/fetch-translation-questions`
- `/api/fetch-translation-notes`
- `/api/fetch-translation-word`
- `/api/fetch-translation-word-links`
- `/api/fetch-translation-academy`
- `/api/execute-prompt` (aggregation)

### Affected MCP Components
**All** MCP tools and prompts:
- All individual fetch tools
- `translation-helps-for-passage` prompt
- `get-translation-words-for-passage` prompt
- `get-translation-academy-for-passage` prompt

---

## 📚 Related Documentation

1. **[CITATION_METADATA_FIX.md](./CITATION_METADATA_FIX.md)** - Backend data layer fixes
2. **[PROMPT_CITATION_FIX.md](./PROMPT_CITATION_FIX.md)** - Execute-prompt endpoint fixes
3. **[LLM_CITATION_USAGE_FIX.md](./LLM_CITATION_USAGE_FIX.md)** - Prompt instruction fixes

---

## ✅ Current Status

### Data Layer: ✅ COMPLETE
All backend services correctly return citation metadata.

### LLM Instructions: ✅ COMPLETE
All prompts include explicit citation handling instructions.

### Testing: ⏳ PENDING
Need to test with real MCP client (Claude/other) to verify LLM behavior.

---

## 🚀 Next Steps

1. **Test with Real MCP Client**:
   - Use Claude or other MCP-compatible client
   - Test with Spanish resources (TIT 3:11-15, es-419)
   - Verify LLM cites as [GLT v41] not [ULT]

2. **Verify All Languages**:
   - Test with multiple languages (en, es-419, fr, pt-BR)
   - Confirm citations match actual resource sources

3. **Monitor Production**:
   - Watch logs for any citation-related issues
   - Check user feedback on citation accuracy

4. **Consider Enhancements**:
   - Add citation validation to CI/CD pipeline
   - Create automated tests for LLM citation behavior
   - Add citation quality metrics to monitoring

---

## 📝 Maintenance Notes

### For Future Contributors

**When adding new tools/endpoints**:
1. Always include `citation` object in response format
2. Preserve citation metadata through all aggregation layers
3. Update system prompts if new citation formats are introduced
4. Add citation validation to test suite

**When modifying existing tools**:
1. Never remove `citation` objects from responses
2. Maintain backward compatibility with existing citation formats
3. Test with multiple languages to ensure citations are correct
4. Update MCP prompt templates if citation structure changes

**Citation Object Structure**:
```typescript
{
  resource: string;      // Resource identifier (e.g., "glt", "es-419_tn")
  title?: string;        // Human-readable title (e.g., "Texto Puente Literal")
  organization: string;  // Organization (e.g., "unfoldingWord", "es-419_gl")
  language: string;      // Language code (e.g., "en", "es-419")
  url?: string;          // Source URL
  version: string;       // Version (e.g., "v41", "v86")
}
```

---

**Last Updated**: 2024-01-XX  
**Status**: ✅ All fixes complete, ready for testing
