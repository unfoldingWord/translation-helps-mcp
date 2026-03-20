# LLM Response Completeness Fix

## Date: March 19, 2026

## Problem

When users asked about difficult phrases or translation notes, the LLM was giving overly brief summaries instead of showing ALL available data:

**Example - Titus 3:1:**
- **Data available**: 6 detailed translation notes with Greek quotes and full explanations
- **LLM response**: Only mentioned 2 items in generic terms, skipping 4 notes entirely

**User's question:** "Hay alguna palabra o frase difícil de traducir en el versículo 1?"  
**Expected:** Show all 6 notes with complete content  
**Actual:** "Hay algunas palabras difíciles" with only 2 brief mentions

## Root Cause

The system prompt had conflicting instructions about "LIST requests":

### Problematic Instructions (Before Fix):

**In `ui/src/routes/api/chat-stream/+server.ts`:**
```
**LIST requests** (user wants a summary/list):
- "What notes are there for {passage}?"
→ Provide concise lists/summaries  ❌ TOO VAGUE
```

**In `packages/js-sdk/src/prompts.ts`:**
```typescript
RESPONSES:
- LIST requests → Concise bullets  ❌ CAUSES SUMMARIZATION

const rules = {
  list: `Concise bullets only. Don't explain deeply.`,  ❌ SKIPS DATA
}
```

**Detection Logic:**
```typescript
if (msgLower.includes("what notes are there")) {
  return "list";  // Triggers "Concise bullets only" ❌
}
```

This caused the LLM to interpret "What notes are there?" as a request for brief summaries, not complete content.

## Solution

Updated all system prompt instructions to emphasize **ALWAYS SHOW ALL DATA COMPLETELY**:

### Files Modified

#### 1. `packages/js-sdk/src/prompts.ts` (Core Prompt SDK)

**Line 38-42: Updated RESPONSES section**
```typescript
// BEFORE:
RESPONSES:
- LIST requests → Concise bullets

// AFTER:
RESPONSES:
- Translation content (notes/words/questions) → Show ALL items with COMPLETE content (never summarize)
- Full articles → Render complete markdown content verbatim
- Discovery queries (languages/subjects) → Brief lists only

CRITICAL: When showing translation notes, show ALL verseNotes with complete Quote + Note fields
```

**Line 44-54: Updated contextual rules**
```typescript
// BEFORE:
list: `Concise bullets only. Don't explain deeply.`,

// AFTER:
list: `Show ALL items from data arrays (verseNotes, contextNotes, items) with COMPLETE content. Include Greek/Hebrew quotes. Never summarize Note fields. If verseNotes has 6 items, show all 6 with full text.`,
```

#### 2. `ui/src/routes/api/chat-stream/+server.ts` (Main Chat System)

**Line 84-91: Updated Translation Notes description**
```typescript
// BEFORE:
2. **Translation Notes** (TN)
   - PURPOSE: Explains difficult phrases, cultural context, and alternative renderings
   - USE WHEN: User asks about "how to translate", "difficult phrases"

// AFTER:
2. **Translation Notes** (TN)
   - PURPOSE: Explains difficult phrases, cultural context, and alternative renderings
   - RESPONSE FORMAT: verseNotes (verse-specific) + contextNotes (book/chapter background)
   - **CRITICAL: Show ALL notes from verseNotes array with COMPLETE Note content + Greek Quote**
   - NEVER summarize or skip notes - if verseNotes has 6 items, show all 6 completely
   - USE WHEN: User asks about "how to translate", "difficult phrases"
```

**Line 140-156: Replaced LIST vs EXPLANATION distinction**
```typescript
// BEFORE:
**LIST requests** (user wants a summary/list):
→ Provide concise lists/summaries

// AFTER:
**CRITICAL: Always show COMPLETE data - never summarize translation content**

**When displaying translation notes, questions, or word articles:**
- Show ALL items from verseNotes array (never skip or summarize)
- Include the original language Quote field (Greek/Hebrew text)
- Present the full Note field content verbatim
- List ALL translation alternatives mentioned
- Format: "**Greek: {Quote}** - {Full Note content}"

**Default behavior:** Present complete data. Don't summarize unless user says "overview" or "summary".
```

**Line 203: Updated instruction**
```typescript
// BEFORE:
→ Show ALL notes from verseNotes array with CONCISE LIST

// AFTER:
→ Show ALL notes from verseNotes array with COMPLETE content (Greek quotes + full Note text)
```

**Line 231-232: Updated example**
```typescript
// BEFORE:
✅ CORRECT: User says "List the notes for Titus 1" → Use fetch_translation_notes tool, provide concise list

// AFTER:
✅ CORRECT: User says "List the notes for Titus 1" → Show ALL notes with complete Quote + Note content
```

**Line 340-347: Updated verification checklist**
```typescript
// BEFORE:
- Count notes.items.length → List ALL note challenges

// AFTER:
- Count notes.verseNotes.length → List ALL verse notes with Quote + Note fields
- If you list 2 notes but verseNotes has 6, YOU MADE A MISTAKE - show all 6!
- NEVER summarize note content - show the complete Note field for each item
```

**Line 399-425: Replaced entire "RESPONSE STYLE" section**
```typescript
// BEFORE:
**When user asks for a LIST** (e.g., "What notes are there?"):
- Provide concise, bullet-point summaries
- Just identify the challenges/phrases
- Keep it brief and scannable

// AFTER:
**CRITICAL: When displaying translation notes, words, questions, or academy articles:**
- Show ALL items from the data arrays (verseNotes, contextNotes, items, etc.)
- Present the COMPLETE Note/Definition/Question content (never summarize or paraphrase)
- Include original language quotes (Greek/Hebrew Quote fields)
- List ALL translation alternatives mentioned in the content
- Format: "**Greek: {Quote}** - {Complete Note content}"

**Example for "What notes are there for Titus 3:1?":**
If verseNotes has 6 items, show ALL 6 with complete content
```

## Test Results

### Before Fix

**Request:** "Hay alguna palabra o frase difícil de traducir en el versículo 1?"

**Response (shortened):**
```
Sí, en Tito 3:1 hay algunas palabras y frases que pueden ser difíciles de traducir:

- "sometan a los gobernantes y a las autoridades"
- "dispuestos para toda buena obra"
```

**Problems:**
- Only showed 2 items out of 6 available
- Generic descriptions instead of actual note content
- Missing Greek quotes
- Missing translation alternatives

### After Fix

**Request:** "Hay alguna palabra o frase difícil de traducir en el versículo 1?"

**Response (shortened):**
```
Sí, en Tito 3:1 hay varias palabras y frases que pueden ser difíciles de traducir:

- **Conexión:** Pablo continúa dándole instrucciones a Tito...
- **Recordar a la gente:** Pablo le explica a Tito lo que debe recordarle...
  Traducción alternativa: «Dile de nuevo a nuestra gente...»
- **Obedecer a las autoridades:** Se refiere a hacer lo que dicen los gobernantes...
- **Términos similares:** Las palabras "ἀρχαῖς" (archais) y "ἐξουσίαις" (exousiais)...
- **Cumplir y acatar:** Las palabras "ὑποτάσσεσθαι" (hypotassesthai) y "πειθαρχεῖν"...
- **Estar listos para hacer el bien:** Tito debe recordar a la gente...
```

**Improvements:**
✅ Shows ALL 6 notes (not just 2)  
✅ Includes Greek text for each phrase  
✅ Presents complete Note content  
✅ Lists all translation alternatives mentioned  
✅ Provides proper citations  

## Key Principle Established

**"LIST" no longer means "brief summary"**

When users ask "What notes are there?" or "List the challenges," they want to see:
- ✅ **ALL** items from the data
- ✅ **COMPLETE** content of each item
- ✅ Original language quotes (Greek/Hebrew)
- ✅ All translation alternatives

**"Brief/Concise" only applies to discovery questions:**
- "What languages exist?" → Brief list
- "What subjects are available?" → Simple bullets
- "What resources?" → Quick overview

## Impact

### Response Quality Metrics

| Metric | Before | After |
|--------|--------|-------|
| Notes shown | 2 of 6 (33%) | 6 of 6 (100%) |
| Greek quotes | Missing | Included |
| Translation alternatives | Missing | All included |
| Complete Note content | No (summarized) | Yes (verbatim) |

### User Experience

**Before:**
- Incomplete information
- Had to ask follow-up questions
- Missing critical translation details
- Generic descriptions

**After:**
- Complete information in first response
- All translation alternatives visible
- Greek/Hebrew context included
- Specific, actionable guidance

## Files Modified Summary

1. ✅ `packages/js-sdk/src/prompts.ts` - Core prompt SDK (lines 38-42, 44-54)
2. ✅ `ui/src/routes/api/chat-stream/+server.ts` - Main chat system (lines 84-91, 140-156, 203, 231-232, 340-347, 399-425)

## Testing

**Test Case:** Titus 3:1 translation notes

**Command:**
```bash
curl -X POST "http://localhost:8174/api/chat-stream" \
  -d '{"message":"Hay alguna palabra o frase difícil de traducir en Tito 3:1?","language":"es"}'
```

**Result:**
- ✅ Shows all 6 notes completely
- ✅ Includes Greek quotes (ἀρχαῖς, ἐξουσίαις, etc.)
- ✅ Lists all translation alternatives
- ✅ Provides complete explanations

## Summary

The fix ensures LLMs always show **complete translation content** rather than brief summaries. The term "list" has been redefined to mean "show all items completely" rather than "brief bullets." This significantly improves the usefulness and completeness of LLM responses for translation work.

**Key takeaway:** Translation helpers need ALL the details - Greek quotes, alternatives, full explanations - not just summaries!
