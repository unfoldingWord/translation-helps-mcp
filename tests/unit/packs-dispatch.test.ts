/**
 * requestBuild asks tc-study for a pack build, at most once: the guard reads the build status the workflow writes
 * to the bucket, and a KV counter caps the day.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestBuild, type BuildEnv } from "../../src/packs/dispatch";

const NOW = new Date("2026-10-21T12:00:00Z");
const COMPAT = "1";
const LANG = "es-419";
const STATUS_KEY = `status/${COMPAT}/${LANG}.json`;
const COUNTER_KEY = "packs:dispatch:2026-10-21";
const TOKEN_KEY = "packs:github-token:678";
const DISPATCH_URL =
  "https://api.github.com/repos/unfoldingWord/tc-study/actions/workflows/language-packs.yml/dispatches";

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const puts: Array<{ key: string; value: string; options: unknown }> = [];
  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, options?: unknown) => {
      store.set(key, value);
      puts.push({ key, value, options });
    },
    delete: async (key: string) => void store.delete(key),
  };
  return { kv: kv as unknown as KVNamespace, store, puts };
}

function fakeBucket(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const puts: Array<{ key: string; body: string; options: unknown }> = [];
  const bucket = {
    get: async (key: string) => {
      const text = store.get(key);
      return text === undefined
        ? null
        : {
            text: async () => text,
            json: async () => JSON.parse(text) as unknown,
          };
    },
    put: async (key: string, body: string, options?: unknown) => {
      store.set(key, body);
      puts.push({ key, body, options });
    },
    delete: async (key: string) => void store.delete(key),
  };
  return { bucket: bucket as unknown as R2Bucket, store, puts };
}

/** A configured env whose installation token is already cached, so only the dispatch call reaches fetch. */
function setup(
  o: {
    status?: unknown;
    rawStatus?: string;
    kv?: Record<string, string>;
    secrets?: boolean;
  } = {},
) {
  const r2 = fakeBucket(
    o.rawStatus !== undefined
      ? { [STATUS_KEY]: o.rawStatus }
      : o.status !== undefined
        ? { [STATUS_KEY]: JSON.stringify(o.status) }
        : {},
  );
  const kv = fakeKv({
    [TOKEN_KEY]: JSON.stringify({
      token: "ghs_cached",
      until: NOW.getTime() + 30 * 60_000,
    }),
    ...o.kv,
  });
  const secrets =
    o.secrets === false
      ? {}
      : {
          GITHUB_APP_ID: "12345",
          GITHUB_APP_PRIVATE_KEY: "unused-while-cached",
          GITHUB_APP_INSTALLATION_ID: "678",
        };
  const env: BuildEnv = {
    LANGUAGE_PACKS: r2.bucket,
    TRANSLATION_HELPS_CACHE: kv.kv,
    ...secrets,
  };
  const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
  const run = (extra: Partial<Parameters<typeof requestBuild>[0]> = {}) =>
    requestBuild({
      env,
      compat: COMPAT,
      language: LANG,
      reason: "missing",
      now: NOW,
      fetch: fetchImpl as unknown as typeof fetch,
      ...extra,
    });
  return { env, r2, kv, fetchImpl, run };
}

describe("requestBuild guard", () => {
  it("leaves a build running for 1 h alone", async () => {
    const t = setup({
      status: {
        state: "running",
        at: hoursAgo(1),
        failures: 0,
        run: "https://run/1",
      },
    });
    expect(await t.run()).toBe("running");
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("still waits for a build running 5 h (the job may take 300 min)", async () => {
    const t = setup({
      status: {
        state: "running",
        at: hoursAgo(5),
        failures: 0,
        run: "https://run/1",
      },
    });
    expect(await t.run()).toBe("running");
  });

  it("dispatches again when a build has been `running` for more than 5.5 h", async () => {
    const t = setup({
      status: {
        state: "running",
        at: hoursAgo(6),
        failures: 0,
        run: "https://run/1",
      },
    });
    expect(await t.run()).toBe("dispatched");
    expect(t.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cools down for 24 h after a failure", async () => {
    const t = setup({
      status: {
        state: "failed",
        at: hoursAgo(2),
        failures: 1,
        run: "https://run/1",
      },
    });
    expect(await t.run()).toBe("cooling");
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("tries again a day after a failure", async () => {
    const t = setup({
      status: {
        state: "failed",
        at: hoursAgo(25),
        failures: 1,
        run: "https://run/1",
      },
    });
    expect(await t.run()).toBe("dispatched");
  });

  it("stops after three failures, until someone resets it", async () => {
    const t = setup({
      status: {
        state: "failed",
        at: hoursAgo(48),
        failures: 3,
        run: "https://run/1",
      },
    });
    expect(await t.run()).toBe("stopped");
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("caps the day at 20 dispatches", async () => {
    const t = setup({ kv: { [COUNTER_KEY]: "20" } });
    expect(await t.run()).toBe("capped");
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("is unconfigured without the App secrets, and fetches nothing", async () => {
    const t = setup({ secrets: false });
    expect(await t.run()).toBe("unconfigured");
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.r2.puts).toHaveLength(0);
  });

  it("is unconfigured without the bucket", async () => {
    const t = setup();
    const env: BuildEnv = { ...t.env, LANGUAGE_PACKS: undefined };
    expect(await t.run({ env })).toBe("unconfigured");
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("treats an unparsable status as none", async () => {
    const t = setup({ rawStatus: "{not json" });
    expect(await t.run()).toBe("dispatched");
    expect(JSON.parse(t.r2.store.get(STATUS_KEY) ?? "")).toMatchObject({
      state: "running",
      failures: 0,
    });
  });
});

describe("requestBuild dispatch", () => {
  // The failure tests log on purpose; keep the run readable.
  beforeEach(
    () => void vi.spyOn(console, "error").mockImplementation(() => {}),
  );
  afterEach(() => vi.restoreAllMocks());

  it("posts the workflow dispatch for master with the language, publish mode and staging by default", async () => {
    const t = setup();
    expect(await t.run()).toBe("dispatched");
    const [url, init] = t.fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(DISPATCH_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      ref: "master",
      inputs: { language: LANG, mode: "publish", target: "staging" },
    });
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer ghs_cached");
    expect(headers.get("Accept")).toBe("application/vnd.github+json");
    expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(headers.get("User-Agent")).toBeTruthy();
  });

  it("sends the configured target", async () => {
    const t = setup();
    await t.run({ env: { ...t.env, PACKS_TARGET: "production" } });
    const [, init] = t.fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).inputs.target).toBe("production");
  });

  it("marks the language running before calling GitHub, keeping its failures", async () => {
    const t = setup({
      status: {
        state: "failed",
        at: hoursAgo(30),
        failures: 2,
        run: "https://run/1",
      },
    });
    let statusAtCall: unknown = null;
    t.fetchImpl.mockImplementation(async () => {
      statusAtCall = JSON.parse(t.r2.store.get(STATUS_KEY) ?? "null");
      return new Response(null, { status: 204 });
    });
    expect(await t.run()).toBe("dispatched");
    expect(statusAtCall).toEqual({
      state: "running",
      at: NOW.toISOString(),
      failures: 2,
      run: "dispatched",
    });
    expect(t.r2.puts[0].options).toEqual({
      httpMetadata: {
        contentType: "application/json",
        cacheControl: "no-cache",
      },
    });
  });

  it("counts the dispatch in the day's counter, with a two-day expiry", async () => {
    const t = setup({ kv: { [COUNTER_KEY]: "4" } });
    await t.run();
    expect(t.kv.store.get(COUNTER_KEY)).toBe("5");
    const put = t.kv.puts.find((p) => p.key === COUNTER_KEY);
    expect(put?.options).toEqual({ expirationTtl: 2 * 24 * 3600 });
  });

  it("puts the previous status back and answers `error` when GitHub refuses", async () => {
    const previous = JSON.stringify({
      state: "failed",
      at: hoursAgo(30),
      failures: 1,
      run: "https://run/1",
    });
    const t = setup({ rawStatus: previous });
    t.fetchImpl.mockImplementation(
      async () => new Response("nope", { status: 422 }),
    );
    expect(await t.run()).toBe("error");
    expect(t.r2.store.get(STATUS_KEY)).toBe(previous);
  });

  it("removes its `running` mark when there was no status and GitHub cannot be reached", async () => {
    const t = setup();
    t.fetchImpl.mockImplementation(async () => {
      throw new Error("network down");
    });
    expect(await t.run()).toBe("error");
    expect(t.r2.store.has(STATUS_KEY)).toBe(false);
  });
});
