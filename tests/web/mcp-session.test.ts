import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = (id: unknown, result: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id, result });

/**
 * A server that hands out session ids s1, s2, … and answers a tool call on an id in
 * `forgotten` with 404 "Session not found".
 */
function fakeServer(forgotten: Set<string>) {
  const calls: { method: string; session: string | null }[] = [];
  let sessions = 0;
  const fetchImpl = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const session = new Headers(init?.headers).get("Mcp-Session-Id");
    const method = String(body.method);
    calls.push({ method, session });
    const json = (text: string, headers: Record<string, string> = {}) =>
      new Response(text, {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    if (method === "initialize") {
      sessions += 1;
      return json(rpc(body.id, { protocolVersion: "2025-03-26" }), {
        "Mcp-Session-Id": `s${sessions}`,
      });
    }
    if (method === "notifications/initialized")
      return new Response("", { status: 202 });
    if (method === "tools/list") return json(rpc(body.id, { tools: [] }));
    if (session && forgotten.has(session))
      return new Response("Session not found", { status: 404 });
    return json(
      rpc(body.id, {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { ok: true },
      }),
    );
  };
  return { calls, fetchImpl };
}

describe("run", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("opens a new session once when the server has forgotten the old one", async () => {
    const forgotten = new Set<string>();
    const server = fakeServer(forgotten);
    vi.stubGlobal("fetch", server.fetchImpl);
    const { run } = await import("../../web/src/lib/mcp/session");

    expect(
      (await run("https://x/v2/mcp", "get_passage", {})).outcome.kind,
    ).toBe("ok");
    forgotten.add("s1");
    const again = await run("https://x/v2/mcp", "get_passage", {});

    expect(again.outcome.kind).toBe("ok");
    expect(again.result?.structured).toEqual({ ok: true });
    const toolCalls = server.calls.filter((c) => c.method === "tools/call");
    expect(toolCalls.map((c) => c.session)).toEqual(["s1", "s1", "s2"]);
    expect(server.calls.filter((c) => c.method === "initialize")).toHaveLength(
      2,
    );

    // The new session is kept for the next call.
    await run("https://x/v2/mcp", "get_passage", {});
    expect(
      server.calls.filter((c) => c.method === "tools/call").at(-1)?.session,
    ).toBe("s2");
  });

  it("opens the session for a tool call without listing the tools", async () => {
    const server = fakeServer(new Set());
    vi.stubGlobal("fetch", server.fetchImpl);
    const { connect, run } = await import("../../web/src/lib/mcp/session");

    await run("https://x/v2/mcp", "get_passage", {});
    expect(server.calls.map((c) => c.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);

    // A page that needs the list asks for it, on the same session.
    await connect("https://x/v2/mcp");
    expect(server.calls.at(-1)).toEqual({
      method: "tools/list",
      session: "s1",
    });
    expect(server.calls.filter((c) => c.method === "initialize")).toHaveLength(
      1,
    );
  });

  it("tries only once: a second 404 is reported, not retried again", async () => {
    const forgotten = new Set(["s1", "s2", "s3"]);
    const server = fakeServer(forgotten);
    vi.stubGlobal("fetch", server.fetchImpl);
    const { run } = await import("../../web/src/lib/mcp/session");

    const r = await run("https://x/v2/mcp", "get_passage", {});

    expect(r.result).toBeNull();
    expect(r.outcome.kind).not.toBe("ok");
    expect(server.calls.filter((c) => c.method === "initialize")).toHaveLength(
      2,
    );
  });
});
