import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(__dirname, "../../vendor/language-pack-client");
const read = (f: string) => readFileSync(resolve(dir, f));
const source = () => JSON.parse(new TextDecoder().decode(read("SOURCE.json")));

describe("vendored language pack client", () => {
  it("the bundle matches SOURCE.json", () => {
    const js = read("index.js");
    expect(createHash("sha256").update(js).digest("hex")).toBe(
      source().bundleSha256,
    );
    expect(js.length).toBe(source().bytes);
  });

  it("the bundle exports exactly the allowed names", async () => {
    const mod = await import(resolve(dir, "index.js"));
    expect(Object.keys(mod).sort()).toEqual([
      "ClientError",
      "openFromSegments",
      "verifyCatalogFile",
    ]);
  });

  it("the bundle has no jszip and no node: imports", () => {
    const text = new TextDecoder().decode(read("index.js"));
    for (const bad of [
      "jszip",
      "JSZip",
      'from"node:',
      'from "node:',
      "require(",
    ]) {
      expect(text.includes(bad), bad).toBe(false);
    }
  });

  it("the bundle is under 400 KB", () => {
    expect(read("index.js").length).toBeLessThan(400 * 1024);
  });
});
