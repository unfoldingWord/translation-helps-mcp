/**
 * requestBuild asks tc-study for a pack build, at most once: the guard reads the build status the workflow writes
 * to the bucket, and a KV counter caps the day.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CURRENT_PACK_COMPAT,
  CURRENT_PARTS_COMPAT,
  PARTS_DAILY_CAP,
  isBuildableCompat,
  isPartsCompat,
  partsDispatchEnabled,
  requestBuild,
  type BuildEnv,
} from "../../src/packs/dispatch";
import { wranglerToml, wranglerVars } from "./wranglerToml";

const NOW = new Date("2026-10-21T12:00:00Z");
const COMPAT = "f1.1-u2.3.0-p6000230-q9-a12-t1";
const LANG = "es-419";
const STATUS_KEY = `status/${COMPAT}/${LANG}.json`;
const COUNTER_KEY = "packs:dispatch:2026-10-21";
const PARTS_COUNTER_KEY = "packs:dispatch-parts:2026-10-21";
const PARTS_STATUS_KEY = `status/${CURRENT_PARTS_COMPAT}/${LANG}.json`;
const TOKEN_KEY = "packs:github-token:678";
const DISPATCH_URL =
  "https://api.github.com/repos/unfoldingWord/tc-study/actions/workflows/language-packs.yml/dispatches";

/** A real App key, for the tests that mint a fresh installation token. */
async function testKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = Buffer.from(der).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

/** `failing` makes every get or put on keys starting with that prefix reject, like KV's 1-write/s 429. */
function fakeKv(
  initial: Record<string, string> = {},
  failing: { get?: string; put?: string } = {},
) {
  const store = new Map(Object.entries(initial));
  const puts: Array<{ key: string; value: string; options: unknown }> = [];
  const kv = {
    get: async (key: string) => {
      if (failing.get !== undefined && key.startsWith(failing.get))
        throw new Error("KV get failed");
      return store.get(key) ?? null;
    },
    put: async (key: string, value: string, options?: unknown) => {
      if (failing.put !== undefined && key.startsWith(failing.put))
        throw new Error("KV PUT failed: 429 Too Many Requests");
      store.set(key, value);
      puts.push({ key, value, options });
    },
    delete: async (key: string) => void store.delete(key),
  };
  return { kv: kv as unknown as KVNamespace, store, puts };
}

/** An R2 bucket with etags, conditional puts (`onlyIf.etagMatches`) and head. */
function fakeBucket(initial: Record<string, string> = {}) {
  const store = new Map<string, { text: string; etag: string }>();
  let version = 0;
  const write = (key: string, text: string) => {
    const etag = `etag-${++version}`;
    store.set(key, { text, etag });
    return { key, etag };
  };
  for (const [key, text] of Object.entries(initial)) write(key, text);
  const puts: Array<{ key: string; body: string; options: unknown }> = [];
  const bucket = {
    get: async (key: string) => {
      const entry = store.get(key);
      return entry === undefined
        ? null
        : {
            etag: entry.etag,
            text: async () => entry.text,
            json: async () => JSON.parse(entry.text) as unknown,
          };
    },
    head: async (key: string) => {
      const entry = store.get(key);
      return entry === undefined ? null : { key, etag: entry.etag };
    },
    put: async (
      key: string,
      body: string,
      options?: { onlyIf?: { etagMatches?: string } },
    ) => {
      const match = options?.onlyIf?.etagMatches;
      if (match !== undefined && store.get(key)?.etag !== match) return null;
      puts.push({ key, body, options });
      return write(key, body);
    },
    delete: async (key: string) => void store.delete(key),
  };
  const text = (key: string) => store.get(key)?.text;
  return { bucket: bucket as unknown as R2Bucket, text, write, puts };
}

/** A configured env whose installation token is already cached, so only the dispatch call reaches fetch. */
function setup(
  o: {
    status?: unknown;
    rawStatus?: string;
    kv?: Record<string, string>;
    kvFailing?: { get?: string; put?: string };
    secrets?: boolean;
    privateKey?: string;
    /** PACKS_PARTS_DISPATCH override for the test env. */
    partsDispatch?: string;
  } = {},
) {
  const r2 = fakeBucket(
    o.rawStatus !== undefined
      ? { [STATUS_KEY]: o.rawStatus }
      : o.status !== undefined
        ? { [STATUS_KEY]: JSON.stringify(o.status) }
        : {},
  );
  const kv = fakeKv(
    {
      [TOKEN_KEY]: JSON.stringify({
        token: "ghs_cached",
        until: NOW.getTime() + 30 * 60_000,
      }),
      ...o.kv,
    },
    o.kvFailing,
  );
  const secrets =
    o.secrets === false
      ? {}
      : {
          GITHUB_APP_ID: "12345",
          GITHUB_APP_PRIVATE_KEY: o.privateKey ?? "unused-while-cached",
          GITHUB_APP_INSTALLATION_ID: "678",
        };
  const env: BuildEnv = {
    LANGUAGE_PACKS: r2.bucket,
    TRANSLATION_HELPS_CACHE: kv.kv,
    ...secrets,
    ...(o.partsDispatch !== undefined
      ? { PACKS_PARTS_DISPATCH: o.partsDispatch }
      : {}),
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

describe("compats", () => {
  it("the parts compat is tc-study's `packs-status --print-compat --parts`", () => {
    expect(CURRENT_PARTS_COMPAT).toBe("f2.0-u2.3.0-p6000230-q9-a12-t1");
    expect(CURRENT_PACK_COMPAT).toBe(COMPAT);
  });

  it("a parts compat is one whose format major is 2 or more", () => {
    expect(isPartsCompat(CURRENT_PARTS_COMPAT)).toBe(true);
    expect(isPartsCompat("f2.0-u2.3.0-p6000229-q9-a12-t1")).toBe(true);
    expect(isPartsCompat("f10.1-u2.3.0-p6000230-q9-a12-t1")).toBe(true);
    expect(isPartsCompat(CURRENT_PACK_COMPAT)).toBe(false);
    expect(isPartsCompat("f1.9-u2.3.0-p6000230-q8-a11-t1")).toBe(false);
  });

  it("only the two current compats can be built", () => {
    expect(isBuildableCompat(CURRENT_PACK_COMPAT)).toBe(true);
    expect(isBuildableCompat(CURRENT_PARTS_COMPAT)).toBe(true);
    expect(isBuildableCompat("f1.1-u2.3.0-p6000229-q8-a11-t1")).toBe(false);
    expect(isBuildableCompat("f2.0-u2.3.0-p6000229-q9-a12-t1")).toBe(false);
    expect(isBuildableCompat("")).toBe(false);
  });
});

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

  it("dispatches again when a build has been `running` for more than 5.5 h, counting the dead run as a failure", async () => {
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
    expect(JSON.parse(t.r2.text(STATUS_KEY) ?? "")).toMatchObject({
      state: "running",
      failures: 1,
    });
  });

  it("stops a language whose runs die before writing a result, after three stale `running` marks in a row", async () => {
    // A token cached for the whole span, so only the dispatches reach fetch.
    const t = setup({
      kv: {
        [TOKEN_KEY]: JSON.stringify({
          token: "ghs_cached",
          until: NOW.getTime() + 72 * 3_600_000,
        }),
      },
    });
    const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
    // Each run dies early: only the Worker's own mark is ever in the bucket.
    expect(await t.run({ now: at(0) })).toBe("dispatched");
    expect(await t.run({ now: at(6) })).toBe("dispatched");
    expect(await t.run({ now: at(12) })).toBe("dispatched");
    expect(await t.run({ now: at(18) })).toBe("stopped");
    expect(await t.run({ now: at(48) })).toBe("stopped");
    expect(t.fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(t.r2.text(STATUS_KEY) ?? "")).toMatchObject({
      state: "failed",
      failures: 3,
    });
  });

  it("does not count a running mark that is still fresh, nor a failed one, as one more failure", async () => {
    const t = setup({
      status: {
        state: "failed",
        at: hoursAgo(25),
        failures: 1,
        run: "https://run/1",
      },
    });
    expect(await t.run()).toBe("dispatched");
    expect(JSON.parse(t.r2.text(STATUS_KEY) ?? "").failures).toBe(1);
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

  it("counts a code rebuild against the day's cap, like a stale one", async () => {
    const full = setup({ kv: { [COUNTER_KEY]: "20" } });
    expect(await full.run({ reason: "code" })).toBe("capped");
    expect(full.fetchImpl).not.toHaveBeenCalled();
    const t = setup({ kv: { [COUNTER_KEY]: "4" } });
    expect(await t.run({ reason: "code" })).toBe("dispatched");
    expect(t.kv.store.get(COUNTER_KEY)).toBe("5");
  });

  it("lets builds the cron's check asks for through a full cap, without counting them", async () => {
    const t = setup({ kv: { [COUNTER_KEY]: "20" } });
    expect(await t.run({ reason: "daily" })).toBe("dispatched");
    expect(t.kv.store.get(COUNTER_KEY)).toBe("20");
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
    expect(JSON.parse(t.r2.text(STATUS_KEY) ?? "")).toMatchObject({
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
      inputs: {
        language: LANG,
        mode: "publish",
        target: "staging",
        compat: COMPAT,
      },
    });
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer ghs_cached");
    expect(headers.get("Accept")).toBe("application/vnd.github+json");
    expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(headers.get("User-Agent")).toBeTruthy();
  });

  it("sends the f1.1 body byte for byte as the deployed Worker does, with no parts input", async () => {
    const t = setup();
    expect(await t.run()).toBe("dispatched");
    const [, init] = t.fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.body).toBe(
      `{"ref":"master","inputs":{"language":"es-419","mode":"publish","target":"staging","compat":"${COMPAT}"}}`,
    );
  });

  it("asks the workflow for parts when the compat is the parts compat, and marks that compat running", async () => {
    const t = setup({ partsDispatch: "on" });
    expect(await t.run({ compat: CURRENT_PARTS_COMPAT })).toBe("dispatched");
    const [url, init] = t.fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(DISPATCH_URL);
    expect(JSON.parse(String(init.body))).toEqual({
      ref: "master",
      inputs: {
        language: LANG,
        mode: "publish",
        target: "staging",
        compat: CURRENT_PARTS_COMPAT,
        parts: "true",
      },
    });
    expect(
      JSON.parse(
        t.r2.text(`status/${CURRENT_PARTS_COMPAT}/${LANG}.json`) ?? "",
      ),
    ).toMatchObject({ state: "running", run: "dispatched" });
    expect(t.r2.text(STATUS_KEY)).toBeUndefined();
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
      statusAtCall = JSON.parse(t.r2.text(STATUS_KEY) ?? "null");
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

  it("does not spend the day's cap on a dispatch GitHub refuses", async () => {
    const t = setup({ kv: { [COUNTER_KEY]: "4" } });
    t.fetchImpl.mockImplementation(
      async () => new Response("nope", { status: 500 }),
    );
    expect(await t.run()).toBe("error");
    expect(t.kv.store.get(COUNTER_KEY)).toBe("4");
  });

  it("counts only once GitHub has accepted the dispatch", async () => {
    const t = setup({ kv: { [COUNTER_KEY]: "4" } });
    let counterAtCall: string | undefined;
    t.fetchImpl.mockImplementation(async () => {
      counterAtCall = t.kv.store.get(COUNTER_KEY);
      return new Response(null, { status: 204 });
    });
    expect(await t.run()).toBe("dispatched");
    expect(counterAtCall).toBe("4");
    expect(t.kv.store.get(COUNTER_KEY)).toBe("5");
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
    expect(t.r2.text(STATUS_KEY)).toBe(previous);
  });

  it("removes its `running` mark when there was no status and GitHub cannot be reached", async () => {
    const t = setup();
    t.fetchImpl.mockImplementation(async () => {
      throw new Error("network down");
    });
    expect(await t.run()).toBe("error");
    expect(t.r2.text(STATUS_KEY)).toBeUndefined();
  });

  it("does not overwrite a status the workflow wrote after the mark", async () => {
    const previous = JSON.stringify({
      state: "failed",
      at: hoursAgo(30),
      failures: 1,
      run: "https://run/1",
    });
    const newer = JSON.stringify({
      state: "running",
      at: NOW.toISOString(),
      failures: 1,
      run: "https://run/2",
    });
    const t = setup({ rawStatus: previous });
    t.fetchImpl.mockImplementation(async () => {
      t.r2.write(STATUS_KEY, newer);
      return new Response("nope", { status: 500 });
    });
    expect(await t.run()).toBe("error");
    expect(t.r2.text(STATUS_KEY)).toBe(newer);
  });

  it("does not delete a status the workflow wrote after the mark", async () => {
    const newer = JSON.stringify({
      state: "running",
      at: NOW.toISOString(),
      failures: 0,
      run: "https://run/2",
    });
    const t = setup();
    t.fetchImpl.mockImplementation(async () => {
      t.r2.write(STATUS_KEY, newer);
      throw new Error("network down");
    });
    expect(await t.run()).toBe("error");
    expect(t.r2.text(STATUS_KEY)).toBe(newer);
  });

  it("drops a cached token GitHub rejects and retries once with a fresh one", async () => {
    const t = setup({ privateKey: await testKeyPem() });
    const dispatchAuths: string[] = [];
    t.fetchImpl.mockImplementation((async (url: string, init: RequestInit) => {
      if (url.endsWith("/access_tokens")) {
        return Response.json({ token: "ghs_fresh" }, { status: 201 });
      }
      const auth = new Headers(init.headers).get("Authorization") ?? "";
      dispatchAuths.push(auth);
      return new Response(null, {
        status: auth === "Bearer ghs_cached" ? 401 : 204,
      });
    }) as unknown as () => Promise<Response>);
    expect(await t.run()).toBe("dispatched");
    expect(dispatchAuths).toEqual(["Bearer ghs_cached", "Bearer ghs_fresh"]);
    expect(JSON.parse(t.kv.store.get(TOKEN_KEY) ?? "{}").token).toBe(
      "ghs_fresh",
    );
  });

  it("gives up after one retry when the fresh token is rejected too", async () => {
    const t = setup({ privateKey: await testKeyPem() });
    let dispatches = 0;
    t.fetchImpl.mockImplementation((async (url: string) => {
      if (url.endsWith("/access_tokens")) {
        return Response.json({ token: "ghs_fresh" }, { status: 201 });
      }
      dispatches++;
      return new Response(null, { status: 401 });
    }) as unknown as () => Promise<Response>);
    expect(await t.run()).toBe("error");
    expect(dispatches).toBe(2);
    expect(t.kv.store.has(TOKEN_KEY)).toBe(false);
    expect(t.r2.text(STATUS_KEY)).toBeUndefined();
  });
});

describe("parts dispatch behind PACKS_PARTS_DISPATCH", () => {
  const PRODUCTION = { PACKS_TARGET: "production" } as const;
  const STAGING = { PACKS_TARGET: "staging" } as const;

  it("is on only for the exact string `on`", () => {
    expect(partsDispatchEnabled({ PACKS_PARTS_DISPATCH: "on" })).toBe(true);
    for (const value of [undefined, "", "off", "ON", "true", "1", " on"]) {
      expect(partsDispatchEnabled({ PACKS_PARTS_DISPATCH: value })).toBe(false);
    }
  });

  it("asks for no parts build in production without the flag, touching neither GitHub, the status nor the counters", async () => {
    const t = setup();
    const env: BuildEnv = { ...t.env, ...PRODUCTION };
    expect(await t.run({ env, compat: CURRENT_PARTS_COMPAT })).toBe(
      "parts-off",
    );
    expect(
      await t.run({ env, compat: CURRENT_PARTS_COMPAT, reason: "daily" }),
    ).toBe("parts-off");
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.r2.puts).toHaveLength(0);
    expect(t.kv.puts).toHaveLength(0);
  });

  it("still dispatches f1.1 in production without the flag", async () => {
    const t = setup();
    const env: BuildEnv = { ...t.env, ...PRODUCTION };
    expect(await t.run({ env })).toBe("dispatched");
    const [, init] = t.fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.body).toBe(
      `{"ref":"master","inputs":{"language":"es-419","mode":"publish","target":"production","compat":"${COMPAT}"}}`,
    );
  });

  it("dispatches a staging parts build with parts: true when the preview env turns the flag on", async () => {
    const t = setup({ partsDispatch: "on" });
    const env: BuildEnv = { ...t.env, ...STAGING };
    expect(await t.run({ env, compat: CURRENT_PARTS_COMPAT })).toBe(
      "dispatched",
    );
    const [, init] = t.fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      ref: "master",
      inputs: {
        language: LANG,
        mode: "publish",
        target: "staging",
        compat: CURRENT_PARTS_COMPAT,
        parts: "true",
      },
    });
  });

  it("sends the parts body byte for byte under PACKS_TARGET production once the flag is on", async () => {
    const t = setup({ partsDispatch: "on" });
    const env: BuildEnv = { ...t.env, ...PRODUCTION };
    expect(await t.run({ env, compat: CURRENT_PARTS_COMPAT })).toBe(
      "dispatched",
    );
    const [, init] = t.fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.body).toBe(
      `{"ref":"master","inputs":{"language":"es-419","mode":"publish","target":"production","compat":"${CURRENT_PARTS_COMPAT}","parts":"true"}}`,
    );
  });
});

describe("wrangler.toml", () => {
  it("turns parts dispatch on for both preview and production Workers, as partsDispatchEnabled reads it", () => {
    const vars = wranglerVars();
    const preview = vars["env.preview"]!;
    const production = vars["env.production"]!;
    expect(partsDispatchEnabled(preview)).toBe(true);
    expect(preview.PACKS_TARGET).toBe("staging");
    expect(partsDispatchEnabled(production)).toBe(true);
    expect(production.PACKS_TARGET).toBe("production");
    // Nowhere else: the top-level config deploys under the production Worker's name.
    const set = wranglerToml()
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("#"))
      .filter((l) => l.includes("PACKS_PARTS_DISPATCH"));
    expect(set).toHaveLength(2);
    expect(
      Object.entries(vars)
        .filter(([, v]) => "PACKS_PARTS_DISPATCH" in v)
        .map(([section]) => section)
        .sort(),
    ).toEqual(["env.preview", "env.production"]);
  });
});

describe("the parts daily cap, apart from f1.1's", () => {
  it("is 20 by default", () => {
    expect(PARTS_DAILY_CAP).toBe(20);
  });

  it("counts parts dispatches in a counter of their own, with a two-day expiry", async () => {
    const t = setup({ partsDispatch: "on", kv: { [PARTS_COUNTER_KEY]: "4" } });
    expect(await t.run({ compat: CURRENT_PARTS_COMPAT })).toBe("dispatched");
    expect(t.kv.store.get(PARTS_COUNTER_KEY)).toBe("5");
    expect(t.kv.store.has(COUNTER_KEY)).toBe(false);
    const put = t.kv.puts.find((p) => p.key === PARTS_COUNTER_KEY);
    expect(put?.options).toEqual({ expirationTtl: 2 * 24 * 3600 });
  });

  it("caps parts at 20 a day without touching f1.1's cap", async () => {
    const t = setup({
      partsDispatch: "on",
      kv: { [PARTS_COUNTER_KEY]: "20", [COUNTER_KEY]: "3" },
    });
    expect(await t.run({ compat: CURRENT_PARTS_COMPAT })).toBe("capped");
    expect(await t.run({ compat: CURRENT_PARTS_COMPAT, reason: "code" })).toBe(
      "capped",
    );
    expect(t.r2.text(PARTS_STATUS_KEY)).toBeUndefined();
    // f1.1 still has 17 dispatches left today.
    expect(await t.run()).toBe("dispatched");
    expect(t.kv.store.get(COUNTER_KEY)).toBe("4");
    expect(t.kv.store.get(PARTS_COUNTER_KEY)).toBe("20");
  });

  it("is not used up by f1.1: a full f1.1 day still lets parts through", async () => {
    const t = setup({ partsDispatch: "on", kv: { [COUNTER_KEY]: "20" } });
    expect(await t.run()).toBe("capped");
    expect(await t.run({ compat: CURRENT_PARTS_COMPAT })).toBe("dispatched");
    expect(t.kv.store.get(COUNTER_KEY)).toBe("20");
    expect(t.kv.store.get(PARTS_COUNTER_KEY)).toBe("1");
  });

  it("reads its cap from PACKS_PARTS_DAILY_CAP, falling back to 20 for a value that is not a count", async () => {
    const five = setup({
      partsDispatch: "on",
      kv: { [PARTS_COUNTER_KEY]: "5" },
    });
    const capped: BuildEnv = { ...five.env, PACKS_PARTS_DAILY_CAP: "5" };
    expect(await five.run({ env: capped, compat: CURRENT_PARTS_COMPAT })).toBe(
      "capped",
    );
    const four = setup({
      partsDispatch: "on",
      kv: { [PARTS_COUNTER_KEY]: "4" },
    });
    const open: BuildEnv = { ...four.env, PACKS_PARTS_DAILY_CAP: "5" };
    expect(await four.run({ env: open, compat: CURRENT_PARTS_COMPAT })).toBe(
      "dispatched",
    );
    for (const bad of ["", "x", "-1", "2.5"]) {
      const t = setup({
        partsDispatch: "on",
        kv: { [PARTS_COUNTER_KEY]: "19" },
      });
      const env: BuildEnv = { ...t.env, PACKS_PARTS_DAILY_CAP: bad };
      expect(await t.run({ env, compat: CURRENT_PARTS_COMPAT }), bad).toBe(
        "dispatched",
      );
      expect(
        await t.run({ env, compat: CURRENT_PARTS_COMPAT, language: "fr" }),
        bad,
      ).toBe("capped");
    }
  });

  it("lets the cron's parts checks through a full parts cap, without counting them", async () => {
    const t = setup({ partsDispatch: "on", kv: { [PARTS_COUNTER_KEY]: "20" } });
    expect(await t.run({ compat: CURRENT_PARTS_COMPAT, reason: "daily" })).toBe(
      "dispatched",
    );
    expect(t.kv.store.get(PARTS_COUNTER_KEY)).toBe("20");
  });
});

describe("requestBuild never throws", () => {
  beforeEach(
    () => void vi.spyOn(console, "error").mockImplementation(() => {}),
  );
  afterEach(() => vi.restoreAllMocks());

  it("dispatches when the day counter cannot be written (KV 429)", async () => {
    const t = setup({ kvFailing: { put: "packs:dispatch:" } });
    expect(await t.run()).toBe("dispatched");
  });

  it("dispatches when the day counter cannot be read", async () => {
    const t = setup({ kvFailing: { get: "packs:dispatch:" } });
    expect(await t.run()).toBe("dispatched");
  });

  it("dispatches when the fresh token cannot be cached", async () => {
    const t = setup({
      kv: { [TOKEN_KEY]: "" },
      kvFailing: { put: "packs:github-token:" },
    });
    t.fetchImpl.mockImplementation((async (url: string) =>
      url.endsWith("/access_tokens")
        ? Response.json({ token: "ghs_fresh" }, { status: 201 })
        : new Response(null, {
            status: 204,
          })) as unknown as () => Promise<Response>);
    const env = { ...t.env, GITHUB_APP_PRIVATE_KEY: await testKeyPem() };
    expect(await t.run({ env })).toBe("dispatched");
  });

  it("answers `invalid` for a malformed language or compat, touching nothing", async () => {
    const t = setup();
    expect(await t.run({ language: "../es" })).toBe("invalid");
    expect(await t.run({ compat: "1" })).toBe("invalid");
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.r2.puts).toHaveLength(0);
    expect(t.kv.puts).toHaveLength(0);
  });
});
