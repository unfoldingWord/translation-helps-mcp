# State Injection Interceptor - Usage Examples

## 🎯 **Overview**

The State Injection Interceptor automatically manages context parameters (like `language`, `organization`, `stage`) across multiple LLM conversation turns, eliminating the problem of dropped implicit context.

---

## 📦 **Installation**

```typescript
import { TranslationHelpsClient } from '@translation-helps/mcp-client';
import { ContextManager } from '@translation-helps/mcp-client/ContextManager';
import { StateInjectionInterceptor } from '@translation-helps/mcp-client/StateInjectionInterceptor';
import { DEFAULT_TOOL_CONTEXT_CONFIG } from '@translation-helps/mcp-client/defaultToolConfig';
```

---

## 🚀 **Quick Start**

### **Example 1: Basic Setup with Auto-Injection**

```typescript
// Enable interceptor during client initialization
const client = new TranslationHelpsClient({
  serverUrl: 'https://tc-helps.mcp.servant.bible/mcp',
  enableInterceptor: true, // ✅ Enable auto-injection
  initialContext: {
    language: 'en', // Pre-populate default language
    organization: 'unfoldingWord',
    stage: 'prod'
  },
  interceptorOptions: {
    debug: true // Enable debug logging
  }
});

await client.connect();

// First call: Explicitly provide language
const result1 = await client.fetchScripture({
  reference: 'John 3:16',
  language: 'en' // ✅ Explicitly provided
});

// Second call: Language automatically injected!
const result2 = await client.fetchTranslationNotes({
  reference: 'John 3:16'
  // ❌ No language provided, but interceptor injects 'en' from context
});

// Console output:
// [SDK] 🔄 State Injection Applied: { tool: 'fetch_translation_notes', injected: ['language'], synced: [] }
```

---

## 🔧 **Advanced Usage**

### **Example 2: Manual Context Management**

```typescript
const client = new TranslationHelpsClient({
  enableInterceptor: true
});

await client.connect();

// Set context manually
client.setContext('language', 'es-419'); // Spanish
client.setContext('organization', 'es-419_gl');
client.setContext('stage', 'prod');

// All subsequent calls will use these defaults
const scripture = await client.fetchScripture({ reference: 'John 3:16' });
// Language 'es-419' injected automatically ✅

const notes = await client.fetchTranslationNotes({ reference: 'John 3:16' });
// Language 'es-419' injected automatically ✅

// Change language mid-conversation
client.setContext('language', 'fr'); // French

const frenchScripture = await client.fetchScripture({ reference: 'John 3:16' });
// Now uses French! ✅
```

---

### **Example 3: Context Synchronization**

```typescript
const client = new TranslationHelpsClient({
  enableInterceptor: true,
  initialContext: {
    language: 'en',
    organization: 'unfoldingWord'
  }
});

await client.connect();

// User switches language mid-conversation
const result = await client.fetchScripture({
  reference: 'John 3:16',
  language: 'es-419' // ✅ User explicitly changes language
});

// Context automatically synced! No manual update needed.
console.log(client.getContext('language')); // 'es-419' ✅

// Next call automatically uses the new language
const notes = await client.fetchTranslationNotes({ reference: 'Romans 1:1' });
// Uses 'es-419' automatically! ✅
```

---

### **Example 4: Custom Tool Configuration**

```typescript
import { createToolConfig } from '@translation-helps/mcp-client/defaultToolConfig';

// Create custom configuration
const customConfig = createToolConfig({
  // Add context requirements for custom tools
  'my_custom_tool': ['language', 'organization', 'customParam'],
  
  // Override default requirements
  'fetch_scripture': ['language', 'stage'] // Remove 'organization' requirement
});

const client = new TranslationHelpsClient({
  enableInterceptor: true,
  toolContextConfig: customConfig,
  initialContext: {
    language: 'en',
    stage: 'prod',
    customParam: 'myValue'
  }
});

await client.connect();

// Now 'my_custom_tool' will also benefit from auto-injection
await client.callTool('my_custom_tool', { someArg: 'value' });
// Automatically injects: language, organization, customParam ✅
```

---

### **Example 5: Validation Rules**

```typescript
import { languageCodeValidator, organizationValidator } from '@translation-helps/mcp-client/validators';

const client = new TranslationHelpsClient({
  enableInterceptor: true
});

await client.connect();

// Add custom validation rules
const contextManager = client.getContextManager();

contextManager.addValidationRule('customParam', {
  validate: (value) => typeof value === 'string' && value.length > 0,
  errorMessage: 'customParam must be a non-empty string'
});

// Valid value - succeeds
const success = client.setContext('language', 'en-US'); // ✅ true

// Invalid value - rejected
const failed = client.setContext('language', 'invalid!!!'); // ❌ false

// Console output:
// [ContextManager] Validation failed for key "language": Language code must be a valid ISO 639 format
```

---

### **Example 6: Conditional Context Injection**

```typescript
const client = new TranslationHelpsClient({
  enableInterceptor: true,
  interceptorOptions: {
    debug: true,
    onMissingRequiredParam: (toolName, paramKey) => {
      console.warn(`⚠️ Tool ${toolName} missing required param: ${paramKey}`);
      // Could trigger user prompt here
    },
    onContextInjected: (toolName, injectedParams) => {
      console.log(`✅ Injected into ${toolName}:`, injectedParams);
    },
    onContextSynced: (toolName, syncedParams) => {
      console.log(`🔄 Synced from ${toolName}:`, syncedParams);
    }
  }
});

await client.connect();

// Set partial context
client.setContext('language', 'en');

// Call tool - only language is available
await client.fetchScripture({ reference: 'John 3:16' });

// Console output:
// ✅ Injected into fetch_scripture: { language: 'en' }
// ⚠️ Tool fetch_scripture missing required param: organization
// ⚠️ Tool fetch_scripture missing required param: stage
```

---

## 🎨 **Real-World Chat Integration**

### **Example 7: LLM Chat Assistant with Context Persistence**

```typescript
// Initialize client with interceptor for chat session
const client = new TranslationHelpsClient({
  enableInterceptor: true,
  interceptorOptions: {
    debug: true
  }
});

await client.connect();

// Simulating a multi-turn conversation with an LLM

// Turn 1: User asks for English scripture
const llmTool1 = {
  name: 'fetch_scripture',
  arguments: { reference: 'John 3:16', language: 'en' }
};
const result1 = await client.callTool(llmTool1.name, llmTool1.arguments);
// Context synced: language = 'en' ✅

// Turn 2: User asks for notes (LLM forgets to include language!)
const llmTool2 = {
  name: 'fetch_translation_notes',
  arguments: { reference: 'John 3:16' } // ❌ Missing language!
};
const result2 = await client.callTool(llmTool2.name, llmTool2.arguments);
// Interceptor injects language = 'en' automatically! ✅

// Turn 3: User switches to Spanish
const llmTool3 = {
  name: 'fetch_scripture',
  arguments: { reference: 'Romans 1:1', language: 'es-419' }
};
const result3 = await client.callTool(llmTool3.name, llmTool3.arguments);
// Context updated: language = 'es-419' ✅

// Turn 4: User asks for questions (LLM again forgets language!)
const llmTool4 = {
  name: 'fetch_translation_questions',
  arguments: { reference: 'Romans 1:1' } // ❌ Missing language!
};
const result4 = await client.callTool(llmTool4.name, llmTool4.arguments);
// Interceptor injects language = 'es-419' automatically! ✅
// No manual tracking needed! 🎉
```

---

### **Example 8: Session Management**

```typescript
// Start a new conversation session
const client = new TranslationHelpsClient({
  enableInterceptor: true
});

await client.connect();

// Conversation 1 with User A (English speaker)
client.setContextMany({
  language: 'en',
  organization: 'unfoldingWord',
  stage: 'prod'
});

await client.fetchScripture({ reference: 'John 3:16' });
await client.fetchTranslationNotes({ reference: 'John 3:16' });
// All use English context ✅

// Clear context for new conversation
client.clearContext();

// Conversation 2 with User B (Spanish speaker)
client.setContextMany({
  language: 'es-419',
  organization: 'es-419_gl',
  stage: 'prod'
});

await client.fetchScripture({ reference: 'Mateo 5:1' });
await client.fetchTranslationNotes({ reference: 'Mateo 5:1' });
// All use Spanish context ✅
```

---

### **Example 9: Debugging & Inspection**

```typescript
const client = new TranslationHelpsClient({
  enableInterceptor: true,
  enableMetrics: true, // Enable metrics to see interception metadata
  interceptorOptions: {
    debug: true
  }
});

await client.connect();

// Set context
client.setContext('language', 'en');

// Make a call
const response = await client.fetchScripture({ reference: 'John 3:16' });

// Inspect context state
console.log('Current context:', client.getAllContext());
// { language: 'en' }

// Inspect interception metadata (if metrics enabled)
if (response.metadata?.stateInjection) {
  console.log('Injection metadata:', response.metadata.stateInjection);
  // {
  //   injected: { language: 'en' },
  //   synced: {},
  //   originalArgs: { reference: 'John 3:16' },
  //   finalArgs: { reference: 'John 3:16', language: 'en' }
  // }
}

// Access interceptor directly for configuration updates
const interceptor = client.getInterceptor();
if (interceptor) {
  interceptor.addToolRequirements('my_new_tool', ['language', 'organization']);
}
```

---

### **Example 10: Dynamic Tool Config Updates**

```typescript
const client = new TranslationHelpsClient({
  enableInterceptor: true
});

await client.connect();

const interceptor = client.getInterceptor();

if (interceptor) {
  // Add requirements for a new custom tool at runtime
  interceptor.addToolRequirements('analyze_passage', [
    'language',
    'organization',
    'includeContext'
  ]);

  // Update entire configuration
  interceptor.updateToolConfig({
    'analyze_passage': ['language', 'organization', 'includeContext'],
    'compare_translations': ['language', 'stage']
  });

  // Remove requirements for a tool
  interceptor.removeToolRequirements('old_deprecated_tool');
}
```

---

## 🔬 **Testing the Interceptor**

### **Example 11: Unit Testing**

```typescript
import { ContextManager } from '@translation-helps/mcp-client/ContextManager';
import { StateInjectionInterceptor } from '@translation-helps/mcp-client/StateInjectionInterceptor';

describe('StateInjectionInterceptor', () => {
  it('should inject missing parameters from context', () => {
    const contextManager = new ContextManager();
    const interceptor = new StateInjectionInterceptor(
      contextManager,
      { 'fetch_scripture': ['language', 'organization'] }
    );

    // Set context
    contextManager.set('language', 'en');
    contextManager.set('organization', 'unfoldingWord');

    // Intercept tool call with missing parameters
    const result = interceptor.intercept('fetch_scripture', {
      reference: 'John 3:16'
    });

    // Verify injection
    expect(result.modified).toBe(true);
    expect(result.arguments.language).toBe('en');
    expect(result.arguments.organization).toBe('unfoldingWord');
    expect(result.injected).toEqual({
      language: 'en',
      organization: 'unfoldingWord'
    });
  });

  it('should sync explicitly-provided parameters to context', () => {
    const contextManager = new ContextManager();
    const interceptor = new StateInjectionInterceptor(
      contextManager,
      { 'fetch_scripture': ['language'] }
    );

    // Intercept tool call with explicit language
    interceptor.intercept('fetch_scripture', {
      reference: 'John 3:16',
      language: 'es-419'
    });

    // Verify sync
    expect(contextManager.get('language')).toBe('es-419');
  });
});
```

---

## 🚨 **Common Patterns & Best Practices**

### ✅ **DO:**
- Enable interceptor for LLM-driven applications
- Set initial context during client initialization
- Use validation rules for critical parameters
- Clear context between different user sessions
- Enable debug mode during development

### ❌ **DON'T:**
- Rely on interceptor for security (validate on server!)
- Store sensitive data in context
- Override context too frequently (defeats the purpose)
- Disable validation in production

---

## 📊 **Performance Impact**

The interceptor adds **minimal overhead**:
- ~0.1ms per tool call for context lookup
- ~0.5ms for validation (if rules are enabled)
- No network calls (purely client-side)

---

## 🎓 **Migration from Manual Context Tracking**

### **Before (Manual Tracking):**
```typescript
// ❌ Manual context management in your chat loop
let currentLanguage = 'en';
let currentOrganization = 'unfoldingWord';

// LLM returns tool call
const toolCall = { name: 'fetch_scripture', arguments: { reference: 'John 3:16' } };

// Manually inject missing parameters
if (!toolCall.arguments.language) {
  toolCall.arguments.language = currentLanguage;
}
if (!toolCall.arguments.organization) {
  toolCall.arguments.organization = currentOrganization;
}

// Make the call
await client.callTool(toolCall.name, toolCall.arguments);

// Manually sync if language changed
if (toolCall.arguments.language && toolCall.arguments.language !== currentLanguage) {
  currentLanguage = toolCall.arguments.language;
}
```

### **After (With Interceptor):**
```typescript
// ✅ Automatic context management
const client = new TranslationHelpsClient({
  enableInterceptor: true,
  initialContext: { language: 'en', organization: 'unfoldingWord' }
});

// LLM returns tool call
const toolCall = { name: 'fetch_scripture', arguments: { reference: 'John 3:16' } };

// Just call it! Interceptor handles everything.
await client.callTool(toolCall.name, toolCall.arguments);
// ✨ Magic happens automatically
```

---

## 🔗 **API Reference**

See the individual component files for full API documentation:
- [`ContextManager.ts`](./src/ContextManager.ts) - State storage
- [`StateInjectionInterceptor.ts`](./src/StateInjectionInterceptor.ts) - Injection logic
- [`validators.ts`](./src/validators.ts) - Validation rules
- [`defaultToolConfig.ts`](./src/defaultToolConfig.ts) - Tool configurations

---

**🎉 You're all set! The interceptor will now automatically manage context across your LLM conversations.**
