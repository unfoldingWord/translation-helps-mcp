# New Prompt: translation-helps-report (Condensed Report)

## Problem Statement

The existing `translation-helps-for-passage` prompt returns **massive amounts of data** including:
- Full translation word articles (3,000+ characters each)
- Full translation academy articles (5,000+ characters each)
- This can total 50,000+ characters for a single passage!

**Issues This Causes:**
1. ❌ Overwhelms LLM's context window
2. ❌ Makes it hard for LLM to properly process and cite everything
3. ❌ Difficult for users to consume all the content
4. ❌ LLM may fail to cite resources correctly due to context overload

## Solution: Condensed Report Prompt

Created a new prompt: **`translation-helps-report`**

### What It Returns

**FULL CONTENT:**
- ✅ Scripture text (this is the main content users need)
- ✅ Translation Questions (already concise - 1-2 sentences each)

**CONDENSED OVERVIEWS:**
- 📋 Translation Notes: Just the Greek/Hebrew quote + which academy article it links to
- 📋 Translation Words: Just the list of key term titles (not full definitions)
- 📋 Translation Academy: Just the article titles (not full content)

### Example Output Format

```markdown
**Scripture** [GLT v41 - Tito 3:11-15]
11 puesto que sabes que el tal se ha pervertido...
[full text]

**Key Terms** [es-419_tw v86]
- conocer, conocimiento, desconocido, distinguir
- perverso, perversamente, pervertir, pervertido
- pecado, pecaminoso, pecador, pecando
- enviar, enviado, enviado a
- Tíquico
- ley, principio
- Apolos
- bueno, bien, correcto, agradable, mejor
- trabajo, obras, actos, acciones

**Translation Questions** [es-419_tq v38 - Tito 3:11-15]
- Verse 3:14: ¿A qué deben comprometerse los creyentes para ser fructíferos?
  → Los creyentes deben aprender a comprometerse a hacer buenas obras...

**Translation Notes** [es-419_tn v66 - Tito 3:11-15]
- Verse 3:11: "ὁ τοιοῦτος" → See: translate/figs-metaphor
- Verse 3:11: "ἐξέστραπται" → See: translate/figs-metaphor
- Verse 3:12: "ὅταν πέμψω" → See: translate/grammar-connect-time-sequential
- Verse 3:12: "Ἀρτεμᾶν & Τυχικόν" → See: translate/translate-names
- Verse 3:14: "ἵνα μὴ ὦσιν ἄκαρποι" → See: translate/figs-metaphor, translate/figs-doublenegatives

**Related Translation Concepts** [es-419_ta v86]
- Metáfora
- Conectar - Relación temporal secuencial
- Cómo Traducir Nombres
- Dobles negativos
- "Nosotros" exclusivos e inclusivos
```

### Comparison: Before vs After

**Before (translation-helps-for-passage):**
```
Response size: ~50,000 characters
Context usage: Very high
LLM processing: Difficult
User consumption: Overwhelming
```

**After (translation-helps-report):**
```
Response size: ~3,000-5,000 characters
Context usage: Minimal
LLM processing: Easy
User consumption: Scannable overview
```

### Size Reduction Example

For Titus 3:11-15 in Spanish:

**Old Prompt:**
- Scripture: 500 chars
- Questions: 200 chars
- Translation Words (9 articles): ~27,000 chars
- Translation Notes: 8,000 chars
- Translation Academy (5 articles): ~25,000 chars
- **TOTAL: ~60,700 chars**

**New Prompt:**
- Scripture: 500 chars
- Questions: 200 chars
- Translation Words (titles only): ~300 chars
- Translation Notes (condensed): ~1,000 chars
- Translation Academy (titles only): ~200 chars
- **TOTAL: ~2,200 chars (96% reduction!)**

---

## Implementation Details

### File: `src/mcp/prompts-registry.ts`

Added new prompt definition:

```typescript
{
  name: "translation-helps-report",
  description: "Get a CONDENSED translation helps report for a Bible passage: 
    scripture text (full), questions (full), notes (quote + academy link only), 
    key terms list (titles only), and academy article titles (no full content). 
    Perfect for getting an overview without overwhelming context.",
  arguments: [
    {name: "reference", required: true},
    {name: "language", required: false}
  ]
}
```

### Prompt Template Instructions

The prompt template instructs the LLM to:

1. **Get Scripture** - Use fetch_scripture, show full text with citation
2. **Get Questions** - Use fetch_translation_questions, show all questions
3. **Get Word Links** - Use fetch_translation_word_links + fetch_translation_word
   - Extract ONLY titles, not full content
   - Format: "Key Terms: [Title 1], [Title 2], ..."
4. **Get Notes (Condensed)** - Use fetch_translation_notes
   - Show ONLY: Quote + academy article path
   - Format: "Note on [verse]: [Quote] → See: [Academy Path]"
5. **Get Academy Titles** - Use fetch_translation_academy
   - Extract ONLY titles, not full content
   - Format: "Related Concepts: [Title 1], [Title 2], ..."

---

## Usage Guidelines

### When to Use Each Prompt

**Use `translation-helps-report` (NEW) When:**
- ✅ User wants an overview of available resources
- ✅ User needs to see what key terms and concepts are relevant
- ✅ Context window is a concern
- ✅ User wants a quick, scannable summary
- ✅ First time exploring a passage

**Use `translation-helps-for-passage` (OLD) When:**
- 📚 User explicitly asks for "complete" or "full" articles
- 📚 User wants to read entire definitions
- 📚 Deep study session with unlimited context
- 📚 User has already seen the overview and wants details

### Workflow Recommendation

**Recommended Flow:**
1. Start with `translation-helps-report` to get overview
2. User identifies items of interest
3. Use individual fetch tools for full content on specific items:
   - `fetch_translation_word` for full word definitions
   - `fetch_translation_academy` for full academy articles
   - etc.

---

## Testing Instructions

### Test Case: Spanish Passage

```bash
# Call new condensed prompt
prompt: translation-helps-report
args: {
  reference: "TIT 3:11-15",
  language: "es-419",
  organization: "unfoldingWord"
}

# Expected LLM Response Structure:
✅ Scripture section: Full text with [GLT v41 - Tito 3:11-15]
✅ Key Terms section: List of ~9 term titles (no full content)
✅ Questions section: 1 question with full text
✅ Notes section: ~10 condensed notes with quotes + TA paths
✅ Concepts section: ~5 academy article titles (no full content)

✅ Total response: ~2,000-3,000 characters (manageable!)
✅ All citations present and correct
✅ Scannable and easy to read
```

### Verification Checklist

- [ ] Response includes full scripture with citation
- [ ] Key terms show ONLY titles (e.g., "Love, Beloved" not full article)
- [ ] Notes show ONLY quote + academy path (not full explanations)
- [ ] Academy shows ONLY titles (e.g., "Metaphor" not full article)
- [ ] Questions show full content (they're already short)
- [ ] All citations use actual resource names from citation objects
- [ ] Total response size < 5,000 characters
- [ ] Response is scannable and easy to read

---

## Benefits

### For LLMs
- ✅ **Reduced context usage**: 96% smaller responses
- ✅ **Better processing**: Less data to analyze
- ✅ **Improved citation accuracy**: Less overwhelming = better citations
- ✅ **Faster responses**: Less data to generate

### For Users
- ✅ **Quick overview**: See what's available at a glance
- ✅ **Scannable format**: Easy to find relevant items
- ✅ **Reduced cognitive load**: Not overwhelmed with content
- ✅ **Actionable**: Know what to request for deep dive

### For System
- ✅ **Lower bandwidth**: Smaller responses
- ✅ **Faster API calls**: Less data transfer
- ✅ **Better performance**: Reduced processing overhead

---

## Migration Path

### Existing Users
- Old `translation-helps-for-passage` prompt **remains available**
- No breaking changes
- Users can continue using comprehensive prompt if preferred

### New Users
- Recommend starting with `translation-helps-report`
- Use comprehensive prompt only when explicitly needed
- Update documentation to suggest condensed prompt first

### System Prompts
Updated to mention:
```
- CONDENSED reports → Overview only (use translation-helps-report prompt)
```

---

## Future Enhancements

### Potential Additions
1. **Customizable condensing**: Let users choose what to condense
2. **Depth parameter**: `depth=summary|moderate|full`
3. **Item limits**: `max_words=5` to limit key terms shown
4. **Smart expansion**: Auto-expand items based on relevance

### Alternative Formats
1. **JSON format**: Structured data for programmatic use
2. **Table format**: Aligned columns for readability
3. **Markdown sections**: Collapsible sections in markdown

---

## Status: ✅ READY FOR TESTING

The condensed report prompt has been implemented and is ready for testing.

**Next Steps:**
1. Rebuild MCP server: `npm run build`
2. Test with MCP Inspector
3. Compare old vs new prompt responses
4. Verify citation accuracy in condensed format
5. Check response size reduction

**Expected Outcome:**
- Condensed responses ~2,000-3,000 chars (vs 50,000+ before)
- All citations correct and using actual resource names
- Easy to scan and understand
- LLM properly processes and cites everything
