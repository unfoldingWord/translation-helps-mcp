import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dirBucket } from "../../src/packs/dirBucket";
import { startLocalServer } from "../../scripts/packs-v3-local";

const CAT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const SEG = new Uint8Array(Array.from({ length: 40 }, (_, i) => i + 100));
const ID = createHash("sha256").update("a segment").digest("hex");
const MISSING = createHash("sha256").update("nothing").digest("hex");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "packs-v3-"));
  mkdirSync(join(root, "v3", "catalog"), { recursive: true });
  mkdirSync(join(root, "v3", "seg"), { recursive: true });
  writeFileSync(join(root, "v3", "catalog", "en.seg"), CAT);
  writeFileSync(join(root, "v3", "seg", `${ID}.seg`), SEG);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function bytes(body: ReadableStream | null | undefined) {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

describe("dirBucket", () => {
  it("get/head/range/etag", async () => {
    const b = dirBucket(root);
    const got = await b.get("v3/catalog/en.seg");
    expect(got).not.toBeNull();
    expect(got!.size).toBe(CAT.length);
    expect(got!.etag).toBe(sha(CAT));
    expect(got!.httpEtag).toBe(`"${sha(CAT)}"`);
    expect(await bytes((got as R2ObjectBody).body)).toEqual(CAT);

    const head = await b.head(`v3/seg/${ID}.seg`);
    expect(head).toMatchObject({ size: SEG.length, etag: sha(SEG) });
    expect("body" in head!).toBe(false);

    const r1 = await b.get(`v3/seg/${ID}.seg`, {
      range: { offset: 5, length: 10 },
    });
    expect(await bytes((r1 as R2ObjectBody).body)).toEqual(SEG.slice(5, 15));
    const r2 = await b.get(`v3/seg/${ID}.seg`, { range: { offset: 30 } });
    expect(await bytes((r2 as R2ObjectBody).body)).toEqual(SEG.slice(30));
    const r3 = await b.get(`v3/seg/${ID}.seg`, { range: { suffix: 4 } });
    expect(await bytes((r3 as R2ObjectBody).body)).toEqual(SEG.slice(36));
    await expect(
      b.get(`v3/seg/${ID}.seg`, { range: { offset: 40 } }),
    ).rejects.toThrow();

    const same = await b.get("v3/catalog/en.seg", {
      onlyIf: { etagDoesNotMatch: sha(CAT) },
    });
    expect(same).not.toBeNull();
    expect("body" in same!).toBe(false);
    const other = await b.get("v3/catalog/en.seg", {
      onlyIf: { etagDoesNotMatch: "zz" },
    });
    expect(await bytes((other as R2ObjectBody).body)).toEqual(CAT);

    expect(await b.get("v3/catalog/xx.seg")).toBeNull();
    expect(await b.head("v3/catalog/xx.seg")).toBeNull();
  });

  it("answers null for a key that leaves the folder", async () => {
    const b = dirBucket(root);
    for (const key of [
      "../x",
      "v3/../../x",
      ["v3", "catalog", "en.seg"].join(String.fromCharCode(92)),
      "/v3/catalog/en.seg",
      "v3/catalog",
    ]) {
      expect(await b.get(key)).toBeNull();
      expect(await b.head(key)).toBeNull();
    }
  });
});

describe("local server", () => {
  it("serves a catalog and a segment", async () => {
    const server = await startLocalServer({ dir: root, port: 0 });
    try {
      const c = await fetch(`${server.url}/v3/packs/en/catalog`);
      expect(c.status).toBe(200);
      expect(new Uint8Array(await c.arrayBuffer())).toEqual(CAT);
      const s = await fetch(`${server.url}/v3/packs/seg/${ID}`);
      expect(s.status).toBe(200);
      expect(new Uint8Array(await s.arrayBuffer())).toEqual(SEG);
      const r = await fetch(`${server.url}/v3/packs/seg/${ID}`, {
        headers: { Range: "bytes=2-5" },
      });
      expect(r.status).toBe(206);
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(SEG.slice(2, 6));
      const miss = await fetch(`${server.url}/v3/packs/seg/${MISSING}`);
      expect(miss.status).toBe(404);
      expect(await miss.json()).toEqual({ error: "segment not found" });
      const nocat = await fetch(`${server.url}/v3/packs/fr/catalog`);
      expect(nocat.status).toBe(404);
      expect(await nocat.json()).toEqual({ error: "catalog not found" });
    } finally {
      await server.close();
    }
  });
});
