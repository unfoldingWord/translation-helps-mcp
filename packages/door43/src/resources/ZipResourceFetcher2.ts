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
// Key: ZIP URL   Value: raw bytes
const ZIP_PROCESS_CACHE = new Map<string, Uint8Array>();
// Key: `${url}::${filePath}`   Value: extracted text
const TEXT_PROCESS_CACHE = new Map<string, string>();
// Single-flight: concurrent callers for the same URL share one download.
const ZIP_IN_FLIGHT = new Map<string, Promise<Uint8Array>>();
// Cache full unzipSync result per buffer so N extractions inflate once.
const UNZIP_CACHE = new WeakMap<Uint8Array, Unzipped>();

// Byte-based memory cap (~60 MB) for the zip process cache.
const ZIP_CACHE_MAX_BYTES = 60_000_000;
let totalCachedZipBytes = 0;

const PROCESS_CACHE_MAX_TEXTS = 200;

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

function evictIfNeeded<V>(map: Map<string, V>, max: number) {
  if (map.size >= max) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
}

function r2KeyFromUrl(url: string): string {
  return R2_KEY_PREFIX + url.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 512);
}

// Map from buffer reference back to source URL (enables URL-keyed text cache
// without changing the public extractFileFromZip signature).
const bufferUrlMap = new Map<Uint8Array, string>();

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
   * Unzip once per buffer; subsequent extractions reuse the cached map.
   */
  private unzipCached(zipBuffer: Uint8Array): Unzipped {
    const cached = UNZIP_CACHE.get(zipBuffer);
    if (cached) return cached;
    const files = unzipSync(zipBuffer);
    UNZIP_CACHE.set(zipBuffer, files);
    return files;
  }

  /**
   * List all entry names in a ZIP buffer without extracting content.
   * Uses fflate's unzipSync to correctly read the central directory,
   * which handles both streaming-mode and standard zips.
   */
  listZipEntries(zipBuffer: Uint8Array): string[] {
    try {
      const files = this.unzipCached(zipBuffer);
      return Object.keys(files);
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
      evictIfNeeded(TEXT_PROCESS_CACHE, PROCESS_CACHE_MAX_TEXTS);
      TEXT_PROCESS_CACHE.set(memKey, kvHit);
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
        evictIfNeeded(TEXT_PROCESS_CACHE, PROCESS_CACHE_MAX_TEXTS);
        TEXT_PROCESS_CACHE.set(cacheKey, kvHit);
        this.lastCacheSource = "kv";
        return kvHit;
      }
    }

    const normalizedPath = filePath.replace(/^\//, "");

    try {
      // Use cached unzip — handles Go/streaming zips, inflate once per buffer
      const files = this.unzipCached(zipBuffer);

      // Try exact match first, then trailing-segment match
      let matchedData: Uint8Array | undefined;
      for (const entryName of Object.keys(files)) {
        if (
          entryName === normalizedPath ||
          entryName.endsWith("/" + normalizedPath) ||
          entryName === normalizedPath.replace(/^.*?\//, "")
        ) {
          matchedData = files[entryName];
          break;
        }
      }

      if (matchedData !== undefined) {
        const text = new TextDecoder().decode(matchedData);
        evictIfNeeded(TEXT_PROCESS_CACHE, PROCESS_CACHE_MAX_TEXTS);
        TEXT_PROCESS_CACHE.set(cacheKey, text);
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
    evictIfNeeded(TEXT_PROCESS_CACHE, PROCESS_CACHE_MAX_TEXTS);
    TEXT_PROCESS_CACHE.set(cacheKey, "");
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

      const entryMatches =
        entryName === normalizedPath ||
        entryName.endsWith("/" + normalizedPath) ||
        entryName === normalizedPath.replace(/^.*?\//, "");

      if (entryMatches) {
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

        evictIfNeeded(TEXT_PROCESS_CACHE, PROCESS_CACHE_MAX_TEXTS);
        TEXT_PROCESS_CACHE.set(cacheKey, text);
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

    evictIfNeeded(TEXT_PROCESS_CACHE, PROCESS_CACHE_MAX_TEXTS);
    TEXT_PROCESS_CACHE.set(cacheKey, "");
    return null;
  }
}
