/**
 * toolRegistry.ts — single source of truth for all tool modules.
 *
 * Exports:
 *   MCP_TOOLS     — tools registered on the /mcp McpAgent (workflow surface)
 *   ALL_TOOLS     — same as MCP_TOOLS (legacy tools retired)
 *   TOOL_REGISTRY — keyed map of MCP_TOOLS for O(1) lookup by name
 */

// Workflow tools (MCP surface — progressive-disclosure flow)
import { listLanguagesTool } from "./tools/listLanguages.js";
import { listResourcesTool } from "./tools/listResources.js";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolModule = any;

/** Tools registered on the /mcp McpAgent (10 workflow + 3 OBS). */
export const MCP_TOOLS: ToolModule[] = [
  listLanguagesTool,
  listResourcesTool,
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

/** All tools — same as MCP_TOOLS after legacy retirement. */
export const ALL_TOOLS: ToolModule[] = MCP_TOOLS;

/** Keyed map of MCP_TOOLS by tool name, for O(1) lookup. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOL_REGISTRY: Record<string, any> = Object.fromEntries(
  MCP_TOOLS.map((t) => [t.name, t]),
);
