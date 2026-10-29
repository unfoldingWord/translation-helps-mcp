import { describe, expect, it } from "vitest";
import {
  CLIENTS,
  cursorDeeplink,
  vscodeDeeplink,
} from "../../web/src/lib/connect/clients";
import { endpointFor } from "../../web/src/lib/site";
import { DEFAULT_ORIGIN } from "../../web/src/lib/endpoint";

const URL_ = "https://x/v2/mcp";

describe("install links", () => {
  it("encodes the server URL for Cursor", () => {
    const link = new URL(cursorDeeplink(URL_));
    expect(link.protocol).toBe("cursor:");
    expect(link.searchParams.get("name")).toBe("translation-helps");
    expect(JSON.parse(atob(link.searchParams.get("config")!))).toEqual({
      url: URL_,
    });
  });

  it("encodes the server URL for VS Code", () => {
    const link = new URL(vscodeDeeplink(URL_));
    expect(link.href).toContain("vscode.dev/redirect/mcp/install");
    expect(link.searchParams.get("name")).toBe("translation-helps");
    expect(JSON.parse(link.searchParams.get("config")!)).toEqual({
      type: "http",
      url: URL_,
    });
  });
});

describe("CLIENTS", () => {
  it("covers each client with the endpoint in every snippet", () => {
    const clients = CLIENTS(URL_);
    expect(clients.map((c) => c.id)).toEqual([
      "claude-desktop",
      "claude-code",
      "cursor",
      "vscode",
      "chatgpt",
      "other",
    ]);
    for (const c of clients) {
      expect(c.tabs.length, c.id).toBeGreaterThan(0);
      for (const tab of c.tabs) {
        expect(tab.code, `${c.id} ${tab.label}`).toContain(URL_);
      }
    }
  });

  it("gives the commands of Claude Code and the key each editor reads", () => {
    const by = Object.fromEntries(CLIENTS(URL_).map((c) => [c.id, c]));
    expect(by["claude-code"].tabs[0].code).toBe(
      `claude mcp add --transport http translation-helps ${URL_}`,
    );
    const cursor = JSON.parse(by.cursor.tabs[0].code);
    expect(cursor.mcpServers["translation-helps"]).toEqual({ url: URL_ });
    // VS Code reads "servers", not "mcpServers".
    const vscode = JSON.parse(by.vscode.tabs[0].code);
    expect(vscode.servers["translation-helps"]).toEqual({
      type: "http",
      url: URL_,
    });
    expect(vscode.mcpServers).toBeUndefined();
  });

  it("offers one-click install only for Cursor and VS Code", () => {
    const withInstall = CLIENTS(URL_)
      .filter((c) => c.install)
      .map((c) => c.id);
    expect(withInstall).toEqual(["cursor", "vscode"]);
  });

  it("keeps ChatGPT to the URL, without menu steps", () => {
    const chatgpt = CLIENTS(URL_).find((c) => c.id === "chatgpt")!;
    expect(chatgpt.tabs).toEqual([{ label: "Server URL", code: URL_ }]);
    expect(chatgpt.steps).not.toMatch(/Settings|click|menu/i);
  });

  it("works with the prerendered default endpoint", () => {
    const endpoint = endpointFor(DEFAULT_ORIGIN);
    for (const c of CLIENTS(endpoint)) {
      for (const tab of c.tabs) expect(tab.code).toContain(endpoint);
    }
  });
});
