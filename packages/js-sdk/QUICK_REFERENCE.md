# State Injection Interceptor - Quick Reference Card

## 🚀 **Enable in 30 Seconds**

```typescript
const client = new TranslationHelpsClient({
  enableInterceptor: true,
  initialContext: { language: 'en', organization: 'unfoldingWord' }
});
```

---

## 🎯 **Common Operations**

### **Set Context**
```typescript
client.setContext('language', 'en');
client.setContext('organization', 'unfoldingWord');

// Or batch set
client.setContextMany({
  language: 'es-419',
  organization: 'door43',
  stage: 'prod'
});
```

### **Get Context**
```typescript
const language = client.getContext('language'); // 'en'
const all = client.getAllContext(); // { language: 'en', ... }
```

### **Clear Context**
```typescript
client.clearContext(); // Clear all
```

---

## 🔧 **Enable After Initialization**

```typescript
const client = new TranslationHelpsClient();
await client.connect();

// Enable later
client.enableStateInjection(
  undefined, // Use default config
  { debug: true }
);
```

---

## 🛠️ **Custom Configuration**

```typescript
import { createToolConfig } from '@translation-helps/mcp-client/defaultToolConfig';

const config = createToolConfig({
  'my_custom_tool': ['language', 'customParam']
});

const client = new TranslationHelpsClient({
  enableInterceptor: true,
  toolContextConfig: config
});
```

---

## ✅ **Add Validation**

```typescript
import { languageCodeValidator } from '@translation-helps/mcp-client/validators';

const contextManager = client.getContextManager();
contextManager.addValidationRule('language', languageCodeValidator);

// Now invalid values are rejected
client.setContext('language', 'invalid!!!'); // Returns false
```

---

## 🎨 **Custom Validator**

```typescript
const myValidator = {
  validate: (value) => typeof value === 'string' && value.length > 0,
  errorMessage: 'Must be non-empty string'
};

client.getContextManager().addValidationRule('myParam', myValidator);
```

---

## 📊 **Debug Mode**

```typescript
const client = new TranslationHelpsClient({
  enableInterceptor: true,
  interceptorOptions: {
    debug: true, // Enable logging
    onContextInjected: (toolName, injected) => {
      console.log(`✅ Injected into ${toolName}:`, injected);
    },
    onContextSynced: (toolName, synced) => {
      console.log(`🔄 Synced from ${toolName}:`, synced);
    }
  }
});
```

---

## 🔍 **Inspect State**

```typescript
// Check what's in context
console.log('Current context:', client.getAllContext());

// Get interceptor for advanced config
const interceptor = client.getInterceptor();
console.log('Tool config:', interceptor?.getToolConfig());
```

---

## 🧪 **Test Pattern**

```typescript
describe('My MCP Tool', () => {
  it('should inject language from context', () => {
    const client = new TranslationHelpsClient({
      enableInterceptor: true,
      initialContext: { language: 'en' }
    });
    
    // Language will be injected automatically
    const result = await client.fetchScripture({ reference: 'John 3:16' });
    
    expect(result).toBeDefined();
  });
});
```

---

## 🎯 **Default Tool Config**

These tools automatically get context injection:

| Tool | Required Context |
|------|------------------|
| `fetch_scripture` | `language`, `organization`, `stage` |
| `fetch_translation_notes` | `language`, `organization`, `stage` |
| `fetch_translation_questions` | `language`, `organization`, `stage` |
| `fetch_translation_word` | `language`, `organization`, `stage` |
| `fetch_translation_word_links` | `language`, `organization`, `stage` |
| `fetch_translation_academy` | `language`, `organization`, `stage` |
| `list_languages` | `stage` |
| `list_subjects` | `stage` |
| `list_resources_for_language` | `stage` |

---

## 📦 **Built-in Validators**

```typescript
import {
  languageCodeValidator,    // 'en', 'en-US', 'es-419'
  organizationValidator,    // 'unfoldingWord', 'door43'
  referenceValidator,       // 'John 3:16', 'Romans 1:1-7'
  bookCodeValidator,        // 'GEN', 'JHN', '3JN'
  chapterValidator,         // 1-150
  verseValidator,           // 1-176
  formatValidator,          // 'json', 'text', 'usfm'
  booleanValidator,         // true, false
  stageValidator            // 'prod', 'preprod', 'latest'
} from '@translation-helps/mcp-client/validators';
```

---

## 🚨 **Troubleshooting**

### **Interceptor not working?**
```typescript
// Check if enabled
const interceptor = client.getInterceptor();
console.log('Enabled:', !!interceptor);

// Check context
console.log('Context:', client.getAllContext());
```

### **Parameters not being injected?**
```typescript
// Enable debug mode
const client = new TranslationHelpsClient({
  enableInterceptor: true,
  interceptorOptions: { debug: true }
});

// Check tool config
const interceptor = client.getInterceptor();
console.log('Config:', interceptor?.getToolConfig());
```

### **Validation failing?**
```typescript
// Check which validator is rejecting
const contextManager = client.getContextManager();
const success = contextManager.set('language', 'invalid');
console.log('Validation passed:', success);
```

---

## 💡 **Pro Tips**

1. **Always enable debug mode during development**
2. **Set initial context during client initialization**
3. **Use validation rules for critical parameters**
4. **Clear context between user sessions**
5. **Monitor `getAllContext()` to debug issues**

---

## 📚 **Full Documentation**

- **Complete Guide:** `STATE_INJECTION_INTERCEPTOR.md`
- **Usage Examples:** `INTERCEPTOR_USAGE_EXAMPLES.md` (11 examples)
- **Chat Integration:** `CHAT_ARCHITECTURE_AND_TUNING_GUIDE.md`
- **API Reference:** JSDoc comments in source files
- **Tests:** `interceptor.test.ts`

---

**Print this card and keep it handy!** 📌
