/**
 * /v3/packs serves format 3 catalogs and segments straight from R2 (spec/serving.md of bt-synergy's
 * language-pack-v3 package). Never dispatches a build.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  handlePacksV3Request,
  parseV3Path,
} from "../../src/api/routes/packsV3";
import type { PacksEnv } from "../../src/api/routes/packs";
import { resetRateLimitStoreForTests } from "../../src/core/rateLimit";

const HEX = "ab12".repeat(16);
const SEG_KEY = `v3/seg/${HEX}.seg`;
const BYTES = new Uint8Array(1000).map((_, i) => (i * 7) % 251);
const CAT_BYTES = new Uint8Array(300).map((_, i) => (i * 3) % 251);

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
      return { ...meta(key, o, range), body: new Response(slice).body };
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
  const octet = "application/octet-stream";
  return {
    "v3/catalog/es-419.seg": {
      bytes: CAT_BYTES,
      etag: "c1",
      contentType: octet,
    },
    "v3/catalog/common.seg": {
      bytes: new Uint8Array(50).fill(9),
      etag: "k1",
      contentType: octet,
    },
    [SEG_KEY]: {
      bytes: BYTES,
      etag: "s1",
      contentType: octet,
      contentEncoding: "gzip",
    },
  };
}

type Point = { blobs?: string[]; doubles?: number[]; indexes?: string[] };

function setup(
  opts: {
    objects?: Record<string, Stored>;
    rpm?: string;
    partsRpm?: string;
    v3?: string | null;
    bucket?: boolean;
  } = {},
) {
  const { bucket, gets, heads } = fakeBucket(opts.objects ?? defaultObjects());
  const points: Point[] = [];
  const pending: Promise<unknown>[] = [];
  // The v3 handler takes no build dependency at all; this records any call that could reach one.
  const builds: unknown[] = [];
  const env: PacksEnv & { PACKS_V3?: string } = {
    ...(opts.bucket === false ? {} : { LANGUAGE_PACKS: bucket }),
    TRANSLATION_HELPS_CACHE: {} as KVNamespace,
    ANALYTICS: {
      writeDataPoint: (p: Point) => void points.push(p),
    } as unknown as AnalyticsEngineDataset,
    RATE_LIMIT_RPM: opts.rpm ?? "0",
    ...(opts.partsRpm !== undefined
      ? { PARTS_RATE_LIMIT_RPM: opts.partsRpm }
      : {}),
    ...(opts.v3 === null ? {} : { PACKS_V3: opts.v3 ?? "on" }),
  };
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  async function call(path: string, init: RequestInit = {}) {
    const request = new Request(`https://tc-helps.example/v3/packs/${path}`, {
      ...init,
      headers: { "CF-Connecting-IP": "203.0.113.9", ...(init.headers ?? {}) },
    });
    const res = await handlePacksV3Request(request, env, ctx, path);
    await Promise.all(pending);
    return res;
  }
  return { call, points, builds, gets, heads };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-None-Match",
  "Access-Control-Expose-Headers":
    "ETag, Content-Range, Content-Length, Accept-Ranges, Retry-After",
};
function expectCors(res: Response) {
  for (const [k, v] of Object.entries(CORS)) {
    expect(res.headers.get(k), k).toBe(v);
  }
}
async function bytes(res: Response) {
  return new Uint8Array(await res.arrayBuffer());
}

beforeEach(() => resetRateLimitStoreForTests());

describe("parseV3Path", () => {
  it("parses the three forms", () => {
    expect(parseV3Path("es/catalog")).toEqual({
      route: "catalog",
      lang: "es-419",
      key: "v3/catalog/es-419.seg",
    });
    expect(parseV3Path("common/catalog")).toEqual({
      route: "catalog",
      lang: "common",
      key: "v3/catalog/common.seg",
    });
    expect(parseV3Path(`seg/${HEX}`)).toEqual({
      route: "seg",
      id: HEX,
      key: SEG_KEY,
    });
    expect(parseV3Path("x")).toBeNull();
  });
});

describe("GET /v3/packs/<lang>/catalog", () => {
  it("serves the language catalog", async () => {
    const { call, gets } = setup();
    const res = await call("es-419/catalog");
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe("v3/catalog/es-419.seg");
    expect(await bytes(res)).toEqual(CAT_BYTES);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("ETag")).toBe('"c1"');
    expect(res.headers.get("Content-Length")).toBe("300");
    expectCors(res);
  });

  it("es is an alias of es-419", async () => {
    const { call, gets } = setup();
    const res = await call("es/catalog");
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe("v3/catalog/es-419.seg");
  });

  it("ES-419 is lowercased", async () => {
    const { call, gets } = setup();
    expect((await call("ES-419/catalog")).status).toBe(200);
    expect(gets[0]?.key).toBe("v3/catalog/es-419.seg");
  });

  it("serves the common catalog", async () => {
    const { call, gets } = setup();
    const res = await call("common/catalog");
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe("v3/catalog/common.seg");
    expect(res.headers.get("ETag")).toBe('"k1"');
  });

  it("ignores Range", async () => {
    const { call } = setup();
    const res = await call("es-419/catalog", {
      headers: { Range: "bytes=0-9" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Range")).toBeNull();
    expect((await bytes(res)).length).toBe(300);
    const bad = await call("es-419/catalog", {
      headers: { Range: "bytes=-0" },
    });
    expect(bad.status).toBe(200);
  });
});

describe("GET /v3/packs/seg/<id>", () => {
  it("serves a segment as immutable bytes with no Content-Encoding", async () => {
    const { call, gets } = setup();
    const res = await call(`seg/${HEX}`);
    expect(res.status).toBe(200);
    expect(gets[0]?.key).toBe(SEG_KEY);
    expect(await bytes(res)).toEqual(BYTES);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable, no-transform",
    );
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("ETag")).toBe('"s1"');
    expectCors(res);
  });

  it("answers Range with 206", async () => {
    const { call } = setup();
    const res = await call(`seg/${HEX}`, { headers: { Range: "bytes=10-19" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 10-19/1000");
    expect(res.headers.get("Content-Length")).toBe("10");
    expect(await bytes(res)).toEqual(BYTES.slice(10, 20));
    expectCors(res);
    const open = await call(`seg/${HEX}`, { headers: { Range: "bytes=990-" } });
    expect(open.status).toBe(206);
    expect(open.headers.get("Content-Range")).toBe("bytes 990-999/1000");
    const suffix = await call(`seg/${HEX}`, { headers: { Range: "bytes=-5" } });
    expect(suffix.status).toBe(206);
    expect(await bytes(suffix)).toEqual(BYTES.slice(995));
  });

  it("answers 416 for bytes=-0 and for a start past the end", async () => {
    const { call } = setup();
    for (const range of ["bytes=-0", "bytes=2000-"]) {
      const res = await call(`seg/${HEX}`, { headers: { Range: range } });
      expect(res.status, range).toBe(416);
      expect(res.headers.get("Content-Range")).toBe("bytes */1000");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "range not satisfiable" });
      expectCors(res);
    }
  });

  it("ignores other Range forms", async () => {
    const { call } = setup();
    const res = await call(`seg/${HEX}`, {
      headers: { Range: "bytes=0-1,5-6" },
    });
    expect(res.status).toBe(200);
  });
});

describe("If-None-Match", () => {
  const cases: Array<[string, string, string]> = [
    ["catalog", "es-419/catalog", "c1"],
    ["segment", `seg/${HEX}`, "s1"],
  ];
  for (const [name, path, tag] of cases) {
    for (const header of [`"${tag}"`, `"zz", "${tag}"`, `W/"${tag}"`, "*"]) {
      it(`answers 304 with CORS for a ${name} and ${header}`, async () => {
        const { call } = setup();
        const res = await call(path, { headers: { "If-None-Match": header } });
        expect(res.status).toBe(304);
        expect(res.headers.get("ETag")).toBe(`"${tag}"`);
        expect(res.headers.get("Cache-Control")).toBe(
          name === "catalog"
            ? "no-cache, no-transform"
            : "public, max-age=31536000, immutable, no-transform",
        );
        expectCors(res);
        expect((await bytes(res)).length).toBe(0);
      });
    }
    it(`answers 200 for a ${name} with another tag`, async () => {
      const { call } = setup();
      const res = await call(path, {
        headers: { "If-None-Match": '"other"' },
      });
      expect(res.status).toBe(200);
    });
  }
});

describe("methods", () => {
  it("HEAD has headers and no body", async () => {
    const { call } = setup();
    const res = await call(`seg/${HEX}`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(res.headers.get("ETag")).toBe('"s1"');
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect((await bytes(res)).length).toBe(0);
    const cat = await call("es-419/catalog", { method: "HEAD" });
    expect(cat.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect((await bytes(cat)).length).toBe(0);
  });

  it("HEAD with Range answers 206 with no body", async () => {
    const { call } = setup();
    const res = await call(`seg/${HEX}`, {
      method: "HEAD",
      headers: { Range: "bytes=10-19" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Length")).toBe("10");
    expect(res.headers.get("Content-Range")).toBe("bytes 10-19/1000");
    expect((await bytes(res)).length).toBe(0);
  });

  it("HEAD with bytes=-0 answers 416 with no body", async () => {
    const { call } = setup();
    const res = await call(`seg/${HEX}`, {
      method: "HEAD",
      headers: { Range: "bytes=-0" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */1000");
    expect((await bytes(res)).length).toBe(0);
  });

  it("HEAD of a catalog ignores Range", async () => {
    const { call } = setup();
    const res = await call("es-419/catalog", {
      method: "HEAD",
      headers: { Range: "bytes=10-19" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Range")).toBeNull();
    expect((await bytes(res)).length).toBe(0);
  });

  it("HEAD errors keep their headers and have no body", async () => {
    const { call } = setup();
    const missing = await call("fr/catalog", { method: "HEAD" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Content-Type")).toBe("application/json");
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    expectCors(missing);
    expect((await bytes(missing)).length).toBe(0);
    const bad = await call("seg", { method: "HEAD" });
    expect(bad.status).toBe(400);
    expect((await bytes(bad)).length).toBe(0);
    const off = setup({ v3: "off" });
    const res = await off.call("es-419/catalog", { method: "HEAD" });
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expectCors(res);
    expect((await bytes(res)).length).toBe(0);
  });

  it("OPTIONS answers 204 with CORS", async () => {
    const { call } = setup();
    const res = await call(`seg/${HEX}`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expectCors(res);
  });

  it("POST answers 405 with Allow", async () => {
    const { call } = setup();
    const res = await call(`seg/${HEX}`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(await res.json()).toEqual({ error: "method not allowed" });
    expectCors(res);
  });
});

describe("errors", () => {
  const bad = [
    `seg/${HEX.toUpperCase()}`,
    `seg/${HEX.slice(1)}`,
    "es-419/catalog/",
    "es-419/catalog/x",
    "es-419",
    "seg",
    `seg/${HEX}/x`,
    "common/x",
    "x_y/catalog",
    "",
  ];
  for (const path of bad) {
    it(`answers 400 for "${path}"`, async () => {
      const { call, gets } = setup();
      const res = await call(path);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad pack path" });
      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expectCors(res);
      expect(gets).toEqual([]);
    });
  }

  it("answers 404 for a missing catalog, and the handler has no dispatch path", async () => {
    const { call, builds } = setup();
    const res = await call("fr/catalog");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "catalog not found" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expectCors(res);
    expect(builds).toEqual([]);
  });

  it("answers 404 for a missing segment", async () => {
    const { call } = setup();
    const res = await call(`seg/${"c".repeat(64)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "segment not found" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expectCors(res);
  });

  for (const v3 of ["off", null, "", "ON"] as const) {
    it(`answers 404 v3-off when PACKS_V3 is ${JSON.stringify(v3)}`, async () => {
      const { call, gets } = setup({ v3 });
      const res = await call("es-419/catalog");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        state: "unavailable",
        reason: "v3-off",
      });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expectCors(res);
      expect(gets).toEqual([]);
    });
  }

  it("answers 503 without a bucket", async () => {
    const { call } = setup({ bucket: false });
    const res = await call("es-419/catalog");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "packs are not configured" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expectCors(res);
  });
});

describe("rate limits", () => {
  it("segments use the parts scope", async () => {
    const { call } = setup({ rpm: "1", partsRpm: "2" });
    expect((await call(`seg/${HEX}`)).status).toBe(200);
    expect((await call(`seg/${HEX}`)).status).toBe(200);
    const res = await call(`seg/${HEX}`);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expectCors(res);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "RATE_LIMITED",
    );
    // The catalogs' window is their own.
    expect((await call("es-419/catalog")).status).toBe(200);
  });

  it("catalogs use the packs scope", async () => {
    const { call } = setup({ rpm: "2", partsRpm: "50" });
    expect((await call("es-419/catalog")).status).toBe(200);
    expect((await call("common/catalog")).status).toBe(200);
    const res = await call("es-419/catalog");
    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expectCors(res);
    // Segments are counted apart.
    expect((await call(`seg/${HEX}`)).status).toBe(200);
  });
});

describe("analytics", () => {
  it("writes a point per answer", async () => {
    const { call, points } = setup();
    await call("es/catalog");
    await call(`seg/${HEX}`);
    await call("fr/catalog");
    await call("nope");
    expect(points.map((p) => p.blobs)).toEqual([
      ["pack", "v3-catalog", "es-419", "hit"],
      ["pack", "v3-seg", "", "hit"],
      ["pack", "v3-catalog", "fr", "missing"],
      ["pack", "invalid", "", "bad-request"],
    ]);
    expect(points[0]?.indexes).toEqual(["pack"]);
  });
});
