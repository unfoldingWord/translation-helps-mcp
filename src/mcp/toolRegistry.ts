/**
 * toolRegistry.ts — single source of truth for all tool modules.
 *
 * Exports:
 *   MCP_TOOLS    — tools registered on the /mcp McpAgent (progressive-disclosure surface)
 *   ALL_TOOLS    — union of MCP tools + legacy tools available at /api/tool
 *   TOOL_REGISTRY — keyed map of ALL_TOOLS for O(1) lookup by name
 */

// Workflow tools (MCP surface — progressive-disclosure flow)
import { listLanguagesTool } from "./tools/listLanguages.js";
import { getPassageTool } from "./tools/getPassage.js";
import { getPassageContextTool } from "./tools/getPassageContext.js";
import { getPassageIndexTool } from "./tools/getPassageIndex.js";
import { getNoteTool } from "./tools/getNote.js";
import { getAcademyArticleTool } from "./tools/getAcademyArticle.js";
import { getWordArticleTool } from "./tools/getWordArticle.js";
import { getPassageQuestionsTool } from "./tools/getPassageQuestions.js";
import { searchArticlesWorkflowTool } from "./tools/searchArticlesWorkflow.js";

// OBS tools (MCP surface + /api/tool)
import { getObsStoryTool } from "./tools/getObsStory.js";
import { getObsNotesTool } from "./tools/getObsNotes.js";
import { getObsQuestionsTool } from "./tools/getObsQuestions.js";

// Legacy tools — kept at /api/tool for ContextHarness compatibility.
// NOT registered in the MCP agent.
import { getBundleTool } from "./tools/getBundle.js";
import { fetchScriptureTool } from "./tools/fetchScripture.js";
import { fetchTranslationNotesTool } from "./tools/fetchTranslationNotes.js";
import { fetchTranslationWordTool } from "./tools/fetchTranslationWord.js";
import { fetchTranslationWordLinksTool } from "./tools/fetchTranslationWordLinks.js";
import { fetchTranslationAcademyTool } from "./tools/fetchTranslationAcademy.js";
import { fetchTranslationQuestionsTool } from "./tools/fetchTranslationQuestions.js";
import { listTranslationAcademyTool } from "./tools/listTranslationAcademy.js";
import { listTranslationWordsTool } from "./tools/listTranslationWords.js";
import { listSubjectsTool } from "./tools/listSubjects.js";
import { listResourcesForLanguageTool } from "./tools/listResourcesForLanguage.js";
import { listResourcesByLanguageTool } from "./tools/listResourcesByLanguage.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolModule = any;

/** Tools registered on the /mcp McpAgent (12 workflow + 3 OBS). */
export const MCP_TOOLS: ToolModule[] = [
  listLanguagesTool,
  getPassageTool,
  getPassageContextTool,
  getPassageIndexTool,
  getNoteTool,
  getAcademyArticleTool,
  getWordArticleTool,
  getPassageQuestionsTool,
  searchArticlesWorkflowTool,
  getObsStoryTool,
  getObsNotesTool,
  getObsQuestionsTool,
];

/** All tools — MCP surface + legacy /api/tool compat. */
export const ALL_TOOLS: ToolModule[] = [
  ...MCP_TOOLS,
  // Legacy tools (harness compat)
  getBundleTool,
  fetchScriptureTool,
  fetchTranslationNotesTool,
  fetchTranslationWordTool,
  fetchTranslationWordLinksTool,
  fetchTranslationAcademyTool,
  fetchTranslationQuestionsTool,
  listTranslationAcademyTool,
  listTranslationWordsTool,
  listSubjectsTool,
  listResourcesForLanguageTool,
  listResourcesByLanguageTool,
];

/** Keyed map of ALL_TOOLS by tool name, for O(1) lookup. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOL_REGISTRY: Record<string, any> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);
