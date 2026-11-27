import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleV3StatelessMcpRequest } from "../../src/mcp/stateless";
import type { Env } from "../../src/mcp/agent";
import { ADAPTERS } from "../../src/packs3/answer";
import { resetPacks3CachesForTests } from "../../src/packs3/catalogs";
import { warnOnce } from "../../src/packs3/keys";

const KEY =
  "78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911";

const API_ANSWER = {
  language: "en",
  results: [
    { path: "bible/kt/grace", resourceType: "tw", title: "grace", score: 1 },
  ],
};
const PACK_ANSWER = {
  language: "en",
  results: [
    { path: "bible/kt/grace", resourceType: "tw", title: "grace", score: 2 },
  ],
};

function env(extra: Record<string, unknown>): Env {
  const API = {
    fetch: vi.fn(
      async () => new Response(JSON.stringify(API_ANSWER), { status: 200 }),
    ),
  } as unknown as Fetcher;
  return {
    API,
    LANGUAGE_PACKS: {} as R2Bucket,
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: KEY,
    ...extra,
  } as unknown as Env;
}

async function call(
  e: Env,
  headers: Record<string, string> = {},
  method = "tools/call",
): Promise<{ text: string; body: any }> {
  const req = new Request("http://x/v3/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params:
        method === "tools/call"
          ? { name: "th_search", arguments: { query: "grace", language: "en" } }
          : {},
    }),
  });
  const res = await handleV3StatelessMcpRequest(req, e);
  const text = await res.text();
  return { text, body: JSON.parse(text) };
}

type Run = () => Promise<unknown>;
function adapter(run: Run) {
  ADAPTERS.push({ match: (p: string) => p === "/api/v1/search", run });
}

describe("packs3 marks under PACKS_V3_DEBUG", () => {
  beforeEach(() => {
    ADAPTERS.length = 0;
    resetPacks3CachesForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("a served format 3 answer carries _meta._packs3 { served: true }", async () => {
    adapter(async () => PACK_ANSWER);
    const { body } = await call(env({ PACKS_V3_DEBUG: "on" }));
    expect(body.result._meta._packs3).toEqual({ served: true });
    expect(body.result.structuredContent.results[0].score).toBe(2);
  });

  it("adapter-undefined carries the adapter's own inner reason as detail when it logged one", async () => {
    adapter(async () => {
      warnOnce("en", "unverified-resource");
      return undefined;
    });
    const r = await call(env({ PACKS_V3_DEBUG: "on" }));
    expect(r.body.result._meta._packs3).toEqual({
      fallback: "adapter-undefined",
      detail: "unverified-resource",
    });
    // the inner reason is noted even when its log line was already written once
    const again = await call(env({ PACKS_V3_DEBUG: "on" }));
    expect(again.body.result._meta._packs3.detail).toBe("unverified-resource");
    // a reason logged before the adapter ran is not this call's detail
    ADAPTERS.length = 0;
    warnOnce("en", "readers-busy");
    adapter(async () => undefined);
    const plain = await call(env({ PACKS_V3_DEBUG: "on" }));
    expect(plain.body.result._meta._packs3).toEqual({
      fallback: "adapter-undefined",
    });
  });

  it("a fallback carries the reason", async () => {
    adapter(async () => undefined);
    let r = await call(env({ PACKS_V3_DEBUG: "on" }));
    expect(r.body.result._meta._packs3).toEqual({
      fallback: "adapter-undefined",
    });
    expect(r.body.result.structuredContent.results[0].score).toBe(1);

    ADAPTERS.length = 0;
    adapter(async () => {
      throw new Error("boom");
    });
    r = await call(env({ PACKS_V3_DEBUG: "on" }));
    expect(r.body.result._meta._packs3).toEqual({
      fallback: "adapter-exception",
    });

    ADAPTERS.length = 0;
    r = await call(env({ PACKS_V3_DEBUG: "on" }));
    expect(r.body.result._meta._packs3).toEqual({ fallback: "no-adapter" });

    r = await call(env({ PACKS_V3_DEBUG: "on", PACKS_V3: "off" }));
    expect(r.body.result._meta._packs3).toEqual({ fallback: "v3-off" });

    r = await call(env({ PACKS_V3_DEBUG: "on", PACKS_V3_TRUSTED_KEYS: "" }));
    expect(r.body.result._meta._packs3).toEqual({ fallback: "no-keys" });

    r = await call(env({ PACKS_V3_DEBUG: "on", LANGUAGE_PACKS: undefined }));
    expect(r.body.result._meta._packs3).toEqual({ fallback: "no-packs" });
  });

  it("x-th-packs3: off is marked mode-off; only with no adapter is marked no-adapter", async () => {
    adapter(async () => PACK_ANSWER);
    let r = await call(env({ PACKS_V3_DEBUG: "on" }), { "x-th-packs3": "off" });
    expect(r.body.result._meta._packs3).toEqual({ fallback: "mode-off" });
    expect(r.body.result.structuredContent.results[0].score).toBe(1);

    ADAPTERS.length = 0;
    r = await call(env({ PACKS_V3_DEBUG: "on" }), { "x-th-packs3": "only" });
    expect(r.body.result._meta._packs3).toEqual({ fallback: "no-adapter" });
  });

  it("a request that never reads (tools/list) carries no mark", async () => {
    const { text } = await call(
      env({ PACKS_V3_DEBUG: "on" }),
      {},
      "tools/list",
    );
    expect(text).not.toContain("_packs3");
  });

  it("without PACKS_V3_DEBUG no mark appears anywhere", async () => {
    for (const debug of [undefined, "off", ""]) {
      for (const setup of [
        () => adapter(async () => PACK_ANSWER),
        () => adapter(async () => undefined),
        () => {},
      ]) {
        ADAPTERS.length = 0;
        setup();
        const variants: Record<string, string>[] = [
          {},
          { "x-th-packs3": "only" },
          { "x-th-packs3": "off" },
        ];
        for (const headers of variants) {
          const r = await call(env({ PACKS_V3_DEBUG: debug }), headers);
          expect(r.text).not.toContain("_packs3");
          expect(r.body.result._meta).toBeUndefined();
        }
      }
    }
  });
});
