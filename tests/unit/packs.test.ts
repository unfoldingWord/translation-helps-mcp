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
import type { BuildOutcome } from "../../src/packs/dispatch";

// Only the default eligibility check reads the catalog; the route tests inject their own.
const catalog = vi.hoisted(() => ({
  languages: [] as Array<{ code: string; name: string }>,
  bibles: {} as Record<string, Array<{ name: string; abbreviation?: string }>>,
}));
vi.mock("@translation-helps/door43", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listLanguages: async () => catalog.languages,
  catalogSearch: async (o: { lang?: string; subject?: string }) =>
    o.subject === "Aligned Bible" ? (catalog.bibles[o.lang ?? ""] ?? []) : [],
}));

const COMPAT = "f1.1-u2.3.0-p6000230-q8-a11-t1";
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
const PACK_BYTES = new Uint8Array(1000).map((_, i) => i % 251);

type Stored = { bytes: Uint8Array; etag: string; contentType: string };

/** Models R2: a failed `onlyIf` returns the object without a body, and a range starting past the end throws. */
function fakeBucket(objects: Record<string, Stored>) {
  const gets: Array<{ key: string; options?: R2GetOptions }> = [];
  const meta = (key: string, o: Stored, range?: R2Range) => ({
    key,
    size: o.bytes.length,
    etag: o.etag,
    httpEtag: `"${o.etag}"`,
    range,
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", o.contentType);
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
          throw new Error("get: The requested range is not satisfiable (10039)");
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
      const o = objects[key];
      return o ? meta(key, o) : null;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, gets };
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
    rpm?: string;
  } = {},
) {
  const { bucket, gets } = fakeBucket(opts.objects ?? defaultObjects());
  const points: Point[] = [];
  const pending: Promise<unknown>[] = [];
  const builds: Array<{ compat: string; language: string; reason: string }> =
    [];
  const env: PacksEnv = {
    LANGUAGE_PACKS: bucket,
    TRANSLATION_HELPS_CACHE: {} as KVNamespace,
    ANALYTICS: {
      writeDataPoint: (p: Point) => void points.push(p),
    } as unknown as AnalyticsEngineDataset,
    RATE_LIMIT_RPM: opts.rpm ?? "0",
  };
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const eligible = new Set(opts.eligible ?? ["es-419"]);
  const deps: PacksDeps = {
    isEligible: async (language) => eligible.has(language),
    requestBuild: async (o): Promise<BuildOutcome> => {
      builds.push({ compat: o.compat, language: o.language, reason: o.reason });
      return "dispatched";
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
  return { call, points, builds, gets };
}

beforeEach(() => resetRateLimitStoreForTests());

describe("normalizePackLanguage", () => {
  it("lowercases and resolves regional variants the way the views do", () => {
    expect(normalizePackLanguage("es")).toBe("es-419");
    expect(normalizePackLanguage("ES")).toBe("es-419");
    expect(normalizePackLanguage("pt")).toBe("pt-br");
    expect(normalizePackLanguage("es-419")).toBe("es-419");
    expect(normalizePackLanguage("en")).toBe("en");
  });

  it("rejects anything that is not a language code", () => {
    for (const bad of ["", "x", "../x", "es/419", "es%2F419", "es_419", "originals"]) {
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
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ state: "preparing" });
    expect(builds).toEqual([
      { compat: COMPAT, language: "fr", reason: "missing" },
    ]);
  });

  it("answers 404, not stored, and asks for no build when the language is not eligible", async () => {
    const { call, builds } = setup();
    const res = await call(`${COMPAT}/fr`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(builds).toEqual([]);
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
      "ETag, Content-Range, Content-Length, Accept-Ranges",
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
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("analytics", () => {
  it.each([
    [`${COMPAT}/es-419`, {}, "entry", "es-419", "hit"],
    [`${COMPAT}/es`, { headers: { "If-None-Match": "e1" } }, "entry", "es-419", "not-modified"],
    [`${COMPAT}/fr`, {}, "entry", "fr", "not-eligible"],
    [`${COMPAT}/es-419/${SHA}`, {}, "pack", "es-419", "hit"],
    [`${COMPAT}/es-419/${"c".repeat(64)}`, {}, "pack", "es-419", "missing"],
    [`${COMPAT}/es-419/${SHA}`, { headers: { Range: "bytes=5000-" } }, "pack", "es-419", "unsatisfiable"],
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

  it("writes one point for a 202 preparing", async () => {
    const { call, points } = setup({ eligible: ["fr"] });
    await call(`${COMPAT}/fr`);
    expect(points.map((p) => p.blobs)).toEqual([
      ["pack", "entry", "fr", "preparing"],
    ]);
  });
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
    expect(await isEligibleLanguage("es-419", env)).toBe(true);
    expect(await isEligibleLanguage("fr", env), "no literal bible").toBe(false);
    expect(await isEligibleLanguage("de", env), "no bible").toBe(false);
    expect(await isEligibleLanguage("it", env), "not listed").toBe(false);
  });

  it("reads the resource id from the repo name when the abbreviation is missing", async () => {
    catalog.languages = [{ code: "pt-br", name: "Português" }];
    catalog.bibles = { "pt-br": [{ name: "pt-br_blt" }] };
    expect(await isEligibleLanguage("pt-br", env)).toBe(true);
  });
});
