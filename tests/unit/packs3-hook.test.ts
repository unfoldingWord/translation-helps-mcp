import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "../../src/mcp/apiClient";
import { ADAPTERS, answerFromPacks3 } from "../../src/packs3/answer";
import { resetPacks3CachesForTests } from "../../src/packs3/catalogs";
import { packs3ModeFromRequest } from "../../src/mcp/apiClient";
import { wranglerVars } from "./wranglerToml";

const KEY =
  "78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911";

const PATHS: Array<[string, Record<string, string | number | undefined>]> = [
  ["/api/v1/scripture", { reference: "John 3:16", language: "en" }],
  ["/api/v1/translation-notes", { reference: "John 3:16", language: "en" }],
  ["/api/v1/translation-questions", { reference: "Gen 1", language: "es" }],
  ["/api/v1/translation-word-links", { reference: "Gen 1:1", language: "en" }],
  ["/api/v1/academy/article", { path: "translate/figs-metaphor" }],
  ["/api/v1/words/article", { path: "bible/kt/god", language: undefined }],
  ["/api/v1/search", { query: "grace", language: "en" }],
];

function fakeApi() {
  const urls: string[] = [];
  const API = {
    fetch: vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ from: "api" }), { status: 200 });
    }),
  } as unknown as Fetcher;
  return { API, urls };
}

const v3On = {
  LANGUAGE_PACKS: {} as R2Bucket,
  PACKS_V3: "on",
  PACKS_V3_TRUSTED_KEYS: KEY,
};

describe("packs3 hook in ApiClient.get", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ADAPTERS.length = 0;
    resetPacks3CachesForTests();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("no adapters → every get calls the API with the same URL as before", async () => {
    for (const [path, params] of PATHS) {
      const a = fakeApi();
      const b = fakeApi();
      await new ApiClient({ API: a.API }).get(path, params);
      await new ApiClient({ API: b.API }, { packs3: v3On }).get(path, params);
      expect(b.urls).toEqual(a.urls);
      expect(b.urls).toHaveLength(1);
      expect(a.urls[0]).toContain(`http://internal${path}`);
    }
  });

  it("an adapter answer is returned and the API is not called", async () => {
    ADAPTERS.push({
      match: (p) => p === "/api/v1/scripture",
      run: async () => ({ from: "pack" }),
    });
    const { API, urls } = fakeApi();
    const r = await new ApiClient({ API }, { packs3: v3On }).get(
      "/api/v1/scripture",
      { language: "en" },
    );
    expect(r).toEqual({ from: "pack" });
    expect(urls).toHaveLength(0);
  });

  it("an adapter 404 (a proven miss) throws the same ApiClientError the API's 404 gives, without calling the API", async () => {
    const body = {
      error: {
        code: "NOT_FOUND",
        message: 'Translation Word not found at path: "x"',
        retryable: false,
      },
    };
    const res404 = () =>
      new Response(JSON.stringify(body), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    const catchGet = (c: ApiClient) =>
      c.get("/api/v1/words/x", { language: "en" }).then(
        () => undefined,
        (e: unknown) => e,
      );
    const api = {
      fetch: vi.fn(async () => res404()),
    } as unknown as Fetcher;
    const fromApi = await catchGet(new ApiClient({ API: api }));
    ADAPTERS.push({
      match: (p) => p.startsWith("/api/v1/words/"),
      run: async () => res404(),
    });
    const { API, urls } = fakeApi();
    const fromPack = await catchGet(new ApiClient({ API }, { packs3: v3On }));
    expect(urls).toHaveLength(0);
    expect(fromPack).toBeInstanceOf(ApiClientError);
    expect(fromApi).toBeInstanceOf(ApiClientError);
    const fields = (e: any) => [e.code, e.message, e.status, e.retryable];
    expect(fields(fromPack)).toEqual(fields(fromApi));
    expect(fields(fromPack)).toEqual([
      "NOT_FOUND",
      'Translation Word not found at path: "x"',
      404,
      false,
    ]);
  });

  it("an adapter Response that is not a 404 falls back to the API", async () => {
    ADAPTERS.push({
      match: () => true,
      run: async () => new Response("{}", { status: 500 }),
    });
    const { API, urls } = fakeApi();
    const r = await new ApiClient({ API }, { packs3: v3On }).get(
      "/api/v1/words/x",
      { language: "en" },
    );
    expect(r).toEqual({ from: "api" });
    expect(urls).toHaveLength(1);
  });

  it("adapter undefined or throwing → API called once, fallback logged once per (lang, reason)", async () => {
    let mode: "undef" | "throw" = "undef";
    ADAPTERS.push({
      match: () => true,
      run: async () => {
        if (mode === "throw") throw new Error("boom");
        return undefined;
      },
    });
    const { API, urls } = fakeApi();
    const c = new ApiClient({ API }, { packs3: v3On });
    await c.get("/api/v1/x", { language: "en" });
    expect(urls).toHaveLength(1);
    await c.get("/api/v1/x", { language: "en" });
    expect(urls).toHaveLength(2);
    const undefLogs = () =>
      warn.mock.calls.filter(
        (x) =>
          (x[1] as { reason: string }).reason === "adapter-undefined" &&
          (x[1] as { lang: string }).lang === "en",
      );
    expect(undefLogs()).toHaveLength(1);
    mode = "throw";
    await c.get("/api/v1/x", { language: "en" });
    await c.get("/api/v1/x", { language: "en" });
    expect(urls).toHaveLength(4);
    expect(
      warn.mock.calls.filter(
        (x) => (x[1] as { reason: string }).reason === "adapter-exception",
      ),
    ).toHaveLength(1);
    expect(warn.mock.calls[0]![0]).toBe("packs3 fallback");
  });

  it("PACKS_V3 off, or no keys → API called, adapters never run", async () => {
    const run = vi.fn(async () => ({ from: "pack" }));
    ADAPTERS.push({ match: () => true, run });
    for (const env of [
      { ...v3On, PACKS_V3: "off" },
      { ...v3On, PACKS_V3_TRUSTED_KEYS: "" },
      { ...v3On, PACKS_V3_TRUSTED_KEYS: undefined },
    ]) {
      const { API, urls } = fakeApi();
      const r = await new ApiClient({ API }, { packs3: env }).get("/api/v1/x");
      expect(r).toEqual({ from: "api" });
      expect(urls).toHaveLength(1);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("x-th-packs3 is ignored without PACKS_V3_DEBUG; off skips adapters; only gives PACKS3_FALLBACK without an API call", async () => {
    const req = (v: string) =>
      new Request("http://x", { headers: { "x-th-packs3": v } });
    expect(packs3ModeFromRequest(req("only"), {})).toBeUndefined();
    expect(
      packs3ModeFromRequest(req("only"), { PACKS_V3_DEBUG: "off" }),
    ).toBeUndefined();
    expect(packs3ModeFromRequest(req("off"), { PACKS_V3_DEBUG: "on" })).toBe(
      "off",
    );
    expect(packs3ModeFromRequest(req("bogus"), { PACKS_V3_DEBUG: "on" })).toBe(
      undefined,
    );

    // Through the env the tools receive: PACKS3_MODE is ignored without PACKS_V3_DEBUG.
    const run = vi.fn(async () => ({ from: "pack" }));
    ADAPTERS.push({ match: () => true, run });
    const a = fakeApi();
    await new ApiClient({ API: a.API, ...v3On, PACKS3_MODE: "only" }).get(
      "/api/v1/x",
    );
    // mode ignored: plain auto, so the adapter answers and the API is not called
    expect(a.urls).toHaveLength(0);
    expect(run).toHaveBeenCalledTimes(1);
    run.mockClear();

    const b = fakeApi();
    await new ApiClient(
      { API: b.API },
      { packs3: { ...v3On, mode: "off" } },
    ).get("/api/v1/x");
    expect(b.urls).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();

    ADAPTERS.length = 0;
    const c = fakeApi();
    const only = new ApiClient(
      { API: c.API },
      { packs3: { ...v3On, mode: "only" } },
    );
    const err = (await only.get("/api/v1/x").catch((e) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.code).toBe("PACKS3_FALLBACK");
    expect(err.status).toBe(404);
    expect(c.urls).toHaveLength(0);

    ADAPTERS.push({ match: () => true, run });
    // only + an adapter answer: the answer
    run.mockClear();
    const d = new ApiClient({
      API: c.API,
      ...v3On,
      PACKS_V3_DEBUG: "on",
      PACKS3_MODE: "only",
    });
    expect(await d.get("/api/v1/x")).toEqual({ from: "pack" });
  });

  it("answerFromPacks3 gives undefined with no matching adapter", async () => {
    expect(await answerFromPacks3(v3On, "/api/v1/none", {})).toBeUndefined();
  });

  it("production config", () => {
    const vars = wranglerVars();
    const prod = vars["env.production"]!;
    expect(prod.PACKS_V3).toBe("off");
    expect(prod.PACKS_V3_TRUSTED_KEYS).toBe("");
    expect("PACKS_V3_DEBUG" in prod).toBe(false);
    for (const s of ["previews", "env.preview"]) {
      expect(vars[s]!.PACKS_V3_TRUSTED_KEYS).toBe(KEY);
      expect(vars[s]!.PACKS_V3_DEBUG).toBe("on");
    }
  });
});
