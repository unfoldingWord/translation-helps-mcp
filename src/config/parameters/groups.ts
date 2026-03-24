/**
 * Parameter Groups
 *
 * Organized collections of parameters for different tool/endpoint categories
 */

import { createParameterGroup } from "./types.js";
import {
  COMMON_PARAMS,
  ORGANIZATION_PARAM_RESOURCE_HELPS,
  ORGANIZATION_PARAM_SCRIPTURE,
} from "./common.js";

/**
 * Parameters for fetching scripture
 */
export const SCRIPTURE_PARAMS = createParameterGroup(
  "Scripture Parameters",
  "Parameters for fetching Bible scripture text",
  [
    COMMON_PARAMS.reference,
    COMMON_PARAMS.language,
    ORGANIZATION_PARAM_SCRIPTURE,
    COMMON_PARAMS.resource,
    COMMON_PARAMS.format,
    COMMON_PARAMS.includeAlignment,
    COMMON_PARAMS.includeVerseNumbers,
    COMMON_PARAMS.topic,
  ],
);

/**
 * Parameters for fetching translation notes
 */
export const TRANSLATION_NOTES_PARAMS = createParameterGroup(
  "Translation Notes Parameters",
  "Parameters for fetching translation notes. Omit `organization` unless the user needs one Door43 owner—search all orgs by default (required for many non-English languages).",
  [
    COMMON_PARAMS.reference,
    COMMON_PARAMS.language,
    ORGANIZATION_PARAM_RESOURCE_HELPS,
    COMMON_PARAMS.format,
    COMMON_PARAMS.includeContext,
    COMMON_PARAMS.includeIntro,
    COMMON_PARAMS.topic,
  ],
);

/**
 * Parameters for fetching translation questions
 */
export const TRANSLATION_QUESTIONS_PARAMS = createParameterGroup(
  "Translation Questions Parameters",
  "Parameters for fetching translation questions. Omit `organization` by default (same as translation notes)—do not default to unfoldingWord.",
  [
    COMMON_PARAMS.reference,
    COMMON_PARAMS.language,
    ORGANIZATION_PARAM_RESOURCE_HELPS,
    COMMON_PARAMS.format,
    COMMON_PARAMS.topic,
  ],
);

/**
 * Parameters for fetching translation word links
 */
export const TRANSLATION_WORD_LINKS_PARAMS = createParameterGroup(
  "Translation Word Links Parameters",
  "Parameters for fetching translation word links. Omit `organization` by default so all orgs are searched.",
  [
    COMMON_PARAMS.reference,
    COMMON_PARAMS.language,
    ORGANIZATION_PARAM_RESOURCE_HELPS,
    COMMON_PARAMS.format,
    COMMON_PARAMS.topic,
  ],
);

/**
 * Parameters for fetching translation words
 *
 * Uses ONLY path - from externalReference in TWL responses
 * NOTE: reference parameter removed - TW uses path, not references
 */
export const TRANSLATION_WORD_PARAMS = createParameterGroup(
  "Translation Word Parameters",
  "Parameters for fetching translation word articles",
  [
    { ...COMMON_PARAMS.path, default: "bible/kt/love" }, // THE ONLY identifier parameter (from externalReference)
    COMMON_PARAMS.language,
    ORGANIZATION_PARAM_RESOURCE_HELPS,
    COMMON_PARAMS.category,
    COMMON_PARAMS.topic,
  ],
);

/**
 * Parameters for fetching translation academy modules
 *
 * Uses ONLY path - from externalReference in TN responses
 */
export const TRANSLATION_ACADEMY_PARAMS = createParameterGroup(
  "Translation Academy Parameters",
  "Parameters for fetching translation academy modules",
  [
    { ...COMMON_PARAMS.path, default: "translate/figs-metaphor" }, // THE ONLY identifier parameter (from externalReference)
    COMMON_PARAMS.language,
    ORGANIZATION_PARAM_RESOURCE_HELPS,
    COMMON_PARAMS.format,
    COMMON_PARAMS.topic,
  ],
);

/**
 * Parameters for listing tools
 */
export const LIST_TOOLS_PARAMS = createParameterGroup(
  "List Tools Parameters",
  "Parameters for listing available MCP tools",
  [], // No parameters - returns all tools
);

/**
 * Parameters for listing languages
 */
export const LIST_LANGUAGES_PARAMS = createParameterGroup(
  "List Languages Parameters",
  "Parameters for listing available languages",
  [COMMON_PARAMS.organization, COMMON_PARAMS.stage, COMMON_PARAMS.topic],
);

/**
 * Parameters for listing subjects
 */
export const LIST_SUBJECTS_PARAMS = createParameterGroup(
  "List Subjects Parameters",
  "Parameters for listing available resource subjects",
  [
    COMMON_PARAMS.language,
    COMMON_PARAMS.organization,
    COMMON_PARAMS.stage,
    COMMON_PARAMS.topic,
  ],
);

/**
 * Parameters for listing resources for a language
 */
export const LIST_RESOURCES_FOR_LANGUAGE_PARAMS = createParameterGroup(
  "List Resources for Language Parameters",
  "Parameters for listing all resources available in a specific language",
  [
    { ...COMMON_PARAMS.language, required: true },
    COMMON_PARAMS.organization,
    COMMON_PARAMS.stage,
    COMMON_PARAMS.subject,
    COMMON_PARAMS.limit,
    COMMON_PARAMS.topic,
  ],
);

/**
 * All parameter groups organized by category
 */
export const PARAMETER_GROUPS = {
  scripture: SCRIPTURE_PARAMS,
  translationNotes: TRANSLATION_NOTES_PARAMS,
  translationQuestions: TRANSLATION_QUESTIONS_PARAMS,
  translationWordLinks: TRANSLATION_WORD_LINKS_PARAMS,
  translationWord: TRANSLATION_WORD_PARAMS,
  translationAcademy: TRANSLATION_ACADEMY_PARAMS,
  listTools: LIST_TOOLS_PARAMS,
  listLanguages: LIST_LANGUAGES_PARAMS,
  listSubjects: LIST_SUBJECTS_PARAMS,
  listResourcesForLanguage: LIST_RESOURCES_FOR_LANGUAGE_PARAMS,
} as const;
