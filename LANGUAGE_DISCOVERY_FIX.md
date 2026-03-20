# Language Discovery Fix

## Problem

User reported a 400 error when asking "show me john 3:16 in spanish":

```json
{
  "reference": "JHN 3:16",
  "language": "es-419",
  "organization": "unfoldingWord",
  "format": "json"
}
```

**Error:** `Tool endpoint failed: 400`

### Root Cause

The LLM was:
1. ✅ Detecting "Spanish" correctly
2. ✅ Mapping to `es-419` 
3. ❌ Going **straight to fetch_scripture** with `organization: "unfoldingWord"`
4. ❌ **That specific org/language combo doesn't exist** → 400 error

The simplified prompt told the LLM to "go directly to the tool" when it detected a language, but it didn't distinguish between:
- **Exact code** (user says "es-419") → Can fetch directly
- **Generic language** (user says "Spanish") → Must discover first

## Solution

Updated the prompt to distinguish between exact codes and generic language requests:

### 1. **Main Language Handling Section**

**Before:**
```
**LANGUAGE HANDLING:**

1. When user EXPLICITLY provides language code → Go DIRECTLY to the tool
2. When user speaks different language → Call list_languages
3. When user asks "what languages?" → Call list_languages

Don't over-discover!
```

**After:**
```
**LANGUAGE HANDLING:**

1. When user EXPLICITLY provides EXACT language code (e.g., "es-419"):
   - Go DIRECTLY to the requested tool
   - Use the provided code as-is
   - Do NOT call list_languages first

2. When user requests GENERIC language (e.g., "in Spanish") WITHOUT exact code:
   - Call list_resources_for_language with language="es" to discover what's available
   - If only ONE resource found → Use it immediately
   - If MULTIPLE found → Let user choose organization

3. When user speaks different language but doesn't specify what they want:
   - Call list_languages to discover available variants

4. When user asks "what languages are available?":
   - Call list_languages to show all available languages

**IMPORTANT**: 
- Exact code (es-419) → Fetch directly
- Generic language (Spanish) → Discover first, then fetch
- Don't assume organization exists for a language - always discover first
```

### 2. **LLM Decision Making Prompt (determineMCPCalls)**

Added new section before "CRITICAL DECISION RULES":

```
**LANGUAGE REQUEST HANDLING:**

When user requests a resource in a specific language:

1. **Exact language code provided** (e.g., "in Spanish (es-419)"):
   - User knows exactly what they want
   - Go DIRECTLY to the tool (e.g., fetch_scripture)
   - Use the exact code provided
   - Do NOT call discovery tools first

2. **Generic language name** (e.g., "in Spanish", "in French"):
   - User wants the language but doesn't know what's available
   - MUST call list_resources_for_language FIRST to discover what exists
   - Extract base language code (Spanish → "es", French → "fr")
   - Example: "Show me John 3:16 in Spanish" → Call list_resources_for_language(language="es") first
   - Then use the discovered resource to fetch

3. **Why discovery is needed for generic requests:**
   - Different organizations have different language variants
   - es-419 might exist for org1 but not org2
   - Must discover what's actually available before fetching
   - Prevents 400/404 errors
```

### 3. **Language Detection Context (3 locations)**

Updated all language detection context injections:

**Before:**
```
**LANGUAGE DETECTED:** es-419
- If user provided explicit language code → Use it directly
- If user speaking different language → Call list_languages
```

**After:**
```
**LANGUAGE DETECTED:** es-419
- Exact code (es-419) → Fetch directly
- Generic language (Spanish) → Call list_resources_for_language first
- Speaking different language → Call list_languages to find variants
```

## Expected Behavior

### Test Case 1: Exact Language Code (UNCHANGED)
```
User: "Show me John 3:16 in Spanish (es-419)"

LLM Flow:
1. Sees exact code "es-419"
2. Goes DIRECTLY to fetch_scripture
3. Uses language="es-419", organization="unfoldingWord"
4. ✅ Works if exists, or returns 400 with clear error
```

### Test Case 2: Generic Language (FIXED)
```
User: "Show me John 3:16 in Spanish"

OLD Flow (broken):
1. Detects "Spanish"
2. Maps to "es-419"
3. Goes straight to fetch_scripture with unfoldingWord
4. ❌ 400 error because unfoldingWord doesn't have es-419

NEW Flow (fixed):
1. Detects "Spanish" (generic)
2. Calls list_resources_for_language(language="es")
3. Discovers available Spanish resources:
   - es-419 from organization "es-419_gl"
   - es-419 from organization "BSA"
   - etc.
4. Picks first available or asks user to choose
5. Fetches scripture with correct org/language combo
6. ✅ Works!
```

### Test Case 3: User Speaking Spanish (UNCHANGED)
```
User: "Muéstrame Juan 3:16"

LLM Flow:
1. Detects user speaking Spanish
2. Calls list_languages to discover variants
3. Finds es-419, es-MX, etc.
4. Asks user to choose (if multiple) or proceeds (if only one)
5. ✅ Works correctly
```

## Changes Made

### File: `ui/src/routes/api/chat-stream/+server.ts`

1. **Lines 609-638** - Updated main language handling section
   - Added distinction between exact codes and generic language
   - Added explicit instruction to use `list_resources_for_language` for generic requests

2. **Lines 686-708** - Added new "LANGUAGE REQUEST HANDLING" section
   - Explains when to discover vs when to fetch directly
   - Provides clear examples of both cases
   - Explains WHY discovery is needed (prevents 400 errors)

3. **Lines 1553-1555** - Updated language detection context (non-streaming)
   - Simplified to "Exact code → Fetch" vs "Generic → Discover"

4. **Lines 1707-1709** - Updated language detection context (streaming callOpenAI)
   - Same simplification

5. **Lines 2062-2064** - Updated language detection context (streaming debug)
   - Same simplification

## Testing

**Dev Server:** `http://localhost:8177/chat`

### Test Script

1. **Generic Language (should now work):**
   ```
   "Show me John 3:16 in Spanish"
   
   Expected:
   - Calls list_resources_for_language(language="es")
   - Discovers available Spanish orgs
   - Fetches from available org
   - ✅ Returns scripture successfully
   ```

2. **Exact Code (should still work):**
   ```
   "Show me John 3:16 in Spanish (es-419)"
   
   Expected:
   - Goes straight to fetch_scripture
   - Uses language="es-419"
   - ✅ Works if exists, or clear error if not
   ```

3. **User Speaking Spanish (should still work):**
   ```
   "Muéstrame Juan 3:16"
   
   Expected:
   - Calls list_languages
   - Discovers variants
   - Proceeds or asks user to choose
   - ✅ Works correctly
   ```

### Debug Console Verification

**For "Show me John 3:16 in Spanish":**

**OLD (broken):**
```
MCP TOOL: fetch_scripture
Status: 500 (400 from server)
Params: {
  "language": "es-419",
  "organization": "unfoldingWord"  ← WRONG ORG
}
```

**NEW (fixed):**
```
MCP TOOL: list_resources_for_language
Status: 200
Params: {
  "language": "es"  ← Discovery first
}
Response: [
  { organization: "es-419_gl", ... },
  { organization: "BSA", ... }
]

THEN:

MCP TOOL: fetch_scripture
Status: 200
Params: {
  "language": "es-419",
  "organization": "es-419_gl"  ← CORRECT ORG (discovered)
}
```

## Key Insight

The problem wasn't the interceptor or the language detection - those were working correctly. The issue was:

**The LLM needed to understand the difference between:**
- `"in Spanish (es-419)"` → User knows exact resource = fetch directly
- `"in Spanish"` → User wants Spanish but doesn't know variants = discover first

Previously, the prompt said "if you detect language, go straight to fetch" which caused the LLM to assume organizations existed when they didn't.

Now it says:
- **Exact code** = fetch directly
- **Generic name** = discover first, **then** fetch

## Impact

✅ **Fixes:** Generic language requests like "in Spanish", "in French"
✅ **Maintains:** Exact code requests like "in es-419", "in fr"
✅ **Maintains:** Speaking different language detection
✅ **Prevents:** 400 errors from assuming org/language combos exist
✅ **Better UX:** Discovers what's actually available before fetching

## Related Issues

This fix addresses the fundamental issue of **resource discovery** vs **direct fetching**:

1. **Before:** LLM assumed all languages existed for all organizations
2. **After:** LLM discovers what's available before fetching

This same pattern applies to:
- Translation notes
- Translation words
- Translation questions
- Translation academy
- Any resource that varies by language/organization

---

**Date:** 2026-03-13
**Issue:** 400 error when requesting generic language ("in Spanish")
**Root Cause:** LLM going straight to fetch without discovering available organizations
**Fix:** Added distinction between exact codes (fetch directly) and generic languages (discover first)
**Result:** Generic language requests now work correctly by discovering available resources first
