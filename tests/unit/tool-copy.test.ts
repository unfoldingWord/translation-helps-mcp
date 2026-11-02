import { describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS } from "../../src/mcp/instructions.js";
import { LANGUAGE_DESCRIPTION } from "../../src/mcp/tools/shared.js";
import { getWordArticleTool } from "../../src/mcp/tools/getWordArticle.js";
import { getAcademyArticleTool } from "../../src/mcp/tools/getAcademyArticle.js";
import { getPassageQuestionsTool } from "../../src/mcp/tools/getPassageQuestions.js";
import { getNoteTool } from "../../src/mcp/tools/getNote.js";
import { getObsStoryTool } from "../../src/mcp/tools/getObsStory.js";
import { getObsNotesTool } from "../../src/mcp/tools/getObsNotes.js";
import { listLanguagesTool } from "../../src/mcp/tools/listLanguages.js";

describe("tool copy", () => {
  it("keeps the language parameter short", () => {
    expect(LANGUAGE_DESCRIPTION.length).toBeLessThanOrEqual(250);
    expect(LANGUAGE_DESCRIPTION).toMatch(/user's requested language/i);
    expect(LANGUAGE_DESCRIPTION).toMatch(/do not omit this or use "en"/i);
    expect(LANGUAGE_DESCRIPTION).toMatch(/own TW\/TA/);
  });

  it("offers a direct route for words, academy, and questions", () => {
    expect(getWordArticleTool.description).toMatch(/covenant/);
    expect(getWordArticleTool.description).toMatch(/sheol/);
    expect(getWordArticleTool.description).not.toMatch(
      /AFTER: call `get_questions`/,
    );
    expect(getAcademyArticleTool.description).toMatch(/figs-metaphor/);
    expect(getAcademyArticleTool.description).toMatch(/metaphor/);
    expect(getAcademyArticleTool.description).not.toMatch(
      /AFTER: call `get_questions`/,
    );
    expect(getPassageQuestionsTool.description).toMatch(
      /when studying a passage step by step/i,
    );
    expect(getPassageQuestionsTool.description).not.toMatch(
      /complete steps 1-3/,
    );
    expect(getNoteTool.description).toMatch(/taArticle\.path/);
    expect(getObsStoryTool.description).toMatch(/get_obs_index/);
    expect(getObsNotesTool.description).toMatch(/get_obs_index/);
    expect(listLanguagesTool.description).toMatch(/Door43/);
    expect(listLanguagesTool.description).not.toMatch(
      /unfoldingWord resources/,
    );
  });

  it("describes the server and adds direct questions", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(
      /Translation Helps MCP server \(unfoldingWord \/ Door43\)/,
    );
    expect(SERVER_INSTRUCTIONS).not.toMatch(/Ezer/);
    expect(SERVER_INSTRUCTIONS).not.toMatch(/Your name means/);
    expect(SERVER_INSTRUCTIONS).toMatch(/## Direct questions/);
    expect(SERVER_INSTRUCTIONS).toMatch(/get_obs_index/);
    expect(SERVER_INSTRUCTIONS).toMatch(/story:frame/);
    expect(SERVER_INSTRUCTIONS).toMatch(/get_passage_context/);
    expect(SERVER_INSTRUCTIONS).not.toMatch(
      /A bare book code without chapter is invalid/,
    );
  });
});
