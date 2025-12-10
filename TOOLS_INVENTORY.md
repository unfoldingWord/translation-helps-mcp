# Translation Helps MCP - Tools Inventory

## ✅ Active Tools (10)

These tools are registered in `src/index.ts` and available via the MCP server:

### Content Fetching Tools (6)

1. **`fetch_scripture`** - Fetch Bible scripture text for a specific reference
   - File: `src/tools/fetchScripture.ts`
   - Status: ✅ Active

2. **`fetch_translation_notes`** - Fetch translation notes for a specific Bible reference
   - File: `src/tools/fetchTranslationNotes.ts`
   - Status: ✅ Active

3. **`fetch_translation_questions`** - Fetch translation questions for a specific Bible reference
   - File: `src/tools/fetchTranslationQuestions.ts`
   - Status: ✅ Active

4. **`fetch_translation_word_links`** - Fetch translation word links (TWL) for a specific Bible reference
   - File: `src/tools/fetchTranslationWordLinks.ts`
   - Status: ✅ Active

5. **`fetch_translation_word`** - Fetch translation word articles for biblical terms
   - File: `src/tools/getTranslationWord.ts`
   - Status: ✅ Active
   - Can search by term name, path, rcLink, or Bible reference

6. **`fetch_translation_academy`** - Fetch translation academy (tA) modules and training content
   - File: `src/tools/fetchTranslationAcademy.ts`
   - Status: ✅ Active

### Discovery Tools (4)

7. **`list_languages`** - List all available languages from the Door43 catalog
   - File: `src/tools/listLanguages.ts`
   - Status: ✅ Active
   - Returns structured language data (codes, names, display names)

8. **`list_subjects`** - List all available resource subjects (resource types) from the Door43 catalog
   - File: `src/tools/listSubjects.ts`
   - Status: ✅ Active
   - Returns structured subject data (names, descriptions, resource types)

9. **`list_resources_for_language`** - List all available resources for a specific language ⭐ RECOMMENDED
   - File: `src/tools/listResourcesForLanguage.ts`
   - Status: ✅ Active
   - Fast single API call (~1-2 seconds)
   - Recommended workflow: Use `list_languages` first, then this tool

---

## ❌ Removed Tools (2)

1. **`search_translation_word_across_languages`** - REMOVED
   - File: `src/tools/searchTranslationWordAcrossLanguages.ts` - DELETED
   - Status: ❌ Removed from codebase
   - Reason: Not needed

2. **`list_resources_by_language`** - REMOVED
   - File: `src/tools/listResourcesByLanguage.ts` - Still exists but not registered
   - Status: ❌ Removed from MCP server
   - Reason: Replaced by faster `list_resources_for_language` tool

---

## 🗂️ Unused Tool Files (8)

These tool files exist in `src/tools/` but are **NOT registered** in `src/index.ts`:

1. **`browseTranslationWords.ts`**
   - Purpose: Browse available translation word articles
   - Status: ⚠️ Not registered - Consider removing if unused

2. **`extractReferences.ts`**
   - Purpose: Unknown (needs investigation)
   - Status: ⚠️ Not registered - Consider removing if unused

3. **`fetchResources.ts`**
   - Purpose: Unknown (needs investigation)
   - Status: ⚠️ Not registered - Consider removing if unused

4. **`getContext.ts`**
   - Purpose: Unknown (needs investigation)
   - Status: ⚠️ Not registered - Consider removing if unused

5. **`getLanguages.ts`**
   - Purpose: Fetch available languages from Door43
   - Status: ⚠️ Not registered - Replaced by `list_languages`?
   - Note: May be deprecated in favor of `list_languages`

6. **`getWordsForReference.ts`**
   - Purpose: Unknown (needs investigation)
   - Status: ⚠️ Not registered - Consider removing if unused

7. **`getSystemPrompt.ts`**
   - Purpose: Returns the complete system prompt and constraints
   - Status: ⚠️ Not registered - May be for internal use only
   - Note: May be used by UI or other internal systems

8. **`searchResources.ts`**
   - Purpose: Unknown (needs investigation)
   - Status: ⚠️ Not registered - Consider removing if unused

---

## 📋 Prompts (5)

These prompts are registered and available via the MCP server:

1. **`translation-helps-for-passage`** - Get comprehensive translation help for a Bible passage
2. **`get-translation-words-for-passage`** - Get translation words for a specific passage
3. **`get-translation-academy-for-passage`** - Get translation academy articles for a passage
4. **`discover-resources-for-language`** - Discover what translation resources are available for a language
5. **`discover-languages-for-subject`** - Discover which languages have a specific resource type

---

## 🔍 Deprecated/Unused Code

### Deprecated Services

- `ZipResourceFetcher` (in `src/services/ZipResourceFetcher.ts`) - Deprecated in favor of `ZipResourceFetcher2`
- `CacheAdapter` interface (in `src/functions/platform-adapter.ts`) - Deprecated, use unified cache

### Deprecated Features (in `src/experimental/`)

- Cache warming system - Deprecated
- Automated content ingestion - 30% complete, not in use

---

## Summary

- **Active Tools**: 9
- **Removed Tools**: 2 (`search_translation_word_across_languages`, `list_resources_by_language`)
- **Unused Tool Files**: 9 (not registered, may be candidates for removal - includes `listResourcesByLanguage.ts`)
- **Prompts**: 5

### Recommendations

1. **Review unused tool files** - Investigate the 8 unregistered tool files to determine if they should be:
   - Registered as new tools
   - Removed if obsolete
   - Kept for internal use only

2. **Clean up deprecated code** - Consider removing deprecated services and features if no longer needed

3. **Document internal tools** - If `getSystemPrompt.ts` is used internally, document its purpose
