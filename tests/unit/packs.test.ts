/**
 * /v2/packs serves a language's catalog entry and its content-addressed packs straight from R2, with the headers
 * the Pages proxy in front needs (own 304 with CORS, no-store on every 4xx and on 202).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handlePacks,
  isEligibleLanguage,
  normalizePackLanguage,
  type PacksDeps,
  type PacksEnv,
} from "../../src/api/routes/packs";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit";
import {
  CURRENT_PARTS_COMPAT,
  type BuildOutcome,
} from "../../src/packs/dispatch";

// Only the default eligibility check reads the catalog; the route tests inject their own.
const catalog = vi.hoisted(() => ({
  languages: [] as Array<{ code: string; name: string }>,
  bibles: {} as Record<string, Array<{ name: string; abbreviation?: string }>>,
  searchFails: false,
}));
vi.mock("@translation-helps/door43", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listLanguages: async () => catalog.languages,
  catalogSearch: async (o: { lang?: string; subject?: string }) => {
    // Like dcsClient, which rethrows Door43's 5xx.
    if (catalog.searchFails) throw new Error("HTTP 503 from DCS");
    return o.subject === "Aligned Bible"
      ? (catalog.bibles[o.lang ?? ""] ?? [])
      : [];
  },
}));

const COMPAT = "f1.1-u2.3.0-p6000230-q9-a12-t1";
/** A compat older phones still ask for; the workflow can no longer build it. */
const OLD_COMPAT = "f1.1-u2.3.0-p6000229-q9-a12-t1";
const SHA = "a".repeat(64);
const ORIGINALS_SHA = "b".repeat(64);
const ENTRY_KEY = `catalog/${COMPAT}/es-419.json`;
const PACK_KEY = `packs/${COMPAT}/es-419/${SHA}.langpack.zip`;
const ORIGINALS_KEY = `packs/${COMPAT}/originals/${ORIGINALS_SHA}.langpack.zip`;
const ENTRY = {
  language: "es-419",
  pack: { path: PACK_KEY, sha256: SHA },
  originals: { path: ORIGINALS_KEY, sha256: ORIGINALS_SHA },
};

function exposedHeaderNames(res: Response): string[] {
  const raw = res.headers.get("Access-Control-Expose-Headers");
  if (!raw) return [];
  return raw.split(",").map((h) => h.trim());
}

/** Cross-origin clients need Allow-Origin and Retry-After listed in Expose-Headers. */
function expectRetryAfterExposed(res: Response) {
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(exposedHeaderNames(res)).toContain("Retry-After");
}
const PACK_BYTES = new Uint8Array(1000).map((_, i) => i % 251);

type Stored = {
  bytes: Uint8Array;
  etag: string;
  contentType: string;
  contentEncoding?: string;
};

/** Models R2: a failed `onlyIf` returns the object without a body, and a range starting past the end throws. */
function fakeBucket(objects: Record<string, Stored>) {
  const gets: Array<{ key: string; options?: R2GetOptions }> = [];
  const heads: string[] = [];
  const meta = (key: string, o: Stored, range?: R2Range) => ({
    key,
    size: o.bytes.length,
    etag: o.etag,
    httpEtag: `"${o.etag}"`,
    range,
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", o.contentType);
      if (o.contentEncoding) headers.set("content-encoding", o.contentEncoding);
      // Whatever the object was uploaded with must not decide the route's caching.
      headers.set("cache-control", "public, max-age=60");
    },
  });
  const bucket = {
    async get(key: string, options?: R2GetOptions) {
      gets.push({ key, options });
      const o = objects[key];
      if (!o) return null;
      const onlyIf = options?.onlyIf as R2Conditional | undefined;
      if (onlyIf?.etagDoesNotMatch === o.etag) return meta(key, o);
      const range = options?.range as R2Range | undefined;
      let slice = o.bytes;
      if (range) {
        const size = o.bytes.length;
        const start =
          "suffix" in range
            ? Math.max(0, size - range.suffix)
            : (range.offset ?? 0);
        if (start >= size || ("suffix" in range && range.suffix === 0)) {
          throw new Error(
            "get: The requested range is not satisfiable (10039)",
          );
        }
        const length =
          "suffix" in range ? size - start : (range.length ?? size - start);
        slice = o.bytes.slice(start, Math.min(size, start + length));
      }
      return {
        ...meta(key, o, range),
        body: new Response(slice).body,
      };
    },
    async head(key: string) {
      heads.push(key);
      const o = objects[key];
      return o ? meta(key, o) : null;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, gets, heads };
}

function defaultObjects(): Record<string, Stored> {
  return {
    [ENTRY_KEY]: {
      bytes: new TextEncoder().encode(JSON.stringify(ENTRY)),
      etag: "e1",
      contentType: "application/json",
    },
    [PACK_KEY]: {
      bytes: PACK_BYTES,
      etag: "p1",
      contentType: "application/zip",
    },
    [ORIGINALS_KEY]: {
      bytes: new Uint8Array(10),
      etag: "o1",
      contentType: "application/zip",
    },
  };
}

type Point = { blobs?: string[]; doubles?: number[]; indexes?: string[] };

function setup(
  opts: {
    objects?: Record<string, Stored>;
    eligible?: string[];
    eligibility?: "unknown" | "throws";
    build?: BuildOutcome;
    rpm?: string;
    partsRpm?: string;
    /** PACKS_PARTS_DISPATCH; unset (parts dispatch off) unless a test sets it. */
    partsDispatch?: string;
  } = {},
) {
  const { bucket, gets, heads } = fakeBucket(opts.objects ?? defaultObjects());
  const points: Point[] = [];
  const pending: Promise<unknown>[] = [];
  const builds: Array<{ compat: string; language: string; reason: string }> =
    [];
  const checks: Array<{ compat: string; language: string; entry: unknown }> =
    [];
  const partsChecks: Array<{
    compat: string;
    language: string;
    list: unknown;
  }> = [];
  const env: PacksEnv = {
    LANGUAGE_PACKS: bucket,
    TRANSLATION_HELPS_CACHE: {} as KVNamespace,
    ANALYTICS: {
      writeDataPoint: (p: Point) => void points.push(p),
    } as unknown as AnalyticsEngineDataset,
    RATE_LIMIT_RPM: opts.rpm ?? "0",
    ...(opts.partsRpm !== undefined
      ? { PARTS_RATE_LIMIT_RPM: opts.partsRpm }
      : {}),
    ...(opts.partsDispatch !== undefined
      ? { PACKS_PARTS_DISPATCH: opts.partsDispatch }
      : {}),
  };
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const eligible = new Set(opts.eligible ?? ["es-419"]);
  const deps: PacksDeps = {
    isEligible: async (language) => {
      if (opts.eligibility === "throws") throw new Error("Door43 down");
      if (opts.eligibility === "unknown") return "unknown";
      return eligible.has(language) ? "yes" : "no";
    },
    requestBuild: async (o): Promise<BuildOutcome> => {
      builds.push({ compat: o.compat, language: o.language, reason: o.reason });
      return opts.build ?? "dispatched";
    },
    checkFreshness: async (o) => {
      const entry = typeof o.entry === "function" ? await o.entry() : o.entry;
      checks.push({ compat: o.compat, language: o.language, entry });
    },
    checkPartsFreshness: async (o) => {
      partsChecks.push({
        compat: o.compat,
        language: o.language,
        list: await o.list(),
      });
      return "fresh";
    },
  };
  async function call(path: string, init: RequestInit = {}) {
    const request = new Request(`https://tc-helps.example/v2/packs/${path}`, {
      ...init,
      headers: { "CF-Connecting-IP": "203.0.113.9", ...(init.headers ?? {}) },
    });
    const res = await handlePacks(request, env, ctx, path, deps);
    await Promise.all(pending);
    return res;
  }
  return { call, points, builds, gets, heads, checks, partsChecks };
}

beforeEach(() => {
  resetRateLimitStoreForTests();
  catalog.languages = [];
  catalog.bibles = {};
  catalog.searchFails = false;
});

describe("normalizePackLanguage", () => {
  it("lowercases and resolves regional variants the way the views do", () => {
    expect(normalizePackLanguage("es")).toBe("es-419");
    expect(normalizePackLanguage("ES")).toBe("es-419");
    expect(normalizePackLanguage("pt")).toBe("pt-br");
    expect(normalizePackLanguage("es-419")).toBe("es-419");
    expect(normalizePackLanguage("en")).toBe("en");
  });

  it("rejects anything that is not a language code", () => {
    for (const bad of [
      "",
      "x",
      "../x",
      "es/419",
      "es%2F419",
      "es_419",
      "originals",
    ]) {
      expect(normalizePackLanguage(bad), bad).toBeNull();
    }
  });
});

describe("GET /v2/packs/<compat>/<lang> (the entry)", () => {
  it("returns the entry as JSON, revalidated on every use, with R2's quoted etag", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("ETag")).toBe('"e1"');
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual(ENTRY);
  });

  it("serves es from es-419", async () => {
    const { call, gets } = setup();
    const res = await call(`${COMPAT}/es`);
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe(ENTRY_KEY);
  });

  it.each([
    ['"e1"', "quoted"],
    ["e1", "unquoted"],
    ['W/"e1"', "weak"],
    ['"old", "e1"', "in a list"],
  ])(
    "answers its own 304 with CORS and the quoted etag when If-None-Match is %s (%s)",
    async (inm) => {
      const { call } = setup();
      const res = await call(`${COMPAT}/es-419`, {
        headers: { "If-None-Match": inm },
      });
      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe('"e1"');
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Expose-Headers")).toContain(
        "ETag",
      );
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(res.body).toBeNull();
    },
  );

  it("gives the current entry (200, not 500) for a stale If-None-Match", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419`, {
      headers: { "If-None-Match": '"stale"' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ENTRY);
  });

  it("answers HEAD with the headers only", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"e1"');
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.text()).toBe("");
  });

  it("asks for a build and answers 202 preparing, not stored, when an eligible language has no entry", async () => {
    const { call, builds } = setup({ eligible: ["es-419", "fr"] });
    const res = await call(`${COMPAT}/fr`);
    expect(res.status).toBe(202);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expectRetryAfterExposed(res);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(await res.json()).toEqual({ state: "preparing" });
    expect(builds).toEqual([
      { compat: COMPAT, language: "fr", reason: "missing" },
    ]);
  });

  it("answers 404 old-compat, not stored, and asks for no build when an old compat has no entry", async () => {
    const { call, builds, points } = setup({ eligible: ["fr"] });
    const res = await call(`${OLD_COMPAT}/fr`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({
      state: "unavailable",
      reason: "old-compat",
    });
    expect(builds).toEqual([]);
    expect(points[0]?.blobs?.[3]).toBe("old-compat");
  });

  it.each(["dispatched", "running", "cooling", "capped"] as const)(
    "answers 202 preparing when the build request is %s",
    async (build) => {
      const { call, points } = setup({ eligible: ["fr"], build });
      const res = await call(`${COMPAT}/fr`);
      expect(res.status).toBe(202);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expectRetryAfterExposed(res);
      expect(res.headers.get("Retry-After")).toBe("600");
      expect(await res.json()).toEqual({ state: "preparing" });
      expect(points[0]?.blobs?.[3]).toBe(`preparing-${build}`);
    },
  );

  it.each(["stopped", "unconfigured", "error", "invalid"] as const)(
    "answers 503 unavailable, not stored, when the build request is %s",
    async (build) => {
      const { call, points } = setup({ eligible: ["fr"], build });
      const res = await call(`${COMPAT}/fr`);
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expectRetryAfterExposed(res);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(await res.json()).toEqual({ state: "unavailable", reason: build });
      expect(points[0]?.blobs?.[3]).toBe(`unavailable-${build}`);
    },
  );

  it.each(["unknown", "throws"] as const)(
    "answers 503 unavailable, not stored, and asks for no build when eligibility is %s",
    async (eligibility) => {
      const { call, builds, points } = setup({ eligibility });
      const res = await call(`${COMPAT}/fr`);
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expectRetryAfterExposed(res);
      expect(res.headers.get("Retry-After")).toBe("300");
      expect(await res.json()).toEqual({ state: "unavailable" });
      expect(builds).toEqual([]);
      expect(points[0]?.blobs?.[3]).toBe("eligibility-unknown");
    },
  );

  it("answers 404, not stored, and asks for no build when the language is not eligible", async () => {
    const { call, builds } = setup();
    const res = await call(`${COMPAT}/fr`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(builds).toEqual([]);
  });
});

describe("the freshness check", () => {
  it("runs after an entry is served, with the entry the bucket holds", async () => {
    const { call, checks } = setup();
    await call(`${COMPAT}/es`);
    expect(checks).toEqual([
      { compat: COMPAT, language: "es-419", entry: ENTRY },
    ]);
  });

  it("runs after an entry's 304 too, which is how phones ask", async () => {
    const { call, checks } = setup();
    const res = await call(`${COMPAT}/es-419`, {
      headers: { "If-None-Match": '"e1"' },
    });
    expect(res.status).toBe(304);
    expect(checks).toEqual([
      { compat: COMPAT, language: "es-419", entry: ENTRY },
    ]);
  });

  it("does not run for a pack, a HEAD, or a language with no entry", async () => {
    const { call, checks } = setup({ objects: {} });
    await call(`${COMPAT}/es-419`);
    const full = setup();
    await full.call(`${COMPAT}/es-419/${SHA}`);
    await full.call(`${COMPAT}/es-419`, { method: "HEAD" });
    expect(checks).toEqual([]);
    expect(full.checks).toEqual([]);
  });
});

describe("GET /v2/packs/<compat>/<lang>/<sha256> (a pack)", () => {
  it("streams the zip as immutable", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419/${SHA}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PACK_BYTES);
  });

  it("serves every path the entry names, the shared originals pack included", async () => {
    const { call } = setup();
    for (const named of [ENTRY.pack.path, ENTRY.originals.path]) {
      const [, compat, lang, file] = named.split("/");
      const res = await call(
        `${compat}/${lang}/${file?.replace(".langpack.zip", "")}`,
      );
      expect(res.status, named).toBe(200);
    }
  });

  it("answers Range: bytes=0-99 with 206 and Content-Range", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419/${SHA}`, {
      headers: { Range: "bytes=0-99" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-99/1000");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      PACK_BYTES.slice(0, 100),
    );
  });

  it("answers a suffix range and an open-ended range", async () => {
    const { call } = setup();
    const suffix = await call(`${COMPAT}/es-419/${SHA}`, {
      headers: { Range: "bytes=-10" },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("Content-Range")).toBe("bytes 990-999/1000");
    const open = await call(`${COMPAT}/es-419/${SHA}`, {
      headers: { Range: "bytes=900-" },
    });
    expect(open.headers.get("Content-Range")).toBe("bytes 900-999/1000");
    expect((await open.arrayBuffer()).byteLength).toBe(100);
  });

  it("clamps a range that ends past the end of the pack", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419/${SHA}`, {
      headers: { Range: "bytes=950-5000" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 950-999/1000");
    expect(res.headers.get("Content-Length")).toBe("50");
  });

  it("answers 416, not stored, for a range that starts past the end", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419/${SHA}`, {
      headers: { Range: "bytes=5000-5100" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */1000");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("ignores a Range it does not support and sends the whole pack", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419/${SHA}`, {
      headers: { Range: "bytes=0-1,5-6" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("1000");
  });

  it("answers its own 304 for a pack too", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419/${SHA}`, {
      headers: { "If-None-Match": "p1", Range: "bytes=0-99" },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe('"p1"');
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("answers 404, not stored, for a pack that is not there, without asking for a build", async () => {
    const { call, builds } = setup();
    const res = await call(`${COMPAT}/es-419/${"c".repeat(64)}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(builds).toEqual([]);
  });
});

describe("requests the route refuses", () => {
  it.each([
    "../x",
    `${COMPAT}/../x`,
    `${COMPAT}/es%2F419`,
    `${COMPAT}/es-419/%2e%2e`,
    `${COMPAT}/es-419/${SHA}.zip`,
    `${COMPAT}/originals`,
    "not-a-compat/es-419",
    `${COMPAT}/es-419/${SHA}/more`,
    `${COMPAT}`,
  ])("answers 400, not stored, for %s", async (path) => {
    const { call, gets } = setup();
    const res = await call(path);
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(gets).toEqual([]);
  });

  it("answers OPTIONS with 204 and the pack CORS", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, HEAD, OPTIONS",
    );
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
      "Range, If-None-Match",
    );
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
      "ETag, Content-Range, Content-Length, Accept-Ranges, Retry-After",
    );
  });

  it("answers 405, not stored, to other methods", async () => {
    const { call } = setup();
    const res = await call(`${COMPAT}/es-419`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("applies the rate limit, with CORS and no-store on the 429", async () => {
    const { call } = setup({ rpm: "1" });
    expect((await call(`${COMPAT}/es-419`)).status).toBe(200);
    const res = await call(`${COMPAT}/es-419`);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expectRetryAfterExposed(res);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("analytics", () => {
  it.each([
    [`${COMPAT}/es-419`, {}, "entry", "es-419", "hit"],
    [
      `${COMPAT}/es`,
      { headers: { "If-None-Match": "e1" } },
      "entry",
      "es-419",
      "not-modified",
    ],
    [`${COMPAT}/fr`, {}, "entry", "fr", "not-eligible"],
    [`${COMPAT}/es-419/${SHA}`, {}, "pack", "es-419", "hit"],
    [`${COMPAT}/es-419/${"c".repeat(64)}`, {}, "pack", "es-419", "missing"],
    [
      `${COMPAT}/es-419/${SHA}`,
      { headers: { Range: "bytes=5000-" } },
      "pack",
      "es-419",
      "unsatisfiable",
    ],
    ["../x", {}, "invalid", "", "bad-request"],
    [`${COMPAT}/es-419`, { method: "OPTIONS" }, "entry", "es-419", "preflight"],
  ] as const)(
    "writes one point for %s %j: %s %s %s",
    async (path, init, route, lang, outcome) => {
      const { call, points } = setup();
      await call(path, init as RequestInit);
      expect(points).toHaveLength(1);
      expect(points[0]?.indexes).toEqual(["pack"]);
      expect(points[0]?.blobs).toEqual(["pack", route, lang, outcome]);
      expect(points[0]?.doubles).toHaveLength(1);
      expect(points[0]?.doubles?.[0]).toBeGreaterThanOrEqual(0);
    },
  );

  it("asks for the build under the lowercase code it keys the bucket by, whatever case the phone used", async () => {
    // tc-study writes catalog/, packs/ and status/ under the code it is dispatched with, and this route reads
    // them lowercased: a code in Door43's case would build where nothing ever reads.
    const { call, builds } = setup({ eligible: ["pt-br"] });
    await call(`${COMPAT}/PT-BR`);
    expect(builds).toEqual([
      { compat: COMPAT, language: "pt-br", reason: "missing" },
    ]);
  });

  it("writes one point for a 202 preparing", async () => {
    const { call, points } = setup({ eligible: ["fr"] });
    await call(`${COMPAT}/fr`);
    expect(points.map((p) => p.blobs)).toEqual([
      ["pack", "entry", "fr", "preparing-dispatched"],
    ]);
  });
});

const PARTS_COMPAT = CURRENT_PARTS_COMPAT;
/** A parts compat the workflow no longer builds. */
const OLD_PARTS_COMPAT = "f2.0-u2.3.0-p6000229-q9-a12-t1";
const PART_SHA = "d".repeat(64);
const PARTS_ORIGINALS_SHA = "e".repeat(64);
const PART_KEY = `parts/${PART_SHA}.part.gz`;
const PARTS_LIST_KEY = `catalog/${PARTS_COMPAT}/es-419.json`;
const PARTS_ORIGINALS_KEY = `catalog/${PARTS_COMPAT}/originals/${PARTS_ORIGINALS_SHA}.json`;
const PARTS_LIST = {
  schema: 1,
  language: "es-419",
  compat: PARTS_COMPAT,
  originals: { path: PARTS_ORIGINALS_KEY, sha256: PARTS_ORIGINALS_SHA },
  parts: [{ sha256: PART_SHA }],
};
const PARTS_ORIGINALS = { schema: 1, language: "originals", parts: [] };
/** Gzip's magic bytes, then anything: the route must hand them over untouched. */
const PART_BYTES = new Uint8Array(1000).map((_, i) =>
  i === 0 ? 0x1f : i === 1 ? 0x8b : (i * 7) % 256,
);
const IMMUTABLE = "public, max-age=31536000, immutable";
/** No proxy or CDN may recompress or re-encode a part: the app checks the sha256 of its gzip bytes. */
const PART_CACHE = "public, max-age=31536000, immutable, no-transform";

function partsObjects(): Record<string, Stored> {
  const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  return {
    ...defaultObjects(),
    [PART_KEY]: {
      bytes: PART_BYTES,
      etag: "part1",
      // An upload that claimed an encoding must not make anything decode the part on its way to the phone.
      contentType: "application/octet-stream",
      contentEncoding: "gzip",
    },
    [PARTS_LIST_KEY]: {
      bytes: json(PARTS_LIST),
      etag: "l1",
      contentType: "application/json",
    },
    [PARTS_ORIGINALS_KEY]: {
      bytes: json(PARTS_ORIGINALS),
      etag: "ol1",
      contentType: "application/json",
    },
  };
}

describe("GET /v2/packs/parts/<sha256> (a part)", () => {
  it("serves the stored gzip bytes as application/gzip, immutable, with no Content-Encoding", async () => {
    const { call, gets } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`);
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe(PART_KEY);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe(PART_CACHE);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("ETag")).toBe('"part1"');
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
      "ETag, Content-Range, Content-Length, Accept-Ranges, Retry-After",
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PART_BYTES);
  });

  it("answers HEAD with the headers only", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(await res.text()).toBe("");
  });

  it("answers its own 304 with CORS, immutable", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`, {
      headers: { "If-None-Match": '"part1"' },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe('"part1"');
    expect(res.headers.get("Cache-Control")).toBe(PART_CACHE);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.body).toBeNull();
  });

  it("answers a Range with 206, the bytes untouched", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`, {
      headers: { Range: "bytes=0-99" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-99/1000");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      PART_BYTES.slice(0, 100),
    );
  });

  it("answers 416, not stored, for a range that starts past the end", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`, {
      headers: { Range: "bytes=5000-" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */1000");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 304, not 206, to a Range with a matching If-None-Match", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`, {
      headers: { "If-None-Match": '"part1"', Range: "bytes=0-99" },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe('"part1"');
    expect(res.headers.get("Content-Range")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe(PART_CACHE);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.body).toBeNull();
  });

  it("answers 304, not 416, to a range past the end with a matching If-None-Match", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`, {
      headers: { "If-None-Match": '"part1"', Range: "bytes=5000-" },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("Cache-Control")).toBe(PART_CACHE);
  });

  it("answers several ranges with the whole part, 200", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`, {
      headers: { Range: "bytes=0-9,20-29" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Range")).toBeNull();
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PART_BYTES);
  });

  it("answers a suffix range with the part's last bytes, 206", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`parts/${PART_SHA}`, {
      headers: { Range: "bytes=-100" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 900-999/1000");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      PART_BYTES.slice(900),
    );
  });

  it("answers 404, not stored, for a part that is not there, without asking for a build", async () => {
    const { call, builds } = setup({ objects: partsObjects() });
    const res = await call(`parts/${"c".repeat(64)}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(builds).toEqual([]);
  });

  it.each([
    "parts/not-hex",
    `parts/${"D".repeat(64)}`,
    `parts/${"d".repeat(63)}`,
    `parts/${PART_SHA}.part.gz`,
    `parts/${PART_SHA}/x`,
    "parts",
    "parts/",
    `parts/%2e%2e`,
  ])(
    "answers 400, not stored, before touching the bucket, for %s",
    async (path) => {
      const { call, gets, heads } = setup({ objects: partsObjects() });
      const res = await call(path);
      expect(res.status).toBe(400);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(gets).toEqual([]);
      expect(heads).toEqual([]);
    },
  );

  it("has a limit of its own, 600 a minute per IP by default, apart from the lists' 90", async () => {
    const { call } = setup({ objects: partsObjects(), rpm: "90" });
    for (let i = 0; i < 90; i++) {
      expect((await call(`${PARTS_COMPAT}/es-419`)).status).toBe(200);
    }
    expect((await call(`${PARTS_COMPAT}/es-419`)).status).toBe(429);
    for (let i = 0; i < 600; i++) {
      const res = await call(`parts/${PART_SHA}`);
      expect(res.status, `part #${i + 1}`).toBe(200);
      await res.body?.cancel();
    }
    const res = await call(`parts/${PART_SHA}`);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expectRetryAfterExposed(res);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // The lists' window is still the one that was used up, not the parts'.
    expect((await call(`${PARTS_COMPAT}/es-419`)).status).toBe(429);
  });

  it("reads its limit from PARTS_RATE_LIMIT_RPM, and parts used up still leave the lists their own", async () => {
    const { call } = setup({
      objects: partsObjects(),
      rpm: "90",
      partsRpm: "2",
    });
    expect((await call(`parts/${PART_SHA}`)).status).toBe(200);
    expect((await call(`parts/${PART_SHA}`)).status).toBe(200);
    expect((await call(`parts/${PART_SHA}`)).status).toBe(429);
    expect((await call(`${PARTS_COMPAT}/es-419`)).status).toBe(200);
  });
});

describe("GET /v2/packs/<parts compat>/originals/<sha256> (an originals list)", () => {
  it("serves the list as immutable JSON from catalog/<compat>/originals/", async () => {
    const { call, gets } = setup({ objects: partsObjects() });
    const res = await call(`${PARTS_COMPAT}/originals/${PARTS_ORIGINALS_SHA}`);
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe(PARTS_ORIGINALS_KEY);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(res.headers.get("ETag")).toBe('"ol1"');
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual(PARTS_ORIGINALS);
  });

  it("answers its own 304", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`${PARTS_COMPAT}/originals/${PARTS_ORIGINALS_SHA}`, {
      headers: { "If-None-Match": '"ol1"' },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE);
  });

  it("is still the originals pack under f1.1", async () => {
    const { call, gets } = setup({ objects: partsObjects() });
    const res = await call(`${COMPAT}/originals/${ORIGINALS_SHA}`);
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe(ORIGINALS_KEY);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("answers 404, not stored, for a list that is not there, without asking for a build", async () => {
    const { call, builds } = setup({ objects: partsObjects() });
    const res = await call(`${PARTS_COMPAT}/originals/${"c".repeat(64)}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(builds).toEqual([]);
  });
});

describe("GET /v2/packs/<parts compat>/<lang> (a parts list)", () => {
  it("serves the list as JSON, revalidated on every use, with its etag", async () => {
    const { call, gets } = setup({ objects: partsObjects() });
    const res = await call(`${PARTS_COMPAT}/es`);
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe(PARTS_LIST_KEY);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("ETag")).toBe('"l1"');
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual(PARTS_LIST);
  });

  it("answers its own 304 with CORS", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`${PARTS_COMPAT}/es-419`, {
      headers: { "If-None-Match": '"l1"' },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe('"l1"');
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("answers HEAD with the headers only", async () => {
    const { call } = setup({ objects: partsObjects() });
    const res = await call(`${PARTS_COMPAT}/es-419`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"l1"');
    expect(await res.text()).toBe("");
  });

  it("runs the parts freshness check after a list GET and its 304, with the list the bucket holds", async () => {
    const { call, partsChecks, checks } = setup({ objects: partsObjects() });
    await call(`${PARTS_COMPAT}/es`);
    const res = await call(`${PARTS_COMPAT}/es-419`, {
      headers: { "If-None-Match": '"l1"' },
    });
    expect(res.status).toBe(304);
    expect(partsChecks).toEqual([
      { compat: PARTS_COMPAT, language: "es-419", list: PARTS_LIST },
      { compat: PARTS_COMPAT, language: "es-419", list: PARTS_LIST },
    ]);
    expect(checks).toEqual([]);
  });

  it("runs no parts check for a HEAD, a part, an originals list, a missing list or an f1.1 entry", async () => {
    const { call, partsChecks, checks } = setup({ objects: partsObjects() });
    await call(`${PARTS_COMPAT}/es-419`, { method: "HEAD" });
    await call(`parts/${PART_SHA}`);
    await call(`${PARTS_COMPAT}/originals/${PARTS_ORIGINALS_SHA}`);
    await call(`${PARTS_COMPAT}/en`);
    await call(`${COMPAT}/es-419`);
    expect(partsChecks).toEqual([]);
    expect(checks).toEqual([
      { compat: COMPAT, language: "es-419", entry: ENTRY },
    ]);
  });

  it("does not run the f1.1 freshness check for a parts list", async () => {
    const { call, checks } = setup({ objects: partsObjects() });
    await call(`${PARTS_COMPAT}/es-419`);
    await call(`${PARTS_COMPAT}/es-419`, {
      headers: { "If-None-Match": '"l1"' },
    });
    expect(checks).toEqual([]);
  });

  it("asks for a parts build and answers 202 preparing when an eligible language has no list and parts dispatch is on", async () => {
    const { call, builds } = setup({
      objects: {},
      eligible: ["es-419"],
      partsDispatch: "on",
    });
    const res = await call(`${PARTS_COMPAT}/es-419`);
    expect(res.status).toBe(202);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expectRetryAfterExposed(res);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(await res.json()).toEqual({ state: "preparing" });
    expect(builds).toEqual([
      { compat: PARTS_COMPAT, language: "es-419", reason: "missing" },
    ]);
  });

  it.each([undefined, "off", "true"])(
    "answers 404 parts-off and asks for no build when PACKS_PARTS_DISPATCH is %s",
    async (flag) => {
      const { call, builds, points } = setup({
        objects: {},
        eligible: ["es-419"],
        ...(flag !== undefined ? { partsDispatch: flag } : {}),
      });
      const res = await call(`${PARTS_COMPAT}/es-419`);
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await res.json()).toEqual({
        state: "unavailable",
        reason: "parts-off",
      });
      expect(builds).toEqual([]);
      expect(points[0]?.blobs?.[3]).toBe("parts-off");
    },
  );

  it("still serves a published list, and still asks for f1.1 builds, with parts dispatch off", async () => {
    const { call, builds } = setup({ objects: partsObjects() });
    expect((await call(`${PARTS_COMPAT}/es-419`)).status).toBe(200);
    const { call: callEmpty, builds: f11Builds } = setup({ objects: {} });
    expect((await callEmpty(`${COMPAT}/es-419`)).status).toBe(202);
    expect(f11Builds).toEqual([
      { compat: COMPAT, language: "es-419", reason: "missing" },
    ]);
    expect(builds).toEqual([]);
  });

  it("answers 404 not-eligible before parts-off for a language with no packs", async () => {
    const { call, builds } = setup({ objects: {}, eligible: [] });
    const res = await call(`${PARTS_COMPAT}/es-419`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no packs for this language" });
    expect(builds).toEqual([]);
  });

  it("answers 404 old-compat and asks for no build under a parts compat the workflow no longer builds", async () => {
    const { call, builds, points } = setup({
      objects: {},
      eligible: ["es-419"],
    });
    const res = await call(`${OLD_PARTS_COMPAT}/es-419`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      state: "unavailable",
      reason: "old-compat",
    });
    expect(builds).toEqual([]);
    expect(points[0]?.blobs?.[3]).toBe("old-compat");
  });

  it.each([
    `${PARTS_COMPAT}/es-419/${SHA}`,
    `${PARTS_COMPAT}/originals`,
    `${PARTS_COMPAT}/originals/not-hex`,
  ])("answers 400 for %s", async (path) => {
    const { call, gets, heads } = setup({ objects: partsObjects() });
    const res = await call(path);
    expect(res.status).toBe(400);
    expect(gets).toEqual([]);
    expect(heads).toEqual([]);
  });

  it.each([
    [`parts/${PART_SHA}`, "part", "", "hit"],
    [`parts/${"c".repeat(64)}`, "part", "", "missing"],
    [
      `${PARTS_COMPAT}/originals/${PARTS_ORIGINALS_SHA}`,
      "originals",
      "originals",
      "hit",
    ],
    [`${PARTS_COMPAT}/es-419`, "entry", "es-419", "hit"],
  ] as const)(
    "writes one analytics point for %s: %s %s %s",
    async (path, route, lang, outcome) => {
      const { call, points } = setup({ objects: partsObjects() });
      await call(path);
      expect(points.map((p) => p.blobs)).toEqual([
        ["pack", route, lang, outcome],
      ]);
    },
  );
});

describe("isEligibleLanguage (the default check)", () => {
  const env = { TRANSLATION_HELPS_CACHE: {} as KVNamespace } as PacksEnv;

  it("needs the language listed and a literal Aligned Bible", async () => {
    catalog.languages = [
      { code: "es-419", name: "Español" },
      { code: "fr", name: "Français" },
      { code: "de", name: "Deutsch" },
    ];
    catalog.bibles = {
      "es-419": [
        { name: "es-419_gst", abbreviation: "gst" },
        { name: "es-419_glt", abbreviation: "glt" },
      ],
      fr: [{ name: "fr_f10", abbreviation: "f10" }],
      it: [{ name: "it_ult", abbreviation: "ult" }],
    };
    expect(await isEligibleLanguage("es-419", env)).toBe("yes");
    expect(await isEligibleLanguage("fr", env), "no literal bible").toBe("no");
    expect(await isEligibleLanguage("de", env), "no bible").toBe("no");
    expect(await isEligibleLanguage("it", env), "not listed").toBe("no");
  });

  it("reads the resource id from the repo name, not the abbreviation, as the build does (es-419_glt is «tpl»)", async () => {
    // Door43's real es-419 rows: the literal text's abbreviation is in Spanish (Texto Puente Literal).
    catalog.languages = [{ code: "es-419", name: "Español" }];
    catalog.bibles = {
      "es-419": [
        { name: "es-419_glt", abbreviation: "tpl" },
        { name: "es-419_gst", abbreviation: "gst" },
      ],
    };
    expect(await isEligibleLanguage("es-419", env)).toBe("yes");
  });

  it("a simple text whose abbreviation ends in lt is not a literal one", async () => {
    catalog.languages = [{ code: "xx", name: "X" }];
    catalog.bibles = { xx: [{ name: "xx_gst", abbreviation: "xlt" }] };
    expect(await isEligibleLanguage("xx", env)).toBe("no");
  });

  it("reads the resource id from the repo name when the abbreviation is missing", async () => {
    catalog.languages = [{ code: "pt-br", name: "Português" }];
    catalog.bibles = { "pt-br": [{ name: "pt-br_blt" }] };
    expect(await isEligibleLanguage("pt-br", env)).toBe("yes");
  });

  it("finds a language Door43 lists in another case (its catalog search ignores case too)", async () => {
    catalog.languages = [{ code: "PT-BR", name: "Português" }];
    catalog.bibles = { "PT-BR": [{ name: "pt-br_blt", abbreviation: "blt" }] };
    expect(await isEligibleLanguage("pt-br", env)).toBe("yes");
  });

  it("does not know when Door43 lists no language at all (dcsClient returns [] on failure)", async () => {
    catalog.languages = [];
    expect(await isEligibleLanguage("es-419", env)).toBe("unknown");
  });

  it("does not know when the catalog search fails", async () => {
    catalog.languages = [{ code: "es-419", name: "Español" }];
    catalog.searchFails = true;
    expect(await isEligibleLanguage("es-419", env)).toBe("unknown");
  });
});
