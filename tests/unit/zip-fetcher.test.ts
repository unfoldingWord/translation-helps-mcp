import { describe, it, expect, vi } from "vitest";
import { ZipResourceFetcher2 } from "../../src/core/resources/ZipResourceFetcher2.js";
import { zipSync } from "fflate";

/** Create a valid ZIP using fflate (matches what the fetcher now uses for extraction). */
function makeMinimalZip(fileName: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  files[fileName] = enc.encode(content);
  return zipSync(files, { level: 0 }); // store (no compression)
}

describe("ZipResourceFetcher2", () => {
  it("extracts a stored file from a zip buffer", async () => {
    const zip = makeMinimalZip("tn_JHN.tsv", "Book\tChapter\nJHN\t3");
    const fetcher = new ZipResourceFetcher2();
    const content = await fetcher.extractFileFromZip(zip, "tn_JHN.tsv");
    expect(content).toBe("Book\tChapter\nJHN\t3");
  });

  it("returns null for a missing file", async () => {
    const zip = makeMinimalZip("tn_JHN.tsv", "data");
    const fetcher = new ZipResourceFetcher2();
    const content = await fetcher.extractFileFromZip(zip, "nonexistent.tsv");
    expect(content).toBeNull();
  });

  it("fetches from network when no env provided", async () => {
    const fetcher = new ZipResourceFetcher2();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(makeMinimalZip("test.txt", "hello").buffer),
    });
    vi.stubGlobal("fetch", mockFetch);
    const result = await fetcher.getOrDownloadZip(
      "https://example.com/test.zip",
    );
    expect(result).toBeInstanceOf(Uint8Array);
    vi.unstubAllGlobals();
  });
});
