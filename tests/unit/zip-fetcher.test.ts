import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ZipResourceFetcher2,
  zipFetcherCacheStats,
} from "@translation-helps/door43";
import * as fflate from "fflate";
import { zipSync } from "fflate";

// The fetcher's own calls to unzipSync go through this spy, so a test can see
// how much each one inflated.
vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  return { ...actual, unzipSync: vi.fn(actual.unzipSync) };
});

const unzipSpy = vi.mocked(fflate.unzipSync);

/** Bytes inflated by the fetcher since the spy was last cleared. */
function inflatedBytes(): number {
  return unzipSpy.mock.results.reduce(
    (total, call) =>
      total +
      Object.values(call.value as fflate.Unzipped).reduce(
        (n, bytes) => n + bytes.byteLength,
        0,
      ),
    0,
  );
}

/** Create a valid ZIP using fflate (matches what the fetcher now uses for extraction). */
function makeMinimalZip(fileName: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  files[fileName] = enc.encode(content);
  return zipSync(files, { level: 0 }); // store (no compression)
}

/** An archive as Door43 serves them: files under one root folder, compressed. */
function makeArchive(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) {
    entries[`repo/${name}`] = enc.encode(text);
  }
  return zipSync(entries, { level: 1 });
}

const MB = 1_000_000;
/** A book-sized text that is cheap to build and to compress. */
const bigText = (label: string, chars: number) =>
  label + "x".repeat(chars - label.length);

afterEach(() => {
  unzipSpy.mockClear();
  vi.unstubAllGlobals();
});

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
  });
});

// A Worker has 128 MB. The English ULT is 77 MB inflated and the UST 89 MB, so
// inflating an archive to read one book of it took the Worker down (#63).
describe("ZipResourceFetcher2 memory", () => {
  it("inflates only the file asked for from a large archive", async () => {
    const zip = makeArchive({
      "01-GEN.usfm": bigText("genesis ", 3 * MB),
      "02-EXO.usfm": bigText("exodus ", 3 * MB),
      "65-3JN.usfm": "\\c 1\n\\v 15 Peace to you.",
    });
    const fetcher = new ZipResourceFetcher2();

    const small = await fetcher.extractFileFromZip(zip, "65-3JN.usfm");
    expect(small).toBe("\\c 1\n\\v 15 Peace to you.");
    expect(inflatedBytes()).toBe(small!.length);

    unzipSpy.mockClear();
    const genesis = await fetcher.extractFileFromZip(zip, "01-GEN.usfm");
    expect(genesis).toHaveLength(3 * MB);
    expect(genesis!.startsWith("genesis ")).toBe(true);
    expect(inflatedBytes()).toBe(3 * MB);
  });

  it("lists the entries of an archive without inflating any", () => {
    const zip = makeArchive({
      "19-PSA.usfm": bigText("psalms ", 3 * MB),
      "23-ISA.usfm": bigText("isaiah ", 3 * MB),
    });
    const fetcher = new ZipResourceFetcher2();

    expect(fetcher.listZipEntries(zip)).toEqual([
      "repo/19-PSA.usfm",
      "repo/23-ISA.usfm",
    ]);
    expect(inflatedBytes()).toBe(0);
  });

  it("inflates a small archive once for all of its files", async () => {
    const articles: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      articles[`bible/kt/word${i}.md`] = `# Word ${i}\n\nAbout word ${i}.`;
    }
    const zip = makeArchive(articles);
    const fetcher = new ZipResourceFetcher2();

    expect(await fetcher.extractFileFromZip(zip, "bible/kt/word3.md")).toBe(
      "# Word 3\n\nAbout word 3.",
    );
    const afterFirst = unzipSpy.mock.calls.length;
    expect(await fetcher.extractFileFromZip(zip, "bible/kt/word17.md")).toBe(
      "# Word 17\n\nAbout word 17.",
    );
    expect(await fetcher.extractFileFromZip(zip, "bible/kt/word39.md")).toBe(
      "# Word 39\n\nAbout word 39.",
    );
    expect(unzipSpy.mock.calls.length).toBe(afterFirst);
  });

  it("finds a file by its path under the archive's root folder, first match first", async () => {
    const zip = makeArchive({
      "content/01.md": "first",
      "extra/content/01.md": "second",
    });
    const fetcher = new ZipResourceFetcher2();
    expect(await fetcher.extractFileFromZip(zip, "content/01.md")).toBe(
      "first",
    );
    expect(await fetcher.extractFileFromZip(zip, "/content/01.md")).toBe(
      "first",
    );
  });

  it("keeps cached texts within a size, dropping the oldest", async () => {
    const books = ["GEN", "EXO", "LEV", "NUM", "DEU"];
    const zip = makeArchive(
      Object.fromEntries(
        books.map((book) => [`${book}.usfm`, bigText(book + " ", 3 * MB)]),
      ),
    );
    const fetcher = new ZipResourceFetcher2();
    for (const book of books) {
      await fetcher.extractFileFromZip(zip, `${book}.usfm`);
      expect(zipFetcherCacheStats().textChars).toBeLessThanOrEqual(12 * MB);
    }

    // The last one read is still held: reading it again inflates nothing.
    unzipSpy.mockClear();
    await fetcher.extractFileFromZip(zip, "DEU.usfm");
    expect(unzipSpy).not.toHaveBeenCalled();

    // The first one was dropped to make room, and is inflated again.
    const genesis = await fetcher.extractFileFromZip(zip, "GEN.usfm");
    expect(genesis!.startsWith("GEN ")).toBe(true);
    expect(inflatedBytes()).toBe(3 * MB);
  });

  it("returns a text too large to keep without keeping it", async () => {
    const zip = makeArchive({ "huge.usfm": bigText("huge ", 13 * MB) });
    const fetcher = new ZipResourceFetcher2();
    const before = zipFetcherCacheStats().textChars;

    expect(await fetcher.extractFileFromZip(zip, "huge.usfm")).toHaveLength(
      13 * MB,
    );
    expect(zipFetcherCacheStats().textChars).toBe(before);
  });

  it("keeps cached archives within a size, dropping the oldest", async () => {
    const fetcher = new ZipResourceFetcher2();
    const urls = ["a", "b", "c"].map((n) => `https://example.com/big-${n}.zip`);
    for (const url of urls) {
      // Stored, not compressed: each archive is 15 MB in memory.
      const zip = zipSync(
        { "blob.bin": new Uint8Array(15 * MB) },
        { level: 0 },
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(zip.buffer),
        }),
      );
      await fetcher.getOrDownloadZip(url);
      expect(zipFetcherCacheStats().zipBytes).toBeLessThanOrEqual(40 * MB);
    }

    // The newest is served from memory; the oldest has to be fetched again.
    const refetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(makeMinimalZip("again.txt", "again").buffer),
    });
    vi.stubGlobal("fetch", refetch);
    await fetcher.getOrDownloadZip(urls[2]);
    expect(refetch).not.toHaveBeenCalled();
    await fetcher.getOrDownloadZip(urls[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
