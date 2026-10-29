import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SDK_INSTALL,
  SITE,
  endpointFor,
  footerNav,
  nav,
} from "../../web/src/lib/site";

describe("site constants", () => {
  it("names the site", () => {
    expect(SITE.name).toBe("Translation Helps MCP");
  });

  it("lists the main nav in order", () => {
    expect(nav.map((n) => n.label)).toEqual([
      "Try",
      "Connect",
      "Tools",
      "Docs",
    ]);
  });

  it("lists the footer links", () => {
    expect(footerNav.map((n) => n.label)).toEqual([
      "Status",
      "Metrics",
      "GitHub",
      "Door43",
    ]);
  });

  it("builds the MCP endpoint under /v2", () => {
    expect(endpointFor("https://x.dev")).toBe("https://x.dev/v2/mcp");
    expect(endpointFor("https://x.dev/")).toBe("https://x.dev/v2/mcp");
  });

  it("gives the same Python install command as the Python SDK README", () => {
    const readme = readFileSync("packages/python-sdk/README.md", "utf8");
    const pip = SDK_INSTALL.python
      .split("\n")
      .find((line) => line.startsWith("pip install"));
    expect(pip).toBeDefined();
    expect(readme).toContain(pip);
  });
});
