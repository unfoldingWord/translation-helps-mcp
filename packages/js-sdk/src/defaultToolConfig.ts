/**
 * Default tool-to-context mapping for Translation Helps MCP Server
 *
 * This configuration defines which context parameters each tool requires.
 * The StateInjectionInterceptor uses this to automatically inject missing parameters.
 */

import type { ToolContextConfig } from "./StateInjectionInterceptor";

/**
 * Default context requirements for Translation Helps MCP tools
 *
 * NOTE: 'organization' is intentionally NOT in the default context injection list.
 * For translation notes/questions in non-English languages, omit organization so all
 * Door43 orgs are searched (unfoldingWord often has no TN for those languages).
 * Optionally use list_resources_for_language to see owners, then pass organization
 * only when the user wants a specific catalog owner.
 */
export const DEFAULT_TOOL_CONTEXT_CONFIG: ToolContextConfig = {
  // Scripture fetching tools - language and stage auto-injected, organization must be explicit first time
  fetch_scripture: ["language", "stage"],

  // Translation Notes tools
  fetch_translation_notes: ["language", "stage"],

  // Translation Questions tools
  fetch_translation_questions: ["language", "stage"],

  // Translation Words tools
  fetch_translation_word: ["language", "stage"],
  fetch_translation_word_links: ["language", "stage"],

  // Translation Academy tools
  fetch_translation_academy: ["language", "stage"],

  // Discovery tools - these typically don't need context injection
  // but may benefit from stage defaults
  list_languages: ["stage"],
  list_subjects: ["stage"],
  list_resources_for_language: ["stage"],
};

/**
 * Context keys that should be persisted across the session
 */
export const PERSISTENT_CONTEXT_KEYS = ["language", "organization", "stage"];

/**
 * Context keys that should be reset between conversations
 */
export const VOLATILE_CONTEXT_KEYS = ["reference", "book", "chapter", "verse"];

/**
 * Helper function to create a custom tool config by merging with defaults
 */
export function createToolConfig(
  customConfig: ToolContextConfig,
): ToolContextConfig {
  return {
    ...DEFAULT_TOOL_CONTEXT_CONFIG,
    ...customConfig,
  };
}

/**
 * Helper function to add context requirements to multiple tools at once
 */
export function bulkAddContextRequirements(
  baseConfig: ToolContextConfig,
  toolNames: string[],
  contextKeys: string[],
): ToolContextConfig {
  const newConfig = { ...baseConfig };

  for (const toolName of toolNames) {
    newConfig[toolName] = [
      ...new Set([...(newConfig[toolName] || []), ...contextKeys]),
    ];
  }

  return newConfig;
}
