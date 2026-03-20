# LLM Citation Usage Fix

## Problem Summary

The LLM responses were not using citation data from MCP responses, incorrectly citing all Spanish resources as "ULT" instead of the actual source (e.g., "GLT v41" - Texto Puente Literal).

### Example of the Issue

**User's Debug Data Showed:**
```json
"citation": {
  "resource": "glt",
  "title": "Texto Puente Literal",
  "organization": "es-419_gl",
  "language": "es-419",
  "version": "v41"
}
```

**But LLM Said:**
> "Aquí tienes Tito 3:11-15 en la versión **ULT**:"

### Root Cause

While citation metadata was correctly included in MCP responses (fixed in previous PRs), the **prompt instructions** given to the LLM did not tell it to:
1. Read the citation object from responses
2. Extract resource name and version from citation
3. Use that metadata when citing sources

The prompts only gave generic examples like `[ULT v86 - John 3:16]` without instructing the LLM to read actual citation objects.

---

## Files Modified

### 1. Shared Prompts Package (Core System Prompts)

**TypeScript: `packages/shared-prompts/src/core-prompt.ts`**

**Before:**
```typescript
CORE RULES (P0 - Critical):
1. DATA SOURCE: Only use MCP server responses. Never use training data or add external knowledge.
2. SCRIPTURE: Quote word-for-word with translation name (e.g., [ULT v86 - John 3:16]).
3. CITATIONS: Every quote needs citation: [Resource - Reference] (e.g., [TN v86 - John 3:16]).
```

**After:**
```typescript
CORE RULES (P0 - Critical):
1. DATA SOURCE: Only use MCP server responses. Never use training data or add external knowledge.
2. SCRIPTURE CITATION: ALWAYS read the citation object from the response and use it to cite scripture:
   - Format: [Resource Version - Reference] (e.g., [GLT v41 - Tito 3:11-15])
   - Use citation.title OR citation.resource from the actual response data
   - Use citation.version from the actual response data
   - NEVER assume the resource name - read it from citation.resource or citation.title
   - Example citation object: {"resource": "glt", "title": "Texto Puente Literal", "version": "v41"}
   - Should be cited as: [GLT v41 - Reference] OR [Texto Puente Literal v41 - Reference]
3. OTHER CITATIONS: Every resource quote needs proper citation from its citation object:
   - Translation Notes: [Resource Version - Reference] (e.g., [es-419_tn v66 - Tito 3:11])
   - Translation Words: [Resource Version - Term] (e.g., [es-419_tw v86 - amor])
   - Translation Questions: [Resource Version - Reference] (e.g., [es-419_tq v38 - Tito 3:14])
   - Translation Academy: [Resource Version - Article] (e.g., [es-419_ta v86 - Metáfora])
```

Added explicit citation reading examples:
```typescript
CITATION READING EXAMPLES:
- If scripture.citation = {"resource": "glt", "version": "v41"} → Cite as [GLT v41 - Reference]
- If scripture.citation = {"title": "Literal Text", "version": "v88"} → Cite as [Literal Text v88 - Reference]
- If questions.citation = {"resource": "es-419_tq", "version": "v38"} → Cite as [es-419_tq v38 - Reference]
- ALWAYS extract resource name and version from the citation object, never assume!
```

**Python: `packages/shared-prompts/python/prompts.py`**
- Applied identical changes to maintain consistency between TypeScript and Python implementations

---

### 2. MCP Prompt Templates (User Messages)

**File: `src/mcp/prompts-registry.ts`**

#### A. translation-helps-for-passage Prompt

**Added Citation Requirements Section:**
```typescript
**CITATION REQUIREMENTS**: Every resource returned includes a citation object. You MUST:
1. Read the citation object from each response
2. Extract citation.resource or citation.title for the resource name
3. Extract citation.version for the version number
4. Cite scripture and all resources using this format: [Resource Version - Reference]
5. NEVER assume resource names (like "ULT") - always read from citation object

Example: If citation = {"resource": "glt", "title": "Texto Puente Literal", "version": "v41"}, 
cite as [GLT v41 - Reference] or [Texto Puente Literal v41 - Reference]
```

**Updated Step Instructions:**

Before:
```typescript
1. **Get the Scripture Text:**
   - Use fetch_scripture tool with reference="${reference}" and language="${language}"
   - IMPORTANT: Ensure reference uses 3-letter code (e.g., "JHN 3:16" not "John 3:16")
   - This provides the actual Bible text to work with
```

After:
```typescript
1. **Get the Scripture Text:**
   - Use fetch_scripture tool with reference="${reference}" and language="${language}"
   - IMPORTANT: Ensure reference uses 3-letter code (e.g., "JHN 3:16" not "John 3:16")
   - Read scripture.citation object from the response
   - Cite scripture using: [citation.resource version - ${reference}] (e.g., [GLT v41 - ${reference}])
   - This provides the actual Bible text to work with
```

Similar updates for:
- Translation Questions (step 2)
- Translation Notes (step 4)

**Updated Final Step:**
```typescript
6. **Organize the Response:**
   Present everything in a clear, structured way with proper citations:
   - Scripture text at the top with citation: [Resource Version - Reference]
   - List of translation word titles (dictionary entries) with citations
   - Translation questions for comprehension with citation
   - Translation notes with guidance with citation
   - Related academy article titles for deeper learning with citations

**REMEMBER**: Always read and use the citation object from each response. Never assume resource names like "ULT" or "UST".
```

#### B. get-translation-words-for-passage Prompt

Added:
```typescript
**CITATION REQUIREMENTS**: Each translation word article includes a citation object. 
Always read and cite using [citation.resource version - term] format.
```

#### C. get-translation-academy-for-passage Prompt

Added:
```typescript
**CITATION REQUIREMENTS**: Each academy article includes a citation object. 
Always read and cite using [citation.resource version - article] format.
```

---

## Impact Analysis

### What Changed
1. **System Prompts**: LLM now receives explicit instructions to read citation objects
2. **MCP Prompts**: User-role messages now include detailed citation handling instructions
3. **Response Format**: LLMs will now cite actual resources (GLT, GST, es-419_tn, etc.) instead of assuming "ULT"

### What Didn't Change
- No changes to MCP tool outputs (citations were already correct)
- No changes to API response structures
- No changes to core services or data fetching logic
- No changes to HTTP endpoints

### Affected Workflows
- **MCP Prompts**: `translation-helps-for-passage`, `get-translation-words-for-passage`, `get-translation-academy-for-passage`
- **Individual Tools**: All tools that return citation objects (fetch_scripture, fetch_translation_notes, fetch_translation_questions, fetch_translation_word, fetch_translation_academy)
- **Languages**: All languages (en, es-419, fr, pt-BR, etc.)

---

## Testing Instructions

### Test Case 1: Spanish Scripture Citation
```bash
# MCP Prompt call
prompt: translation-helps-for-passage
args: {reference: "TIT 3:11-15", language: "es-419"}

# Expected LLM Response:
✅ Should cite as: [GLT v41 - Tito 3:11-15] or [Texto Puente Literal v41 - Tito 3:11-15]
❌ Should NOT cite as: [ULT - Tito 3:11-15]
```

### Test Case 2: Spanish Translation Questions
```bash
# Expected citation format:
✅ [es-419_tq v38 - Tito 3:11-15]
❌ [TQ v38 - Tito 3:11-15]
```

### Test Case 3: Spanish Translation Notes
```bash
# Expected citation format:
✅ [es-419_tn v66 - Tito 3:11-15]
❌ [TN v66 - Tito 3:11-15]
```

### Test Case 4: English Resources (Should Still Work)
```bash
# MCP Prompt call
prompt: translation-helps-for-passage
args: {reference: "JHN 3:16", language: "en"}

# Expected citations:
✅ [ULT v86 - John 3:16] (if ULT is the actual resource)
✅ [en_tn v86 - John 3:16] (for translation notes)
```

### Manual Testing with MCP Inspector
1. Start MCP Inspector: `npx @modelcontextprotocol/inspector dist/index.js`
2. Test `translation-helps-for-passage` prompt with Spanish reference
3. Verify LLM response cites actual resources (GLT, es-419_tn, etc.)
4. Check that LLM doesn't say "ULT" for non-ULT resources

---

## Verification Checklist

- [x] Updated TypeScript shared-prompts package
- [x] Updated Python shared-prompts package
- [x] Updated MCP prompt templates for translation-helps-for-passage
- [x] Updated MCP prompt templates for get-translation-words-for-passage
- [x] Updated MCP prompt templates for get-translation-academy-for-passage
- [ ] Test with real MCP client (Claude/other)
- [ ] Verify Spanish resources cited correctly
- [ ] Verify English resources still cited correctly
- [ ] Verify all resource types (scripture, notes, questions, words, academy)

---

## Related Documentation

- [CITATION_METADATA_FIX.md](./CITATION_METADATA_FIX.md) - Backend fixes for citation data
- [PROMPT_CITATION_FIX.md](./PROMPT_CITATION_FIX.md) - Execute-prompt endpoint fixes

---

## Status: ✅ READY FOR TESTING

All prompt instructions have been updated. The LLM should now correctly read and use citation metadata from MCP responses.

## 🆕 NEW: Condensed Report Prompt

**IMPORTANT UPDATE**: A new prompt `translation-helps-report` was created to address context overload issues.

**Problem**: The comprehensive prompt returns 50,000+ characters of data (full articles), which can:
- Overwhelm the LLM's context window
- Make it hard for LLM to properly cite everything
- Be difficult for users to consume

**Solution**: New condensed prompt that returns:
- ✅ Scripture (full text)
- ✅ Questions (full - already short)
- 📋 Notes (ONLY quote + academy link)
- 📋 Key terms (ONLY titles)
- 📋 Academy articles (ONLY titles)

**Result**: ~2,000-3,000 characters instead of 50,000+ (96% reduction!)

**See**: [CONDENSED_REPORT_PROMPT.md](./CONDENSED_REPORT_PROMPT.md) for full details.

**Recommendation**: Use `translation-helps-report` as the default prompt, only use `translation-helps-for-passage` when user explicitly wants full articles.

**Next Step**: Test with actual MCP client to verify LLM behavior.
