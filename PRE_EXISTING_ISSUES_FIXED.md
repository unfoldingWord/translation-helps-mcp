# Pre-Existing Issues - Fixed

This document details the two pre-existing bugs that were identified and fixed during validation testing.

---

## Issue 1: `list_subjects` Returns Empty Array

### Problem
The `list_subjects` tool/endpoint was returning 0 subjects even when the DCS catalog API returned 12 subjects for English.

### Root Cause
The DCS catalog API `/api/v1/catalog/list/subjects` returns an **array of strings**, but our code was expecting an **array of objects** with `name` properties:

```typescript
// ❌ BEFORE: Expected objects with .name property
for (const subject of subjectData) {
  if (subject.name) {  // This check always failed!
    const resourceType = mapSubjectToResourceType(subject.name);
    subjects.push({
      name: subject.name,
      // ...
    });
  }
}
```

**DCS API Response:**
```json
{
  "data": [
    "Aligned Bible",
    "Bible",
    "Open Bible Stories",
    "Translation Academy",
    // ... 8 more string values
  ],
  "ok": true
}
```

### Solution
Updated the parsing logic in `src/tools/listSubjects.ts` to handle both string and object formats:

```typescript
// ✅ AFTER: Handles both strings and objects
for (const subject of subjectData) {
  const subjectName = typeof subject === "string" ? subject : subject.name;
  if (subjectName) {
    const resourceType = mapSubjectToResourceType(subjectName);
    subjects.push({
      name: subjectName,
      description: typeof subject === "object" ? subject.description : undefined,
      resourceType,
      count: typeof subject === "object" ? subject.count : undefined,
    });
  }
}
```

### Verification
```bash
# Before fix
$ curl "http://localhost:8180/api/list-subjects?language=en&organization=unfoldingWord"
{"subjects":[],"count":0}  # ❌ Empty!

# After fix
$ curl "http://localhost:8180/api/list-subjects?language=en&organization=unfoldingWord"
{"subjects":[{"name":"Aligned Bible",...}],"count":12}  # ✅ Works!
```

### Additional Fix
Also added missing `topic` parameter to REST endpoint configuration in `ui/src/routes/api/list-subjects/+server.ts`.

---

## Issue 2: Translation Academy Returns Empty When Using `moduleId` Without Path Prefix

### Problem
The `fetch_translation_academy` endpoint returned empty content when called with `moduleId=figs-metaphor`, but worked with `rcLink=rc://*/ta/man/translate/figs-metaphor`.

### Root Cause
Translation Academy modules in the DCS ZIP archives are organized in category subdirectories:
- `translate/figs-metaphor/`
- `checking/alphabet/`
- `process/process-manual/`
- `intro/finding-answers/`

When only `moduleId` was provided (e.g., `"figs-metaphor"`), the code wasn't constructing the full path with the category prefix, so it couldn't find the module.

### Solution
Updated `src/functions/translation-academy-service.ts` to automatically construct the path with the `translate/` prefix for simple module IDs:

```typescript
// ✅ NEW: Construct path for simple moduleId
} else if (moduleId) {
  // If only moduleId is provided (e.g., "figs-metaphor"), 
  // construct the path by defaulting to "translate" category
  // Most TA articles are in translate/, with some in checking/ and process/
  if (!moduleId.includes('/')) {
    finalPath = `translate/${moduleId}`;
    logger.info(`Constructed TA path from moduleId`, {
      moduleId,
      constructedPath: finalPath,
    });
  } else {
    finalPath = moduleId;
  }
}
```

### Verification
```bash
# Before fix
$ curl "http://localhost:8180/api/fetch-translation-academy?moduleId=figs-metaphor&language=en"
{"content":"","title":"N/A"}  # ❌ Empty!

# After fix  
$ curl "http://localhost:8180/api/fetch-translation-academy?moduleId=figs-metaphor&language=en"
{"title":"Metaphor","content":"# Metaphor\n\n## What is...","moduleId":"figs-metaphor"}  # ✅ 17,604 chars!
```

### Supported Formats
The endpoint now supports all three parameter formats:
1. **Simple moduleId**: `moduleId=figs-metaphor` → auto-constructs `translate/figs-metaphor`
2. **Full path with category**: `moduleId=translate/figs-metaphor` → uses as-is
3. **RC Link**: `rcLink=rc://*/ta/man/translate/figs-metaphor` → parses to `translate/figs-metaphor`

---

## Build System Fix

### Problem
Build was failing due to missing individual named exports from `ui/src/lib/mcp/node-stubs.ts`:
```
"homedir" is not exported by "node-stubs.ts"
"mkdirSync" is not exported by "node-stubs.ts"
```

### Root Cause
Code was importing individual functions:
```typescript
import { homedir } from 'os';
import { readFileSync, existsSync } from 'fs';
```

But the stubs only exported full objects:
```typescript
export const os = { homedir: () => '/tmp', ... };
export const fs = { readFileSync: () => '', ... };
```

### Solution
Added individual named exports to `ui/src/lib/mcp/node-stubs.ts`:

```typescript
// Export individual os functions
export const homedir = osStub.homedir;
export const tmpdir = osStub.tmpdir;
export const platform = osStub.platform;
// ...

// Export individual fs functions
export const readFileSync = fsStub.readFileSync;
export const writeFileSync = fsStub.writeFileSync;
export const existsSync = fsStub.existsSync;
export const mkdirSync = fsStub.mkdirSync;
// ...
```

---

## Testing Summary

### Before Fixes
- ❌ `list_subjects`: 0 subjects
- ❌ `fetch_translation_academy` with moduleId: Empty content
- ❌ Build: Failed due to missing exports

### After Fixes
- ✅ `list_subjects`: 12 subjects returned
- ✅ `fetch_translation_academy` with moduleId: 17,604 chars (full content)
- ✅ `fetch_translation_academy` with rcLink: 17,604 chars (full content)
- ✅ Build: Successful
- ✅ Both REST API and MCP tools: Verified working

### Files Modified
1. `src/tools/listSubjects.ts` - Handle string array responses from catalog API
2. `src/functions/translation-academy-service.ts` - Auto-construct translate/ prefix for simple moduleIds
3. `ui/src/routes/api/list-subjects/+server.ts` - Add missing topic parameter
4. `ui/src/lib/mcp/node-stubs.ts` - Export individual fs/os functions

---

## Verification Commands

```bash
# Test list_subjects
curl "http://localhost:8180/api/list-subjects?language=en&organization=unfoldingWord"
# Expected: 12 subjects including "Aligned Bible", "Translation Academy", etc.

# Test fetch_translation_academy with moduleId
curl "http://localhost:8180/api/fetch-translation-academy?moduleId=figs-metaphor&language=en"
# Expected: 17,604 chars with title "Metaphor"

# Test fetch_translation_academy with rcLink
curl "http://localhost:8180/api/fetch-translation-academy?rcLink=rc://*/ta/man/translate/figs-metaphor&language=en"
# Expected: Same 17,604 chars with title "Metaphor"
```

All fixes have been validated and are working correctly in both REST API and MCP tool contexts.
