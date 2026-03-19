# Scripture Metadata Structure Fix

## Problem Identified

The scripture endpoint had several major issues:

1. **Hardcoded values in top-level metadata** - `subject: "Bible"` and `license: "CC BY-SA 4.0"` were hardcoded instead of being derived from actual resource data
2. **Data duplication** - `language` and `organization` appeared in both `citation` and `metadata` objects
3. **Missing per-resource metadata** - Each scripture resource should have its own metadata with dynamic subject
4. **TSV resources using "master" branch** - Translation Notes, Questions, and Word Links were showing `version: "master"` instead of proper release tags like `v88`
5. **Missing titles in per-item citations** - Per-item citations were missing the dynamic `title` field from the DCS catalog

## Solution Implemented

### 1. Per-Resource Metadata Structure

Each scripture resource now includes its own `metadata` object with:
- `resourceType`: Always `"scripture"`
- `subject`: Dynamically retrieved from DCS catalog (e.g., `"Bible"`, `"Aligned Bible"`)
- `license`: `"CC BY-SA 4.0"`

**No duplication** - `language` and `organization` only appear in `citation`, not in `metadata`.

### 2. Dynamic Version Extraction

TSV-based resources (Translation Notes, Translation Questions, Translation Word Links) now:
- Extract version from DCS catalog via `resolveRefAndZip()`
- Return version in `getTSVData()` result
- Use dynamic version in citations instead of hardcoded `"master"`

### 3. Dynamic Title in Citations

All per-item citations now include the `title` field:
- Extracted from DCS catalog resource metadata
- Different for each resource (e.g., "unfoldingWord® Literal Text", "Translation for Translators")
- Propagated to per-item citations in TN, TQ, and Scripture

### 4. Top-Level Metadata Cleanup

Top-level metadata is now minimal with no hardcoded values:
- Removed hardcoded `subject: "Bible"`
- Removed hardcoded `license: "CC BY-SA 4.0"`
- Kept only aggregate information: `resourceType`, `language`, `organization`, `resources[]`, `organizations[]`

## Before & After

### Before (Problematic)

```json
{
  "scripture": [
    {
      "text": "...",
      "translation": "T4T v1",
      "citation": {
        "resource": "t4t",
        "organization": "unfoldingWord",
        "language": "en",
        "url": "...",
        "version": "v1"
      }
    }
  ],
  "metadata": {
    "resourceType": "scripture",
    "subject": "Bible",           // ❌ HARDCODED
    "language": "en",
    "organization": "multiple",
    "license": "CC BY-SA 4.0",    // ❌ HARDCODED
    "resources": ["ULT v88", ...]
  }
}
```

**Translation Notes Before:**
```json
{
  "citation": {
    "resource": "en_tn",
    "organization": "unfoldingWord",
    "language": "en",
    "version": "master",          // ❌ BRANCH NAME, NOT RELEASE
    "url": "..."
  }
}
```

### After (Fixed)

```json
{
  "scripture": [
    {
      "text": "...",
      "translation": "T4T v1",
      "citation": {
        "resource": "t4t",
        "organization": "unfoldingWord",
        "language": "en",             // ✅ ONLY IN CITATION
        "url": "...",
        "version": "v1"
      },
      "metadata": {
        "resourceType": "scripture",
        "subject": "Bible",            // ✅ FROM DCS CATALOG
        "license": "CC BY-SA 4.0"     // ✅ NO DUPLICATION
      }
    }
  ],
  "counts": {
    "totalCount": 4,
    "foundResources": ["ult", "ust", "t4t", "bsb"]
  },
  "metadata": {
    "resourceType": "scripture",
    "language": "en",                  // ✅ AGGREGATE INFO
    "organization": "multiple",
    "resources": ["ULT v88", ...],
    "organizations": ["unfoldingWord", "Worldview"]
  }
}
```

**Translation Notes After:**
```json
{
  "citation": {
    "resource": "en_tn",
    "organization": "unfoldingWord",
    "language": "en",
    "version": "v88",                  // ✅ RELEASE TAG FROM CATALOG
    "url": "..."
  }
}
```

## Key Benefits

1. **Semantic Clarity**
   - `citation`: Information for citing/referencing the source
   - `metadata`: Resource classification and licensing
   - No overlap between the two

2. **Dynamic Data**
   - `subject` retrieved from DCS catalog API (not hardcoded)
   - Different resources can have different subjects (e.g., "Bible" vs "Aligned Bible")
   - `version` extracted from catalog tags (not hardcoded to "master")

3. **No Duplication**
   - `language` and `organization` appear only in `citation`
   - Per-resource metadata is minimal and focused

4. **Proper Versioning**
   - All TSV resources now show release tags (e.g., `v88`) instead of branch names (`master`)
   - Versions are dynamically extracted from DCS catalog metadata

## Files Modified

### Core Infrastructure
- `src/services/ZipResourceFetcher2.ts`
  - Updated `getScripture()` return type to include per-resource metadata
  - Added `subject` to scripture result type
  - Added metadata with dynamic subject to both cache hit and miss paths
  - Updated `getTSVData()` to return version from catalog
  - Extract version from first target's refTag

### Type Definitions
- `ui/src/lib/unifiedResourceFetcher.ts`
  - Updated `ScriptureResult` interface to include metadata (resourceType, subject, license only)
  - Updated `TSVResult` interface to include version

### Response Formatters
- `ui/src/lib/standardResponses.ts`
  - Removed hardcoded `subject` from top-level metadata
  - Removed hardcoded `license` from top-level metadata
  - Kept per-resource metadata in scripture items

### Service Functions
- `src/functions/translation-notes-service.ts`
  - Extract version from tsvResult
  - Use dynamic version in per-note citations (multi-resource path)
  - Use dynamic version in top-level citation (single-resource path)

- `src/functions/translation-questions-service.ts`
  - Extract version from tsvResult
  - Use dynamic version in per-question citations (multi-resource path)
  - Use dynamic version in top-level citation (single-resource path)

- `src/functions/word-links-service.ts`
  - Extract version from tsvResult
  - Use dynamic version in citation

## Testing

Created `test-scripture-metadata-fix.sh` to validate:
- ✅ Per-resource metadata structure
- ✅ No field duplication in per-resource metadata
- ✅ Dynamic subject from catalog
- ✅ No hardcoded values in top-level metadata
- ✅ Dynamic versions (not "master") for all TSV resources

All tests pass successfully.

## Impact

### Breaking Changes
None - This is purely additive and cleanup:
- Added per-resource `metadata` field to scripture items
- Removed hardcoded values from top-level metadata
- Fixed version extraction to use release tags instead of branch names

### Agent Benefits
- Each scripture resource is fully self-describing with its own metadata
- Agents can identify resource type, subject, and license for each scripture independently
- Proper versioning allows agents to identify exact resource versions
- No need to reference top-level metadata for per-resource information

### Consistency
Now all endpoints follow the same pattern:
- Dynamic data from DCS catalog (not hardcoded)
- Proper version tags from releases (not branch names)
- Clear separation between citation and metadata
- Per-item metadata where appropriate
- Dynamic titles in all per-item citations

## Complete Examples

### Scripture Resource (After All Fixes)

```json
{
  "text": "For God so loved the world...",
  "translation": "ULT v88",
  "citation": {
    "resource": "ult",
    "title": "unfoldingWord® Literal Text",     // ✅ DYNAMIC FROM CATALOG
    "organization": "unfoldingWord",
    "language": "en",
    "version": "v88",                          // ✅ DYNAMIC FROM CATALOG
    "url": "https://git.door43.org/unfoldingWord/en_ult/archive/v88.zip"
  },
  "metadata": {
    "resourceType": "scripture",
    "subject": "Aligned Bible",                 // ✅ DYNAMIC FROM CATALOG
    "license": "CC BY-SA 4.0"
  }
}
```

### Translation Note (After All Fixes)

```json
{
  "Reference": "3:16",
  "ID": "vg6z",
  "Note": "**For** here indicates...",
  "Quote": "γὰρ",
  "Occurrence": "1",
  "Occurrences": "0",
  "externalReference": {
    "target": "ta",
    "path": "translate/grammar-connect-logic-result"
  },
  "citation": {
    "resource": "en_tn",
    "title": "unfoldingWord® Translation Notes",  // ✅ DYNAMIC FROM CATALOG
    "organization": "unfoldingWord",
    "language": "en",
    "version": "v88",                           // ✅ DYNAMIC FROM CATALOG (not "master")
    "url": "https://git.door43.org/unfoldingWord/en_tn"
  }
}
```

### Translation Question (After All Fixes)

```json
{
  "ID": "abc123",
  "Reference": "3:16",
  "Question": "How did God show he loved the world?",
  "Response": "He showed his love by giving his Only Son...",
  "Tags": "",
  "citation": {
    "resource": "en_tq",
    "title": "unfoldingWord® Translation Questions", // ✅ DYNAMIC FROM CATALOG
    "organization": "unfoldingWord",
    "language": "en",
    "version": "v88",                              // ✅ DYNAMIC FROM CATALOG (not "master")
    "url": "https://git.door43.org/unfoldingWord/en_tq"
  }
}
```

## Key Takeaways

1. **All data is now dynamic** - title, subject, and version come from the DCS catalog API
2. **No duplication** - language/organization only in citation, not in metadata
3. **Semantic clarity** - citation is for referencing, metadata is for classification
4. **Proper versioning** - Release tags (v88) instead of branch names (master)
5. **Self-describing resources** - Each item has complete information about its source
