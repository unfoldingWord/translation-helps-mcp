import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZipResourceFetcher2 } from "../../src/core/resources/ZipResourceFetcher2.js";

// Create a minimal valid ZIP in memory for testing extractFileFromZip
function makeMinimalZip(fileName: string, content: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(fileName);
  const dataBytes = new TextEncoder().encode(content);

  // Local file header
  const header = new Uint8Array(30 + nameBytes.length);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, 0x04034b50, true); // signature
  hv.setUint16(6, 0, true); // flags
  hv.setUint16(8, 0, true); // compression: stored
  hv.setUint32(18, dataBytes.length, true); // compressed size
  hv.setUint32(22, dataBytes.length, true); // uncompressed size
  hv.setUint16(26, nameBytes.length, true); // file name length
  header.set(nameBytes, 30);

  // Central directory (minimal — points past the data)
  const centralDir = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(centralDir.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(28, nameBytes.length, true);
  centralDir.set(nameBytes, 46);

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true); // total entries
  ev.setUint32(12, centralDir.length, true); // central dir size
  ev.setUint32(16, header.length + dataBytes.length, true); // central dir offset

  const total = new Uint8Array(
    header.length + dataBytes.length + centralDir.length + eocd.length,
  );
  total.set(header, 0);
  total.set(dataBytes, header.length);
  total.set(centralDir, header.length + dataBytes.length);
  total.set(eocd, header.length + dataBytes.length + centralDir.length);
  return total;
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
