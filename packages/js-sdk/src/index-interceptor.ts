/**
 * State Injection Interceptor Module Exports
 * 
 * Add these exports to your main index.ts file:
 */

// Core components
export { ContextManager } from './ContextManager';
export type { ContextValue, ContextStore, ValidationRule, ValidationRules } from './ContextManager';

export { StateInjectionInterceptor } from './StateInjectionInterceptor';
export type {
	ToolContextConfig,
	InterceptorOptions,
	InterceptionResult
} from './StateInjectionInterceptor';

// Default configuration
export { 
	DEFAULT_TOOL_CONTEXT_CONFIG,
	PERSISTENT_CONTEXT_KEYS,
	VOLATILE_CONTEXT_KEYS,
	createToolConfig,
	bulkAddContextRequirements
} from './defaultToolConfig';

// Validators
export {
	languageCodeValidator,
	organizationValidator,
	resourceTypeValidator,
	referenceValidator,
	bookCodeValidator,
	chapterValidator,
	verseValidator,
	formatValidator,
	booleanValidator,
	stageValidator,
	createStringLengthValidator,
	createNumberRangeValidator,
	createEnumValidator,
	createCompositeValidator
} from './validators';

/**
 * INTEGRATION INSTRUCTIONS:
 * 
 * 1. Add these exports to your main src/index.ts file
 * 2. Update package.json exports field:
 * 
 * "exports": {
 *   ".": {
 *     "import": "./dist/index.js",
 *     "types": "./dist/index.d.ts"
 *   },
 *   "./ContextManager": {
 *     "import": "./dist/ContextManager.js",
 *     "types": "./dist/ContextManager.d.ts"
 *   },
 *   "./StateInjectionInterceptor": {
 *     "import": "./dist/StateInjectionInterceptor.js",
 *     "types": "./dist/StateInjectionInterceptor.d.ts"
 *   },
 *   "./validators": {
 *     "import": "./dist/validators.js",
 *     "types": "./dist/validators.d.ts"
 *   },
 *   "./defaultToolConfig": {
 *     "import": "./dist/defaultToolConfig.js",
 *     "types": "./dist/defaultToolConfig.d.ts"
 *   }
 * }
 * 
 * 3. Update your TranslationHelpsClient class using client-with-interceptor.ts as a guide
 * 
 * 4. Run build:
 *    npm run build
 * 
 * 5. Test:
 *    npm test
 */
