import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../../src/mcp/toolRegistry.js";
import { buildMcpManifest } from "../../src/mcp/manifest.js";
import { buildToolCatalog } from "../../web/src/lib/catalog";
import { API } from "../../web/src/lib/site";
import {
  STATUS_CHECKS,
  REST_HEALTH_URL,
  runCheck,
  type CheckIo,
} from "../../web/src/lib/status";

const toolChecks = STATUS_CHECKS.filter((c) => c.tool);

describe("STATUS_CHECKS", () => {
  it("checks every registered tool exactly once", () => {
    const names = toolChecks.map((c) => c.tool);
    expect([...names].sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("calls each tool with the example the Tools page shows", () => {
    const docs = buildToolCatalog(buildMcpManifest({ mcpEndpoint: "/v2/mcp" }));
    for (const check of toolChecks) {
      const doc = docs.find((d) => d.name === check.tool);
      expect(check.args, check.tool).toEqual(doc?.example.args);
    }
  });

  it("adds the REST health check and the MCP initialize check", () => {
    const others = STATUS_CHECKS.filter((c) => !c.tool).map((c) => c.id);
    expect(others.sort()).toEqual(["mcp-initialize", "rest-health"]);
  });

  it("has unique ids and no chat check", () => {
    const ids = STATUS_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of STATUS_CHECKS) {
      expect(c.id.toLowerCase()).not.toContain("chat");
      expect(c.label.toLowerCase()).not.toContain("chat");
    }
  });

  it("reads the REST API's own health address", () => {
    expect(REST_HEALTH_URL).toBe(`${API.origin}/health`);
  });
});

const ok = { ok: true, status: 200 } as Response;
function io(over: Partial<CheckIo> = {}): CheckIo {
  return {
    now: (() => {
      let t = 0;
      return () => (t += 25);
    })(),
    initialize: async () => {},
    fetchHealth: async (_signal: AbortSignal) => ok,
    callTool: async () => ({ kind: "ok" }),
    ...over,
  };
}
const byId = (id: string) => STATUS_CHECKS.find((c) => c.id === id)!;

describe("runCheck", () => {
  it("reports ok with the time taken", async () => {
    const r = await runCheck(toolChecks[0], io());
    expect(r).toMatchObject({ state: "ok", ms: 25 });
  });

  it("says not available when the content is missing, not failed", async () => {
    const r = await runCheck(
      toolChecks[0],
      io({
        callTool: async () => ({ kind: "not-available", message: "None." }),
      }),
    );
    expect(r).toMatchObject({ state: "not-available", note: "None." });
  });

  it("says failed for an error, a rate limit, or a thrown error", async () => {
    const error = await runCheck(
      toolChecks[0],
      io({ callTool: async () => ({ kind: "error", message: "Boom" }) }),
    );
    expect(error).toMatchObject({ state: "failed", note: "Boom" });
    const limited = await runCheck(
      toolChecks[0],
      io({
        callTool: async () => ({ kind: "rate-limited", retryAfterSeconds: 12 }),
      }),
    );
    expect(limited.state).toBe("failed");
    expect(limited.note).toContain("12");
    const thrown = await runCheck(
      byId("mcp-initialize"),
      io({
        initialize: async () => {
          throw new Error("down");
        },
      }),
    );
    expect(thrown).toMatchObject({ state: "failed", note: "down" });
  });

  it("fails the REST check on a non-2xx answer", async () => {
    const r = await runCheck(
      byId("rest-health"),
      io({ fetchHealth: async () => ({ ok: false, status: 503 }) as Response }),
    );
    expect(r).toMatchObject({ state: "failed", note: "HTTP 503" });
  });

  it("fails a check that never answers, and the next check still runs", async () => {
    let aborted = false;
    const hung = io({
      timeoutMs: 20,
      fetchHealth: (signal) =>
        new Promise<Response>(() => {
          signal.addEventListener("abort", () => (aborted = true));
        }),
    });
    const r = await runCheck(byId("rest-health"), hung);
    expect(r.state).toBe("failed");
    expect(r.note).toMatch(/No answer/);
    expect(aborted).toBe(true);
    const next = await runCheck(toolChecks[0], hung);
    expect(next.state).toBe("ok");
  });
});
