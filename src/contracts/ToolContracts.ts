/**
 * Single Source of Truth for MCP Tool Contracts
 * This defines the EXACT interface between Chat, MCP, and Endpoints
 */

export interface MCPToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export interface ScriptureToolArgs {
  reference: string;
  language?: string;
  version?: string;
}

export interface TranslationNotesToolArgs {
  reference: string;
  language?: string;
}

export interface TranslationQuestionsToolArgs {
  reference: string;
  language?: string;
}

export interface TranslationWordToolArgs {
  term: string;
  language?: string;
}

/**
 * Tool Response Formatters - RE-EXPORTED from tools-registry
 * DO NOT define here - they live in src/config/tools-registry.ts
 */
export { ToolFormatters } from "../config/tools-registry.js";

// Tool registry with endpoint mappings
/**
 * Tool Registry - DERIVED from single source of truth
 *
 * This is automatically generated from src/config/tools-registry.ts
 * DO NOT edit this directly - update tools-registry.ts instead
 *
 * Using getter function to avoid circular dependency issues during module initialization
 */
import { toToolRegistry } from "../config/tools-registry.js";

let _toolRegistry: ReturnType<typeof toToolRegistry> | null = null;

export function getToolRegistry() {
  if (!_toolRegistry) {
    _toolRegistry = toToolRegistry();
  }
  return _toolRegistry;
}

// Export as object for backward compatibility
export const ToolRegistry = new Proxy({} as ReturnType<typeof toToolRegistry>, {
  get(target, prop) {
    return getToolRegistry()[prop as keyof ReturnType<typeof toToolRegistry>];
  },
});
