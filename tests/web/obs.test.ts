import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../../src/mcp/toolRegistry.js";
import { OBS_STEPS, OBS_STORIES, obsCall } from "../../web/src/lib/try/obs.js";

describe("OBS walk steps", () => {
  it("are the story, then its notes and questions", () => {
    expect(OBS_STEPS.map((s) => [s.id, s.tool])).toEqual([
      ["story", "get_obs_story"],
      ["notes", "get_obs_notes"],
      ["questions", "get_obs_questions"],
    ]);
    for (const s of OBS_STEPS)
      expect(TOOL_REGISTRY[s.tool], s.id).toBeDefined();
  });

  it("cover stories 1 to 50", () => {
    expect(OBS_STORIES).toBe(50);
  });
});

describe("obsCall", () => {
  it("names the step's tool and passes its schema", () => {
    for (const s of OBS_STEPS) {
      const call = obsCall(s.id, "en", 1);
      expect(call.tool).toBe(s.tool);
      const parsed = TOOL_REGISTRY[call.tool].inputSchema.safeParse(call.args);
      expect(parsed.success, s.id).toBe(true);
    }
  });

  it("asks for the whole story when there is no frame", () => {
    expect(obsCall("notes", "es-419", 12)).toEqual({
      tool: "get_obs_notes",
      args: { reference: "12", language: "es-419" },
    });
  });

  it("asks for one frame as story:frame, and the schema accepts it", () => {
    for (const s of OBS_STEPS) {
      const call = obsCall(s.id, "en", 1, 5);
      expect(call.args).toEqual({ reference: "1:5", language: "en" });
      const parsed = TOOL_REGISTRY[call.tool].inputSchema.safeParse(call.args);
      expect(parsed.success, s.id).toBe(true);
    }
  });

  it("ignores a frame that is not a positive whole number", () => {
    for (const frame of [0, -1, 2.5, Number.NaN, undefined]) {
      expect(obsCall("story", "en", 3, frame).args.reference).toBe("3");
    }
  });
});
