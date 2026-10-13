/**
 * ZipResourceFetcher2 — v2 clean implementation.
 *
 * Fetches ZIP archives from Door43 catalog URLs and extracts files from them.
 * Supports optional R2 caching when Cloudflare bindings are available.
 * KV is NOT used for zip storage (not suited for multi-MB binary blobs).
 *
 * Minimal surface intentionally: only the two methods actually used by
 * ResourceIndexer are exposed (getOrDownloadZip, extractFileFromZip).
 */

import { unzipSync, type Unzipped } from "fflate";
import type {
  BucketLike,
  KvLike,
  WaitUntil,
  WaitUntilHost,
} from "../platform.js";

export type ZipCacheSource = "memory" | "r2" | "network" | "kv";

/** KV TTL for extracted file text (seconds). */
const FILE_KV_TTL_S = 24 * 3600;
/** Skip KV persistence for very large extracted files (UTF-16 approx). */
const FILE_KV_MAX_CHARS = 20_000_000;

export interface ZipEnv {
  /** Optional object store (e.g. Cloudflare R2) for persisting zip files. */
  R2?: BucketLike;
  /** Optional KV-like store for metadata/catalog caching by other modules. */
  KV?: KvLike;
  /**
   * Schedule background work that may outlive the response
   * (e.g. Cloudflare `ctx.waitUntil`). Prefer this over `execCtx`.
   */
  waitUntil?: WaitUntil;
  /**
   * Host with a `waitUntil` method (e.g. Cloudflare ExecutionContext).
   * Used when `waitUntil` is not set directly.
   */
  execCtx?: WaitUntilHost;
}

const R2_KEY_PREFIX = "zips/";

// ---------------------------------------------------------------------------
// Module-level in-process caches
//
// These survive across multiple tool handler invocations within the same
// Node.js / Workers process lifetime. They are the fastest layer (no I/O)
// and work even when R2 bindings are unavailable (e.g. vite dev).
//
// Together they must leave room inside a Worker's 128 MB for the request being
// served: 40 MB of archives, 24 MB of texts (12 M characters at two bytes each,
// which is what Hebrew and Greek make of a string) and the few small archives
// kept inflated, against some 40 MB a cold scripture request needs at its peak.
//
// Key: ZIP URL   Value: raw bytes
const ZIP_PROCESS_CACHE = new Map<string, Uint8Array>();
// Key: `${url}::${filePath}`   Value: extracted text
const TEXT_PROCESS_CACHE = new Map<string, string>();
// Single-flight: concurrent callers for the same URL share one download.
const ZIP_IN_FLIGHT = new Map<string, Promise<Uint8Array>>();
// What an archive holds, read from its directory without inflating anything.
const ZIP_DIRECTORY = new WeakMap<Uint8Array, ZipDirectory>();
// The whole inflated archive, for archives small enough to keep that way.
const UNZIP_CACHE = new WeakMap<Uint8Array, Unzipped>();

interface ZipDirectory {
  names: string[];
  /** Size of every entry together once inflated. */
  inflatedBytes: number;
}

// Byte-based memory cap for the zip process cache.
const ZIP_CACHE_MAX_BYTES = 40_000_000;
let totalCachedZipBytes = 0;

/**
 * An archive up to this size inflated is inflated whole and kept, so reading
 * its many small files (word and academy articles) costs one inflation. A
 * larger one gives up one file at a time: the English ULT is 77 MB inflated
 * and the UST 89 MB, and a scripture request reads a book from both.
 */
const WHOLE_ARCHIVE_MAX_BYTES = 4_000_000;

const PROCESS_CACHE_MAX_TEXTS = 200;
// A count alone does not bound memory: one book of aligned USFM is 5 M characters.
const TEXT_CACHE_MAX_CHARS = 12_000_000;
let totalCachedTextChars = 0;

function evictOldestZip() {
  while (
    totalCachedZipBytes > ZIP_CACHE_MAX_BYTES &&
    ZIP_PROCESS_CACHE.size > 0
  ) {
    const firstKey = ZIP_PROCESS_CACHE.keys().next().value;
    if (firstKey === undefined) break;
    const buf = ZIP_PROCESS_CACHE.get(firstKey);
    ZIP_PROCESS_CACHE.delete(firstKey);
    if (buf) totalCachedZipBytes -= buf.byteLength;
  }
}

function dropText(key: string) {
  const text = TEXT_PROCESS_CACHE.get(key);
  if (text === undefined) return;
  TEXT_PROCESS_CACHE.delete(key);
  totalCachedTextChars -= text.length;
}

/** Keep a text (or "" for a known miss), pushing out the oldest to stay within both limits. */
function cacheText(key: string, text: string) {
  dropText(key);
  // A text over the limit would push everything out and still not fit.
  if (text.length > TEXT_CACHE_MAX_CHARS) return;
  TEXT_PROCESS_CACHE.set(key, text);
  totalCachedTextChars += text.length;
  while (
    TEXT_PROCESS_CACHE.size > PROCESS_CACHE_MAX_TEXTS ||
    totalCachedTextChars > TEXT_CACHE_MAX_CHARS
  ) {
    const oldest = TEXT_PROCESS_CACHE.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    dropText(oldest);
  }
}

/** What the in-process caches hold right now. For tests and diagnostics. */
export function zipFetcherCacheStats(): {
  zips: number;
  zipBytes: number;
  texts: number;
  textChars: number;
} {
  return {
    zips: ZIP_PROCESS_CACHE.size,
    zipBytes: totalCachedZipBytes,
    texts: TEXT_PROCESS_CACHE.size,
    textChars: totalCachedTextChars,
  };
}

/** Whether an archive entry is the file asked for: by its path, or under the archive's root folder. */
function entryMatches(entryName: string, normalizedPath: string): boolean {
  return (
    entryName === normalizedPath ||
    entryName.endsWith("/" + normalizedPath) ||
    entryName === normalizedPath.replace(/^.*?\//, "")
  );
}

function r2KeyFromUrl(url: string): string {
  return R2_KEY_PREFIX + url.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 512);
}

// Map from buffer reference back to source URL (enables URL-keyed text cache
// without changing the public extractFileFromZip signature). Weak, so that an
// archive pushed out of the cache is freed and not held here for good.
const bufferUrlMap = new WeakMap<Uint8Array, string>();

export class ZipResourceFetcher2 {
  private env?: ZipEnv;
  /** Source of the most recent getOrDownloadZip call on this instance. */
  lastCacheSource: ZipCacheSource | null = null;

  constructor(env?: ZipEnv) {
    this.env = env;
  }

  /**
   * Fetch a zip from the given URL.
   * Cache chain: in-process Map → R2 → network.
   * Concurrent callers for the same URL share one in-flight download.
   * Returns the raw zip bytes as a Uint8Array.
   * KV is NOT used for zip storage (not suited for multi-MB binary blobs).
   */
  async getOrDownloadZip(url: string): Promise<Uint8Array> {
    // L0: in-process cache
    const processHit = ZIP_PROCESS_CACHE.get(url);
    if (processHit) {
      this.lastCacheSource = "memory";
      return processHit;
    }

    // Single-flight: join an in-progress download for this URL
    const existing = ZIP_IN_FLIGHT.get(url);
    if (existing) {
      const buf = await existing;
      // Caller joined after the leader set lastCacheSource; report memory
      // because the buffer is now in L0 (or will be by the time we resolve).
      this.lastCacheSource = ZIP_PROCESS_CACHE.has(url)
        ? "memory"
        : (this.lastCacheSource ?? "network");
      return buf;
    }

    const downloadPromise = this._downloadZip(url);
    ZIP_IN_FLIGHT.set(url, downloadPromise);
    try {
      return await downloadPromise;
    } finally {
      ZIP_IN_FLIGHT.delete(url);
    }
  }

  private async _downloadZip(url: string): Promise<Uint8Array> {
    const r2 = this.env?.R2;
    const r2Key = r2KeyFromUrl(url);

    // L1: R2 durable store
    if (r2) {
      try {
        const obj = await r2.get(r2Key);
        if (obj) {
          const buf = new Uint8Array(await obj.arrayBuffer());
          totalCachedZipBytes += buf.byteLength;
          evictOldestZip();
          ZIP_PROCESS_CACHE.set(url, buf);
          bufferUrlMap.set(buf, url);
          this.lastCacheSource = "r2";
          return buf;
        }
      } catch {
        // R2 miss or error — fall through
      }
    }

    // L2: Network fetch
    const response = await fetch(url, {
      headers: { "User-Agent": "translation-helps-mcp/2.0" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching zip: ${url}`);
    }
    const buf = new Uint8Array(await response.arrayBuffer());

    // Persist to R2 — await when no execCtx, otherwise waitUntil so the
    // write survives after the response is sent (never fire-and-forget).
    if (r2) {
      const putPromise = r2.put(r2Key, buf).catch((err) => {
        console.warn("[ZipResourceFetcher2] R2 put failed:", err);
      });
      const waitUntil =
        this.env?.waitUntil ??
        (this.env?.execCtx
          ? (p: Promise<unknown>) => this.env!.execCtx!.waitUntil(p)
          : undefined);
      if (waitUntil) {
        waitUntil(putPromise);
      } else {
        await putPromise;
      }
    }

    totalCachedZipBytes += buf.byteLength;
    evictOldestZip();
    ZIP_PROCESS_CACHE.set(url, buf);
    bufferUrlMap.set(buf, url);
    this.lastCacheSource = "network";

    return buf;
  }

  /**
   * Read an archive's directory once per buffer: the entry names and how much
   * they come to inflated. Nothing is inflated to find out.
   */
  private directoryOf(zipBuffer: Uint8Array): ZipDirectory {
    const cached = ZIP_DIRECTORY.get(zipBuffer);
    if (cached) return cached;
    const directory: ZipDirectory = { names: [], inflatedBytes: 0 };
    unzipSync(zipBuffer, {
      filter: (entry) => {
        directory.names.push(entry.name);
        directory.inflatedBytes += entry.originalSize;
        return false;
      },
    });
    ZIP_DIRECTORY.set(zipBuffer, directory);
    return directory;
  }

  /**
   * Inflate one entry. A small archive is inflated whole on first use and
   * kept; a large one inflates only the entry asked for, each time.
   */
  private inflateEntry(
    zipBuffer: Uint8Array,
    entryName: string,
  ): Uint8Array | undefined {
    if (this.directoryOf(zipBuffer).inflatedBytes > WHOLE_ARCHIVE_MAX_BYTES) {
      return unzipSync(zipBuffer, {
        filter: (entry) => entry.name === entryName,
      })[entryName];
    }
    let files = UNZIP_CACHE.get(zipBuffer);
    if (!files) {
      files = unzipSync(zipBuffer);
      UNZIP_CACHE.set(zipBuffer, files);
    }
    return files[entryName];
  }

  /**
   * List all entry names in a ZIP buffer without extracting content.
   * Uses fflate's unzipSync to correctly read the central directory,
   * which handles both streaming-mode and standard zips.
   */
  listZipEntries(zipBuffer: Uint8Array): string[] {
    try {
      return [...this.directoryOf(zipBuffer).names];
    } catch {
      // Fallback: walk local file headers
      return this._listViaLocalHeaders(zipBuffer);
    }
  }

  private _listViaLocalHeaders(zipBuffer: Uint8Array): string[] {
    const view = new DataView(
      zipBuffer.buffer,
      zipBuffer.byteOffset,
      zipBuffer.byteLength,
    );
    const entries: string[] = [];
    let offset = 0;

    while (offset < zipBuffer.length - 4) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const fileNameBytes = zipBuffer.slice(
        offset + 30,
        offset + 30 + fileNameLen,
      );
      const entryName = new TextDecoder().decode(fileNameBytes);
      entries.push(entryName);

      offset = offset + 30 + fileNameLen + extraLen + compressedSize;
    }

    return entries;
  }

  private scheduleBackground(promise: Promise<unknown>): void {
    const waitUntil =
      this.env?.waitUntil ??
      (this.env?.execCtx
        ? (p: Promise<unknown>) => this.env!.execCtx!.waitUntil(p)
        : undefined);
    if (waitUntil) {
      waitUntil(promise);
    } else {
      void promise;
    }
  }

  private fileKvKey(zipUrl: string, filePath: string): string {
    return `file:${zipUrl}:${filePath.replace(/^\//, "")}`;
  }

  private async readFileKv(
    zipUrl: string,
    filePath: string,
  ): Promise<string | null | undefined> {
    const kv = this.env?.KV;
    if (!kv) return undefined;
    try {
      return await kv.get(this.fileKvKey(zipUrl, filePath));
    } catch {
      return undefined;
    }
  }

  private persistFileKv(
    zipUrl: string,
    filePath: string,
    text: string | null,
  ): void {
    const kv = this.env?.KV;
    if (!kv) return;
    // Persist hits only (skip huge files); do not cache misses (path guessing).
    if (text === null || text.length > FILE_KV_MAX_CHARS) return;
    const put = kv
      .put(this.fileKvKey(zipUrl, filePath), text, {
        expirationTtl: FILE_KV_TTL_S,
      })
      .catch(() => {});
    this.scheduleBackground(put);
  }

  /**
   * Resolve a file by zip URL + path without requiring a pre-downloaded buffer.
   * Cache chain: process memory → KV extracted text → R2/network zip + unzip.
   * On a cold isolate this skips multi-MB zip downloads for previously seen books.
   */
  async getFileText(zipUrl: string, filePath: string): Promise<string | null> {
    const normalizedPath = filePath.replace(/^\//, "");
    const memKey = `${zipUrl}::${normalizedPath}`;

    const textHit = TEXT_PROCESS_CACHE.get(memKey);
    if (textHit !== undefined) {
      this.lastCacheSource = "memory";
      return textHit || null;
    }

    const kvHit = await this.readFileKv(zipUrl, normalizedPath);
    if (kvHit !== undefined && kvHit !== null) {
      cacheText(memKey, kvHit);
      this.lastCacheSource = "kv";
      return kvHit;
    }

    const zip = await this.getOrDownloadZip(zipUrl);
    const text = await this.extractFileFromZip(zip, normalizedPath);
    if (text !== null) {
      this.persistFileKv(zipUrl, normalizedPath, text);
    }
    return text;
  }

  /**
   * Extract a single file from an in-memory ZIP buffer.
   * Caches extracted text in the module-level process cache (keyed by
   * source URL + filePath) to avoid redundant decompression on repeated calls.
   * Uses fflate's unzipSync which handles the central directory automatically,
   * making it robust to Go/streaming-mode zips.
   * Returns the file's raw text content, or null if not found.
   */
  async extractFileFromZip(
    zipBuffer: Uint8Array,
    filePath: string,
  ): Promise<string | null> {
    // Resolve source URL from buffer reference for a stable cache key
    const zipUrl = bufferUrlMap.get(zipBuffer) ?? `buf:${zipBuffer.byteLength}`;
    const cacheKey = `${zipUrl}::${filePath}`;

    const textHit = TEXT_PROCESS_CACHE.get(cacheKey);
    if (textHit !== undefined) return textHit || null;

    // Cross-isolate: check KV before unzipping when we know the zip URL
    if (!zipUrl.startsWith("buf:")) {
      const kvHit = await this.readFileKv(zipUrl, filePath.replace(/^\//, ""));
      if (kvHit !== undefined && kvHit !== null) {
        cacheText(cacheKey, kvHit);
        this.lastCacheSource = "kv";
        return kvHit;
      }
    }

    const normalizedPath = filePath.replace(/^\//, "");

    try {
      // fflate reads the central directory, so Go/streaming zips work. The
      // first entry that matches is the file; only what is needed is inflated.
      const entryName = this.directoryOf(zipBuffer).names.find((name) =>
        entryMatches(name, normalizedPath),
      );
      const matchedData =
        entryName === undefined
          ? undefined
          : this.inflateEntry(zipBuffer, entryName);

      if (matchedData !== undefined) {
        const text = new TextDecoder().decode(matchedData);
        cacheText(cacheKey, text);
        if (!zipUrl.startsWith("buf:")) {
          this.persistFileKv(zipUrl, normalizedPath, text);
        }
        return text;
      }
    } catch {
      // fflate failed — fall back to manual local-header walk
      return this._extractViaLocalHeaders(zipBuffer, normalizedPath, cacheKey);
    }

    // Cache the miss
    cacheText(cacheKey, "");
    return null;
  }

  private async _extractViaLocalHeaders(
    zipBuffer: Uint8Array,
    normalizedPath: string,
    cacheKey: string,
  ): Promise<string | null> {
    const view = new DataView(
      zipBuffer.buffer,
      zipBuffer.byteOffset,
      zipBuffer.byteLength,
    );

    let offset = 0;
    while (offset < zipBuffer.length - 4) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compression = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const fileNameBytes = zipBuffer.slice(
        offset + 30,
        offset + 30 + fileNameLen,
      );
      const entryName = new TextDecoder().decode(fileNameBytes);

      const dataOffset = offset + 30 + fileNameLen + extraLen;

      if (entryMatches(entryName, normalizedPath)) {
        const compressed = zipBuffer.slice(
          dataOffset,
          dataOffset + compressedSize,
        );

        let text: string;
        if (compression === 0) {
          text = new TextDecoder().decode(compressed);
        } else if (compression === 8) {
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();
          writer.write(compressed);
          writer.close();

          const chunks: Uint8Array[] = [];
          let totalLen = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLen += value.length;
          }
          const out = new Uint8Array(totalLen);
          let pos = 0;
          for (const chunk of chunks) {
            out.set(chunk, pos);
            pos += chunk.length;
          }
          text = new TextDecoder().decode(out);
        } else {
          throw new Error(
            `Unsupported zip compression method ${compression} for ${entryName}`,
          );
        }

        cacheText(cacheKey, text);
        const sep = cacheKey.indexOf("::");
        if (sep > 0 && !cacheKey.startsWith("buf:")) {
          this.persistFileKv(
            cacheKey.slice(0, sep),
            cacheKey.slice(sep + 2),
            text,
          );
        }
        return text;
      }

      offset = dataOffset + compressedSize;
    }

    cacheText(cacheKey, "");
    return null;
  }
}
