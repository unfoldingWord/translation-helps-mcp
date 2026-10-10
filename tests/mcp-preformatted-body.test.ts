/**
 * Notes and questions asked for with format "md" or "text" (issue #34).
 *
 * For those formats the REST endpoint answers with a finished markdown or text
 * body. UnifiedMCPHandler hands a non-JSON body to the tool's formatter wrapped
 * as `{ text, raw }`. The notes and questions formatters only looked for arrays
 * of items, found none, and answered "No translation notes found" although the
 * endpoint had returned the notes. The other formatters (words, academy, OBS
 * story) already passed such a body through.
 */

import { describe, expect, it } from "vitest";
import {
  getToolByMcpName,
  ToolFormatters,
} from "../src/config/tools-registry.js";

const NOTES_MD = [
  "# Translation Tn",
  "",
  "**Reference**: 1:1",
  "",
  "## 1. the beginning",
  "",
  "This could mean ‘the beginning of all things,’ before anything existed except God.",
].join("\n");

const QUESTIONS_MD = [
  "# Translation Questions",
  "",
  "## Who created everything?",
  "",
  "God created everything.",
].join("\n");

/** What UnifiedMCPHandler builds from a response that is not JSON. */
function preformatted(body: string) {
  return { text: body, raw: body };
}

function formatterOf(mcpName: string) {
  const tool = getToolByMcpName(mcpName);
  if (!tool) throw new Error(`${mcpName} is not in the registry`);
  return tool.formatter;
}

describe("a body the endpoint already formatted", () => {
  it.each([
    "fetch_translation_notes",
    "fetch_obs_translation_notes",
    "fetch_obs_study_notes",
  ])("%s returns it instead of 'not found'", (mcpName) => {
    expect(formatterOf(mcpName)(preformatted(NOTES_MD))).toBe(NOTES_MD);
  });

  it.each([
    "fetch_translation_questions",
    "fetch_obs_translation_questions",
    "fetch_obs_study_questions",
  ])("%s returns it instead of 'not found'", (mcpName) => {
    expect(formatterOf(mcpName)(preformatted(QUESTIONS_MD))).toBe(QUESTIONS_MD);
  });

  it("is returned as it came when the formatter is handed the bare string", () => {
    expect(ToolFormatters.notes(NOTES_MD)).toBe(NOTES_MD);
    expect(ToolFormatters.questions(QUESTIONS_MD)).toBe(QUESTIONS_MD);
  });
});

describe("structured results keep their formatting", () => {
  it("formats note items as before", () => {
    const text = ToolFormatters.notes({
      items: [{ Quote: "the beginning", Note: "Before anything existed." }],
    });
    expect(text).toBe("**1.** **the beginning**: Before anything existed.");
  });

  it("formats question items as before", () => {
    const text = ToolFormatters.questions({
      items: [{ question: "Who created everything?", response: "God." }],
    });
    expect(text).toBe("**Q1: Who created everything?**\n\nGod.");
  });

  it("still says so when there is nothing", () => {
    expect(ToolFormatters.notes({ items: [] })).toBe(
      "No translation notes found",
    );
    expect(ToolFormatters.questions({ items: [] })).toBe(
      "No translation questions found",
    );
    // An empty body is not a result either.
    expect(ToolFormatters.notes(preformatted("  "))).toBe(
      "No translation notes found",
    );
    expect(ToolFormatters.questions(preformatted(""))).toBe(
      "No translation questions found",
    );
  });
});
