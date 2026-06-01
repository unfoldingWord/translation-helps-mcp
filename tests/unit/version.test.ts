import { describe, it, expect } from "vitest";
import { VERSION, SERVER_NAME } from "../../src/core/version.js";

describe("version", () => {
  it("VERSION is a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("SERVER_NAME is set", () => {
    expect(SERVER_NAME).toBe("translation-helps-mcp");
  });
});
