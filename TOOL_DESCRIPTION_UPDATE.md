# Tool Description Update - 3-Letter Book Codes

**Date:** March 12, 2026  
**Update:** Added 3-letter book code guidance to all reference-based tool descriptions

---

## Summary

Updated all MCP tool descriptions to include guidance on using **3-letter book codes** for Bible references, following the standard format used by Bible translation tools.

---

## Updated Tools

### 1. fetch_scripture
**Before:**
```
"Fetch Bible text for specific verses, passages, or chapters. 
Supports formats like 'John 3:16', 'Genesis 1:1-3', or 'Matthew 5'."
```

**After:**
```
"Fetch Bible text for specific verses, passages, or chapters. 
Use 3-letter book codes: GEN (Genesis), JHN (John), 3JN (3 John). 
Examples: 'JHN 3:16', 'GEN 1:1-3', 'MAT 5'."
```

### 2. fetch_translation_notes
**Before:**
```
"Fetch translator notes explaining difficult passages, cultural context, 
and translation recommendations for specific Bible verses."
```

**After:**
```
"Fetch translator notes explaining difficult passages, cultural context, 
and translation recommendations. Use 3-letter book codes: GEN, JHN, 3JN, etc."
```

### 3. fetch_translation_questions
**Before:**
```
"Fetch comprehension questions with answers to verify 
translation accuracy for Bible passages."
```

**After:**
```
"Fetch comprehension questions with answers to verify translation accuracy. 
Use 3-letter book codes: GEN, JHN, 3JN, etc."
```

### 4. fetch_translation_word_links
**Before:**
```
"Fetch list of key biblical terms found in a passage 
(like 'grace', 'faith', 'covenant') with links to full definitions."
```

**After:**
```
"Fetch list of key biblical terms found in a passage 
(like 'grace', 'faith', 'covenant') with links to definitions. 
Use 3-letter book codes: GEN, JHN, 3JN, etc."
```

---

## Parameter Descriptions Updated

All `reference` parameter descriptions now specify:
```typescript
'Bible reference using 3-letter book code (e.g., "JHN 3:16", "GEN 1:1-3", "MAT 5")'
```

Instead of:
```typescript
'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")'
```

---

## Common 3-Letter Book Codes

| Full Name | 3-Letter Code | Example Reference |
|-----------|---------------|-------------------|
| Genesis | GEN | GEN 1:1 |
| Exodus | EXO | EXO 20:1-17 |
| Matthew | MAT | MAT 5:1-12 |
| John | JHN | JHN 3:16 |
| Romans | ROM | ROM 8:28 |
| 1 Corinthians | 1CO | 1CO 13:4-7 |
| 3 John | 3JN | 3JN 1:2 |
| Revelation | REV | REV 21:1-4 |

---

## Test Results

### REST API Endpoints: ✅ All 9 Passed
- Tests updated to use 3-letter codes (JHN, GEN, MAT)
- All endpoints accepting and processing codes correctly

### MCP Tools: ✅ All 9 Passed
- Tool descriptions properly exposed via `tools/list`
- All reference-based tools working with 3-letter codes

### Test Commands
```bash
# Test REST endpoints
bash test-all-endpoints.sh

# Test MCP tools
bash test-all-mcp-tools.sh
```

---

## Benefits

1. **Clear Format Guidance**: AI agents now know the exact format to use
2. **Consistency**: Aligns with Bible translation tool standards
3. **Examples Provided**: Concrete examples in descriptions help agents understand
4. **Backward Compatible**: System still accepts full book names for compatibility

---

## Files Modified

- `src/mcp/tools-registry.ts` - Updated tool descriptions and parameter descriptions
- `test-all-endpoints.sh` - Updated test examples to use 3-letter codes
- `test-all-mcp-tools.sh` - Updated test examples to use 3-letter codes

---

**Status:** All tools successfully updated and tested with 3-letter book code guidance.
