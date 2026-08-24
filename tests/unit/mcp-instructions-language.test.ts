/**
 * Guard: server instructions must steer LLMs to pass the user's language,
 * not silently fall back to English UW TW/TA.
 */
import { describe, it, expect } from "vitest";
import { SERVER_INSTRUCTIONS } from "../../src/mcp/instructions.js";

describe("SERVER_INSTRUCTIONS language steering", () => {
  it("requires the user's resource language", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(
      /Always pass the user's resource\/response language/i,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /Do \*\*not\*\* call tools with `language:"en"`/i,
    );
  });

  it("does not claim all content is only under unfoldingWord", () => {
    expect(SERVER_INSTRUCTIONS).not.toMatch(
      /All content comes from the unfoldingWord organisation/i,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /translationCore-Create-BCS|gateway languages/i,
    );
  });
});
