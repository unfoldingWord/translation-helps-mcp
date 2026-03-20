/**
 * Translation Helps MCP Client SDK
 *
 * Official TypeScript/JavaScript client for connecting to the Translation Helps MCP server.
 * Supports both remote HTTP servers and local STDIO servers.
 */

export * from "./client.js";
export * from "./types.js";
export * from "./prompts.js";

// State Injection Interceptor
export { ContextManager } from "./ContextManager.js";
export { StateInjectionInterceptor, type InterceptorOptions, type InterceptionResult, type ToolContextConfig } from "./StateInjectionInterceptor.js";
export { 
  DEFAULT_TOOL_CONTEXT_CONFIG, 
  PERSISTENT_CONTEXT_KEYS, 
  VOLATILE_CONTEXT_KEYS,
  createToolConfig,
  bulkAddContextRequirements,
} from "./defaultToolConfig.js";
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
  createCompositeValidator,
} from "./validators.js";
