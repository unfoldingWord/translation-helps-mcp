/**
 * Common Parameter Definitions
 * 
 * Single source of truth for all commonly used parameters across MCP tools and REST API
 */

import { z } from 'zod';
import type { UnifiedParameterDef } from './types.js';

/**
 * Reference parameter (e.g., "John 3:16", "Genesis 1:1-5")
 */
export const REFERENCE_PARAM: UnifiedParameterDef<string> = {
  name: 'reference',
  type: 'string',
  default: 'John 3:16',
  required: true,
  description: 'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")',
  example: 'John 3:16',
  pattern: '^[1-3]?\\s?[A-Za-z]+\\s+\\d+(:\\d+)?(-\\d+(:\\d+)?)?$',
};

/**
 * Language code parameter
 */
export const LANGUAGE_PARAM: UnifiedParameterDef<string> = {
  name: 'language',
  type: 'string',
  required: false,
  default: 'en',
  description: 'Language code (default: "en")',
  example: 'en',
  pattern: '^[a-z]{2,3}(-[A-Z]{2})?$',
};

/**
 * Organization parameter (can be single, array, or undefined for multi-org)
 */
export const ORGANIZATION_PARAM: UnifiedParameterDef<string | string[] | undefined> = {
  name: 'organization',
  type: 'string',
  required: false,
  description: 'Organization(s) to search. Can be a single organization (string), multiple organizations (array), or omitted to search all organizations. Examples: "unfoldingWord", ["unfoldingWord", "es-419_gl"], or undefined for all.',
  example: 'unfoldingWord',
  transform: (value: any) => {
    // Convert empty string to undefined for multi-org fetching
    if (value === '' || value === null) return undefined;
    return value;
  },
  zodSchema: () => z.union([
    z.string(),
    z.array(z.string()),
    z.undefined()
  ]).optional().transform((value) => {
    if (value === '' || value === null) return undefined;
    return value;
  }),
};

/**
 * Topic parameter for filtering resources
 */
export const TOPIC_PARAM: UnifiedParameterDef<string> = {
  name: 'topic',
  type: 'string',
  required: false,
  default: 'tc-ready',
  description: 'Filter by topic tag (e.g., "tc-ready" for translationCore-ready resources). Topics are metadata tags that indicate resource status or readiness.',
  example: 'tc-ready',
  options: ['tc-ready'] as const,
};

/**
 * Format parameter for output formatting
 */
export const FORMAT_PARAM: UnifiedParameterDef<string> = {
  name: 'format',
  type: 'string',
  required: false,
  default: 'json',
  description: 'Output format (default: "json")',
  example: 'json',
  options: ['text', 'usfm', 'json', 'md', 'markdown'] as const,
};

/**
 * Stage parameter for resource stage
 */
export const STAGE_PARAM: UnifiedParameterDef<string> = {
  name: 'stage',
  type: 'string',
  required: false,
  default: 'prod',
  description: 'Resource stage (default: "prod")',
  example: 'prod',
  options: ['prod', 'preprod', 'draft', 'latest'] as const,
};

/**
 * Resource parameter for scripture resources
 */
export const RESOURCE_PARAM: UnifiedParameterDef<string> = {
  name: 'resource',
  type: 'string',
  required: false,
  default: 'all',
  description: 'Scripture resource type(s) - single resource (ult, ust, t4t, ueb), comma-separated (ult,ust), or "all" for all available',
  example: 'ult',
};

/**
 * Include alignment parameter for scripture
 */
export const INCLUDE_ALIGNMENT_PARAM: UnifiedParameterDef<boolean> = {
  name: 'includeAlignment',
  type: 'boolean',
  required: false,
  default: false,
  description: 'Include word alignment data (only available with USFM format)',
  example: false,
};

/**
 * Include verse numbers parameter
 */
export const INCLUDE_VERSE_NUMBERS_PARAM: UnifiedParameterDef<boolean> = {
  name: 'includeVerseNumbers',
  type: 'boolean',
  required: false,
  default: true,
  description: 'Include verse numbers in the text (default: true)',
  example: true,
};

/**
 * Include context parameter for translation notes
 */
export const INCLUDE_CONTEXT_PARAM: UnifiedParameterDef<boolean> = {
  name: 'includeContext',
  type: 'boolean',
  required: false,
  default: true,
  description: 'Include contextual notes from related passages (default: true)',
  example: true,
};

/**
 * Include intro parameter for translation notes
 */
export const INCLUDE_INTRO_PARAM: UnifiedParameterDef<boolean> = {
  name: 'includeIntro',
  type: 'boolean',
  required: false,
  default: true,
  description: 'Include book and chapter introduction notes for context (default: true)',
  example: true,
};

/**
 * Term parameter for translation words
 */
export const TERM_PARAM: UnifiedParameterDef<string> = {
  name: 'term',
  type: 'string',
  required: false,
  description: 'Translation word term to lookup (e.g., "love", "grace", "salvation", "paul", "god", "faith")',
  example: 'love',
};

/**
 * Category parameter for translation words
 */
export const CATEGORY_PARAM: UnifiedParameterDef<string> = {
  name: 'category',
  type: 'string',
  required: false,
  description: 'Filter by category (kt, names, other) - only used with reference',
  example: 'kt',
  options: ['kt', 'names', 'other'] as const,
};

/**
 * Path parameter for resource paths
 */
export const PATH_PARAM: UnifiedParameterDef<string> = {
  name: 'path',
  type: 'string',
  required: false,
  description: 'Explicit path to the resource file (e.g., bible/kt/love.md)',
  example: 'bible/kt/love.md',
};

/**
 * RC Link parameter
 */
export const RC_LINK_PARAM: UnifiedParameterDef<string> = {
  name: 'rcLink',
  type: 'string',
  required: false,
  description: 'RC link to the resource (e.g., "rc://*/tw/dict/bible/kt/love")',
  example: 'rc://*/tw/dict/bible/kt/love',
};

/**
 * Module ID parameter for translation academy
 */
export const MODULE_ID_PARAM: UnifiedParameterDef<string> = {
  name: 'moduleId',
  type: 'string',
  required: false,
  description: 'Academy module ID (e.g., "figs-metaphor"). Searches in order: translate, process, checking, intro',
  example: 'figs-metaphor',
};

/**
 * Subject parameter for resource discovery
 */
export const SUBJECT_PARAM: UnifiedParameterDef<string | string[]> = {
  name: 'subject',
  type: 'string',
  required: false,
  description: 'Comma-separated list or array of subjects to search for (e.g., "Bible", "Translation Words,Translation Academy"). If not provided, searches 7 default subjects: Bible, Aligned Bible, Translation Words, Translation Academy, TSV Translation Notes, TSV Translation Questions, and TSV Translation Words Links.',
  example: 'Bible',
  zodSchema: () => z.union([z.string(), z.array(z.string())]).optional(),
};

/**
 * Limit parameter for pagination
 */
export const LIMIT_PARAM: UnifiedParameterDef<number> = {
  name: 'limit',
  type: 'number',
  required: false,
  description: 'Maximum number of resources to return per request. If not specified, fetches all available resources (up to 10000).',
  example: 100,
  min: 1,
  max: 10000,
};

/**
 * All common parameters as a map
 */
export const COMMON_PARAMS = {
  reference: REFERENCE_PARAM,
  language: LANGUAGE_PARAM,
  organization: ORGANIZATION_PARAM,
  topic: TOPIC_PARAM,
  format: FORMAT_PARAM,
  stage: STAGE_PARAM,
  resource: RESOURCE_PARAM,
  includeAlignment: INCLUDE_ALIGNMENT_PARAM,
  includeVerseNumbers: INCLUDE_VERSE_NUMBERS_PARAM,
  includeContext: INCLUDE_CONTEXT_PARAM,
  includeIntro: INCLUDE_INTRO_PARAM,
  term: TERM_PARAM,
  category: CATEGORY_PARAM,
  path: PATH_PARAM,
  rcLink: RC_LINK_PARAM,
  moduleId: MODULE_ID_PARAM,
  subject: SUBJECT_PARAM,
  limit: LIMIT_PARAM,
} as const;
