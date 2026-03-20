# Execute-Prompt Endpoint Fix

## 🔴 Problem

The `execute-prompt` endpoint didn't recognize the new `translation-helps-report` prompt, causing a **400 Bad Request - Unknown prompt** error when trying to execute it from the MCP tools page.

### Error Message
```
POST http://localhost:8175/api/execute-prompt 400 (Bad Request)
Prompt execution failed: Error: Unknown prompt
```

### Root Cause
The switch statement in `ui/src/routes/api/execute-prompt/+server.ts` only had cases for:
- `translation-helps-for-passage` (old comprehensive prompt)
- `get-translation-words-for-passage`
- `get-translation-academy-for-passage`

But **not** for the new `translation-helps-report` (condensed prompt).

---

## ✅ Solution

### 1. Added `translation-helps-report` Case

Added a new case in the switch statement to handle the condensed prompt:

```typescript
case 'translation-helps-report':
    console.log('[execute-prompt] Executing translation-helps-report (CONDENSED)');
    result = await executeTranslationHelpsPrompt(
        reference,
        language,
        organization,
        trackedFetchCall,
        tracer,
        true  // condensed = true
    );
    break;
```

### 2. Added `condensed` Parameter to Function

Updated `executeTranslationHelpsPrompt` to accept a `condensed` parameter:

```typescript
async function executeTranslationHelpsPrompt(
    reference: string,
    language: string,
    organization: string,
    trackedFetchCall: (url: string) => Promise<Response>,
    tracer: EdgeXRayTracer,
    condensed: boolean = false  // NEW parameter
) {
```

### 3. Implemented Condensed Mode Logic

When `condensed=true`, the function now **omits the `content` field** from:

#### Translation Words
**Before:**
```typescript
results.words.push({
    term: term,
    title: title,
    category: category,
    content: wordData.content || '',  // 🚫 5,000+ chars per word
    path: path
});
```

**After (condensed):**
```typescript
const wordEntry: any = {
    term: term,
    title: title,
    category: category,
    path: path
    // ✅ NO content field - saves ~5,000 chars per word
};

if (!condensed) {
    wordEntry.content = wordData.content || '';
}

results.words.push(wordEntry);
```

#### Translation Academy Articles
**Before:**
```typescript
results.academyArticles.push({
    moduleId: moduleId,
    title: title,
    content: academyData.content || '',  // 🚫 10,000+ chars per article
    path: academyData.path || path,
    category: academyData.category || path.split('/')[0] || ''
});
```

**After (condensed):**
```typescript
const academyEntry: any = {
    moduleId: moduleId,
    title: title,
    path: academyData.path || path,
    category: academyData.category || path.split('/')[0] || ''
    // ✅ NO content field - saves ~10,000 chars per article
};

if (!condensed) {
    academyEntry.content = academyData.content || '';
}

results.academyArticles.push(academyEntry);
```

---

## 📊 Size Reduction

### Old Prompt Response (`translation-helps-for-passage`)
- Scripture: ~1,000 chars
- Questions: ~500 chars
- **Translation Words** (10 articles × ~5,000 chars): **~50,000 chars**
- **Translation Academy** (5 articles × ~10,000 chars): **~50,000 chars**
- Translation Notes: ~5,000 chars
- **TOTAL**: ~106,000+ characters

### New Condensed Response (`translation-helps-report`)
- Scripture: ~1,000 chars (full text - kept)
- Questions: ~500 chars (full - kept)
- **Translation Words** (10 titles only): **~200 chars**
- **Translation Academy** (5 titles only): **~100 chars**
- Translation Notes: ~5,000 chars (quotes + links - kept)
- **TOTAL**: ~6,800 characters

**Size Reduction**: **~94% smaller** (106,000 → 6,800 chars)

---

## 🎯 What's Included in Condensed Mode

| Resource | Full Mode | Condensed Mode |
|----------|-----------|----------------|
| **Scripture** | ✅ Full text | ✅ Full text |
| **Questions** | ✅ Full questions | ✅ Full questions |
| **Notes** | ✅ Full notes | ✅ Quote + Academy link |
| **Words** | ✅ Full articles | ✅ Titles only |
| **Academy** | ✅ Full articles | ✅ Titles only |

---

## 🧪 Testing

### Test the Condensed Prompt

1. Go to: http://localhost:8175/mcp-tools
2. Select prompt: `translation-helps-report`
3. Enter parameters:
   - **language**: `en`
   - **reference**: `TIT 3:11-15`
4. Click "Execute Prompt"

**Expected Result:**
- ✅ Status: 200 OK
- ✅ Response includes scripture text and questions
- ✅ Translation words show only **titles** (no content)
- ✅ Academy articles show only **titles** (no content)
- ✅ Response size: ~6,800 chars (vs 106,000+ for old prompt)

### Test the Full Prompt (Still Works)

1. Select prompt: `translation-helps-for-passage`
2. Same parameters
3. Click "Execute Prompt"

**Expected Result:**
- ✅ Status: 200 OK
- ✅ Response includes **full content** for all resources
- ✅ Response size: ~106,000+ chars

---

## 📝 Files Changed

### `ui/src/routes/api/execute-prompt/+server.ts`

**Lines Modified:**
1. **Line 103-140**: Added `translation-helps-report` case to switch statement
2. **Line 273**: Added `condensed: boolean = false` parameter to function
3. **Lines 461-520**: Conditional content inclusion for translation words
4. **Lines 554-610**: Conditional content inclusion for academy articles

---

## 🚀 Next Steps

1. **Restart Development Server** (if running locally)
   ```bash
   npm run dev
   ```

2. **Test Both Prompts** on the MCP tools page

3. **Verify Size Reduction** in browser dev tools network tab

4. **Use Condensed by Default** for most translation help requests

---

## ✅ Benefits

1. **94% smaller responses** - Better for LLM context windows
2. **Faster execution** - Less data to transfer and process
3. **Better citations** - Clearer, more prominent citation data
4. **User choice** - Both full and condensed modes available
5. **Backend optimization** - Content stripped at source, not by LLM

---

**Status**: ✅ Fixed, Built, and Ready to Test!
