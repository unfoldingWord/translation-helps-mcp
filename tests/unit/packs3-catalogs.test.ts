import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type MockInstance,
} from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  getCatalogs,
  resetPacks3CachesForTests,
  type Packs3Env,
} from "../../src/packs3/catalogs";
import { parseTrustedKeys } from "../../src/packs3/keys";
import {
  segmentGetter,
  SEGMENT_CACHE_MAX_BYTES,
} from "../../src/packs3/segments";

const STAGING =
  "78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911";
const DIR = join(__dirname, "..", "fixtures", "packs3");
const fx = (key: string) => new Uint8Array(readFileSync(join(DIR, key)));

type Obj = { bytes: Uint8Array; etag: string };

function fakeBucket(objects: Record<string, Obj>) {
  const gets: Array<{ key: string; options?: R2GetOptions }> = [];
  const bucket = {
    async get(key: string, options?: R2GetOptions) {
      gets.push({ key, options });
      const o = objects[key];
      if (!o) return null;
      const meta = { key, etag: o.etag, size: o.bytes.length };
      const onlyIf = options?.onlyIf as R2Conditional | undefined;
      if (onlyIf?.etagDoesNotMatch === o.etag) return meta;
      return {
        ...meta,
        body: new Response(o.bytes).body,
        arrayBuffer: async () => o.bytes.slice().buffer,
      };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, gets };
}

function fixtureObjects(): Record<string, Obj> {
  const out: Record<string, Obj> = {};
  for (const f of readdirSync(join(DIR, "v3", "catalog"))) {
    out[`v3/catalog/${f}`] = { bytes: fx(`v3/catalog/${f}`), etag: `e-${f}` };
  }
  return out;
}

function setup(objects = fixtureObjects(), extra: Partial<Packs3Env> = {}) {
  const { bucket, gets } = fakeBucket(objects);
  const env: Packs3Env = {
    LANGUAGE_PACKS: bucket,
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: STAGING,
    ...extra,
  };
  return { env, gets, objects };
}

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  resetPacks3CachesForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("parseTrustedKeys", () => {
  it("parses the staging key", () => {
    const k = parseTrustedKeys(STAGING)!;
    expect(Object.keys(k)).toEqual(["78d2e6299a2de4d0"]);
    expect(k["78d2e6299a2de4d0"]).toHaveLength(32);
  });
  it("gives null for unset, empty and malformed values", () => {
    expect(parseTrustedKeys(undefined)).toBeNull();
    expect(parseTrustedKeys("")).toBeNull();
    expect(parseTrustedKeys("x")).toBeNull();
    expect(parseTrustedKeys(STAGING.slice(0, -1))).toBeNull();
    expect(parseTrustedKeys(`${STAGING},nope`)).toBeNull();
  });
  it("gives null when the key id is not the one of its key", () => {
    expect(
      parseTrustedKeys(`0000000000000000:${STAGING.split(":")[1]}`),
    ).toBeNull();
  });
});

describe("getCatalogs", () => {
  it("loads and verifies en with the staging key", async () => {
    const { env } = setup();
    const c = await getCatalogs(env, "en");
    expect(c?.lang).toBe("en");
    expect(c?.catalogs.map((x) => x.signedBy)).toEqual([
      "78d2e6299a2de4d0",
      "78d2e6299a2de4d0",
    ]);
    expect(c?.key).toBe(`${c!.catalogs[0]!.id}+${c!.catalogs[1]!.id}`);
  });
  it("es is es-419", async () => {
    const { env, gets } = setup();
    const c = await getCatalogs(env, "es");
    expect(c?.lang).toBe("es-419");
    expect(gets[0]!.key).toBe("v3/catalog/es-419.seg");
  });
  it("no keys, PACKS_V3 off or no bucket gives null", async () => {
    const { env } = setup();
    expect(
      await getCatalogs({ ...env, PACKS_V3_TRUSTED_KEYS: undefined }, "en"),
    ).toBeNull();
    expect(
      await getCatalogs({ ...env, PACKS_V3_TRUSTED_KEYS: "" }, "en"),
    ).toBeNull();
    expect(await getCatalogs({ ...env, PACKS_V3: "off" }, "en")).toBeNull();
    expect(
      await getCatalogs({ ...env, LANGUAGE_PACKS: undefined }, "en"),
    ).toBeNull();
  });
  it("unknown language gives null and one R2 read in 300 s", async () => {
    const { env, gets } = setup();
    expect(await getCatalogs(env, "fr", 0)).toBeNull();
    expect(await getCatalogs(env, "fr", 299_000)).toBeNull();
    expect(gets).toHaveLength(1);
    expect(await getCatalogs(env, "fr", 301_000)).toBeNull();
    expect(gets).toHaveLength(2);
  });
  it("a catalog signed by another key gives null, logged once", async () => {
    const raw = randomBytes(32);
    const id = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    const { env } = setup(undefined, {
      PACKS_V3_TRUSTED_KEYS: `${id}:${Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("")}`,
    });
    expect(await getCatalogs(env, "en", 0)).toBeNull();
    expect(await getCatalogs(env, "en", 400_000)).toBeNull();
    const rejected = warn.mock.calls.filter((c) =>
      String((c[1] as { reason: string }).reason).startsWith(
        "catalog-rejected",
      ),
    );
    expect(rejected).toHaveLength(1);
  });
  it("an unsigned published catalog gives null", async () => {
    const objects = fixtureObjects();
    const bytes = objects["v3/catalog/en.seg"]!.bytes.slice();
    const at = bytes.findIndex(
      (b, i) =>
        b === 0x63 &&
        bytes[i + 1] === 0x73 &&
        bytes[i + 2] === 0x69 &&
        bytes[i + 3] === 0x67 &&
        bytes[i + 4] === 0x81,
    );
    expect(at).toBeGreaterThan(0);
    bytes[at + 3] = 0x68; // "sig" becomes "sih": the header carries no signature
    objects["v3/catalog/en.seg"] = { bytes, etag: "unsigned" };
    const { env } = setup(objects);
    expect(await getCatalogs(env, "en")).toBeNull();
  });
  it("corrupt catalog bytes give null", async () => {
    const objects = fixtureObjects();
    objects["v3/catalog/en.seg"] = {
      bytes: new Uint8Array([1, 2, 3, 4]),
      etag: "bad",
    };
    const { env } = setup(objects);
    expect(await getCatalogs(env, "en")).toBeNull();
  });
  it("reuses the pair for 60 s", async () => {
    const { env, gets } = setup();
    await getCatalogs(env, "en", 1000);
    expect(gets).toHaveLength(2);
    await getCatalogs(env, "en", 60_000);
    expect(gets).toHaveLength(2);
  });
  it("after 60 s an unchanged ETag is not verified again", async () => {
    const { env, gets } = setup();
    const a = await getCatalogs(env, "en", 0);
    const b = await getCatalogs(env, "en", 61_000);
    expect(gets).toHaveLength(4);
    expect(gets[2]!.options?.onlyIf).toEqual({ etagDoesNotMatch: "e-en.seg" });
    expect(b!.catalogs[0]).toBe(a!.catalogs[0]);
    expect(b!.catalogs[1]).toBe(a!.catalogs[1]);
  });
  it("a changed ETag loads the new catalog", async () => {
    const { env, objects } = setup();
    const a = await getCatalogs(env, "en", 0);
    objects["v3/catalog/en.seg"] = {
      bytes: fx("v3/catalog/en.seg"),
      etag: "new",
    };
    const b = await getCatalogs(env, "en", 61_000);
    expect(b).not.toBeNull();
    expect(b!.catalogs[0]).not.toBe(a!.catalogs[0]);
    expect(b!.catalogs[0]!.id).toBe(a!.catalogs[0]!.id);
  });
  it("a common id not the one required gives null, reason common-mismatch", async () => {
    const objects = fixtureObjects();
    objects["v3/catalog/common.seg"] = {
      bytes: fx("v3/catalog/es-419.seg"),
      etag: "other",
    };
    const { env } = setup(objects);
    expect(await getCatalogs(env, "en")).toBeNull();
    expect(warn).toHaveBeenCalledWith("packs3 fallback", {
      lang: "en",
      reason: "common-mismatch",
    });
  });
});

describe("segment LRU", () => {
  const seg = (n: number) => ({ bytes: new Uint8Array(n), etag: "s" });
  it("the second get of an id makes no R2 call", async () => {
    const { env, gets } = setup({ "v3/seg/a.seg": seg(10) });
    const get = segmentGetter(env);
    expect((await get("a"))!.length).toBe(10);
    await get("a");
    expect(gets).toHaveLength(1);
    expect(await get("zz")).toBeUndefined();
  });
  it("past 16 MB the least recently used is evicted", async () => {
    const six = 6 * 1024 * 1024;
    expect(SEGMENT_CACHE_MAX_BYTES).toBe(16 * 1024 * 1024);
    const { env, gets } = setup({
      "v3/seg/a.seg": seg(six),
      "v3/seg/b.seg": seg(six),
      "v3/seg/c.seg": seg(six),
    });
    const get = segmentGetter(env);
    await get("a");
    await get("b");
    await get("a");
    await get("c"); // 18 MB: b is evicted
    expect(gets).toHaveLength(3);
    await get("a");
    await get("c");
    expect(gets).toHaveLength(3);
    await get("b");
    expect(gets).toHaveLength(4);
  });
});
