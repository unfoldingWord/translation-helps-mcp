# State Injection Interceptor - Integration Checklist

## ✅ **Phase 1: Add Core Files** (5 minutes)

- [ ] Copy `ContextManager.ts` to `packages/js-sdk/src/`
- [ ] Copy `StateInjectionInterceptor.ts` to `packages/js-sdk/src/`
- [ ] Copy `validators.ts` to `packages/js-sdk/src/`
- [ ] Copy `defaultToolConfig.ts` to `packages/js-sdk/src/`
- [ ] Copy `interceptor.test.ts` to `packages/js-sdk/src/`

---

## ✅ **Phase 2: Update Client Class** (15 minutes)

Open `packages/js-sdk/src/client.ts`:

### **A. Add Imports** (Top of file)
- [ ] Add: `import { ContextManager } from './ContextManager';`
- [ ] Add: `import { StateInjectionInterceptor, type ToolContextConfig, type InterceptorOptions } from './StateInjectionInterceptor';`
- [ ] Add: `import { DEFAULT_TOOL_CONTEXT_CONFIG } from './defaultToolConfig';`
- [ ] Add: `import { languageCodeValidator, organizationValidator, stageValidator } from './validators';`

### **B. Update ClientOptions Interface**
- [ ] Add `enableInterceptor?: boolean;`
- [ ] Add `toolContextConfig?: ToolContextConfig;`
- [ ] Add `interceptorOptions?: InterceptorOptions;`
- [ ] Add `initialContext?: Record<string, any>;`

### **C. Add Class Properties**
- [ ] Add: `private contextManager: ContextManager;`
- [ ] Add: `private interceptor: StateInjectionInterceptor | null = null;`
- [ ] Add: `private interceptorEnabled: boolean = false;`

### **D. Update Constructor**
- [ ] Initialize `this.contextManager = new ContextManager();`
- [ ] Register validation rules (language, organization, stage, etc.)
- [ ] Check `options.enableInterceptor` and call `this.enableStateInjection()`
- [ ] Check `options.initialContext` and call `this.contextManager.setMany()`

### **E. Add New Methods**
- [ ] Add `enableStateInjection(config?, options?)`
- [ ] Add `disableStateInjection()`
- [ ] Add `getContextManager()`
- [ ] Add `getInterceptor()`
- [ ] Add `setContext(key, value)`
- [ ] Add `getContext(key)`
- [ ] Add `setContextMany(values)`
- [ ] Add `clearContext()`
- [ ] Add `getAllContext()`

### **F. Update callTool Method**
- [ ] Add interceptor check at the beginning
- [ ] Call `this.interceptor.intercept(name, arguments_)` if enabled
- [ ] Use `result.arguments` instead of original `arguments_`
- [ ] Add debug logging for injected/synced parameters
- [ ] Attach interception metadata if `enableMetrics` is true

**Reference:** Use `client-with-interceptor.ts` as a guide

---

## ✅ **Phase 3: Update Exports** (2 minutes)

Open `packages/js-sdk/src/index.ts`:

- [ ] Add: `export { ContextManager } from './ContextManager';`
- [ ] Add: `export type { ContextValue, ContextStore, ValidationRule } from './ContextManager';`
- [ ] Add: `export { StateInjectionInterceptor } from './StateInjectionInterceptor';`
- [ ] Add: `export type { ToolContextConfig, InterceptorOptions, InterceptionResult } from './StateInjectionInterceptor';`
- [ ] Add: `export { DEFAULT_TOOL_CONTEXT_CONFIG, createToolConfig } from './defaultToolConfig';`
- [ ] Add: `export * from './validators';`

---

## ✅ **Phase 4: Update package.json** (1 minute)

Add to `"exports"` field:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./ContextManager": {
      "import": "./dist/ContextManager.js",
      "types": "./dist/ContextManager.d.ts"
    },
    "./StateInjectionInterceptor": {
      "import": "./dist/StateInjectionInterceptor.js",
      "types": "./dist/StateInjectionInterceptor.d.ts"
    },
    "./validators": {
      "import": "./dist/validators.js",
      "types": "./dist/validators.d.ts"
    },
    "./defaultToolConfig": {
      "import": "./dist/defaultToolConfig.js",
      "types": "./dist/defaultToolConfig.d.ts"
    }
  }
}
```

---

## ✅ **Phase 5: Build & Test** (5 minutes)

```bash
cd packages/js-sdk
npm run build
npm test
```

- [ ] Build succeeds without errors
- [ ] All tests pass
- [ ] TypeScript definitions are generated
- [ ] No type errors in `dist/` folder

---

## ✅ **Phase 6: Update Chat Integration** (5 minutes)

Open `ui/src/lib/mcp/client.ts`:

Update `getMCPClient` function:

```typescript
export function getMCPClient(serverUrl?: string, enableMetrics = false): TranslationHelpsClient {
  const defaultServerUrl = '/mcp';
  
  if (!clientInstance) {
    clientInstance = new TranslationHelpsClient({
      serverUrl: serverUrl || defaultServerUrl,
      timeout: 90000,
      enableMetrics,
      
      // ✨ Add these lines
      enableInterceptor: true,
      initialContext: {
        language: 'en',
        organization: 'unfoldingWord',
        stage: 'prod'
      },
      interceptorOptions: {
        debug: false // Set to true during development
      }
    });
  }
  return clientInstance;
}
```

- [ ] Updated `getMCPClient` function
- [ ] Enabled interceptor
- [ ] Set initial context
- [ ] Configured debug mode

---

## ✅ **Phase 7: Verify in Browser** (5 minutes)

1. Start dev server:
   ```bash
   cd ui
   npm run dev
   ```

2. Open browser console and navigate to `/chat`

3. Send test messages:
   - "Show me John 3:16" (should work with injected language)
   - "Now show me Romans 1:1" (should use same language)
   - "Change to Spanish and show me Mateo 5:1" (should sync new language)

4. Check console for debug logs:
   - [ ] See `[SDK] 🔄 State Injection Applied:` logs
   - [ ] See `injected: ['language']` when language is auto-injected
   - [ ] See `synced: ['language']` when language is explicitly changed

---

## ✅ **Phase 8: Production Deployment** (2 minutes)

Before deploying to production:

- [ ] Set `interceptorOptions.debug: false`
- [ ] Test with multiple user sessions
- [ ] Verify context clears between sessions
- [ ] Monitor for any unexpected behavior

---

## 🎉 **Integration Complete!**

Once all checkboxes are marked:

- ✅ Interceptor is fully integrated
- ✅ Context injection is automatic
- ✅ LLM context-dropping is solved
- ✅ Zero manual context tracking needed

---

## 🐛 **Troubleshooting Checklist**

If something doesn't work:

### **Build Errors?**
- [ ] Check TypeScript version (should be 5.0+)
- [ ] Run `npm install` to ensure all deps are installed
- [ ] Check for conflicting type definitions

### **Tests Failing?**
- [ ] Ensure test framework is installed (`vitest`)
- [ ] Check if test file is in correct location
- [ ] Run `npm test -- --run` to run tests once

### **Interceptor Not Working?**
- [ ] Verify `enableInterceptor: true` in client options
- [ ] Check `client.getInterceptor()` returns non-null
- [ ] Enable debug mode to see injection logs
- [ ] Verify context is set: `client.getAllContext()`

### **Parameters Not Being Injected?**
- [ ] Check tool name in `DEFAULT_TOOL_CONTEXT_CONFIG`
- [ ] Verify context key exists: `client.getContext('language')`
- [ ] Check if parameter is in tool's required list
- [ ] Enable debug logging to see what's happening

### **Validation Failing?**
- [ ] Check validator is registered for that key
- [ ] Test validator directly: `validator.validate(value)`
- [ ] Check validation error message in console
- [ ] Verify value format matches expected pattern

---

## 📚 **Reference Documentation**

- **Full Implementation:** `STATE_INJECTION_INTERCEPTOR_IMPLEMENTATION.md`
- **Usage Examples:** `INTERCEPTOR_USAGE_EXAMPLES.md`
- **Quick Reference:** `QUICK_REFERENCE.md`
- **Chat Architecture:** `CHAT_ARCHITECTURE_AND_TUNING_GUIDE.md`
- **API Reference:** JSDoc comments in source files

---

**Estimated Total Time: ~40 minutes** ⏱️

**Print this checklist and mark off items as you complete them!** ✓
