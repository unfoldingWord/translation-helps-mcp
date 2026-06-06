/**
 * ZipResourceFetcher2 — v2 clean implementation.
 *
 * Fetches ZIP archives from Door43 catalog URLs and extracts files from them.
 * Supports optional KV + R2 caching when Cloudflare bindings are available.
 *
 * Minimal surface intentionally: only the two methods actually used by
 * ResourceIndexer are exposed (getOrDownloadZip, extractFileFromZip).
 */

export interface ZipEnv {
  /** Optional Cloudflare KV namespace for caching zip buffers by URL. */
  KV?: KVNamespace;
  /** Optional Cloudflare R2 bucket for persisting zip files. */
  R2?: R2Bucket;
}

const KV_TTL_SECONDS = 3600; // 1 hour
const R2_KEY_PREFIX = "zips/";

// ---------------------------------------------------------------------------
// Module-level in-process caches
//
// These survive across multiple tool handler invocations within the same
// Node.js / Workers process lifetime. They are the fastest layer (no I/O)
// and work even when KV/R2 bindings are unavailable (e.g. vite dev).
//
// Key: ZIP URL   Value: raw bytes
const ZIP_PROCESS_CACHE = new Map<string, Uint8Array>();
// Key: `${url}::${filePath}`   Value: extracted text
const TEXT_PROCESS_CACHE = new Map<string, string>();
// Max entries before the oldest is evicted (prevents unbounded memory growth)
const PROCESS_CACHE_MAX_ZIPS = 20;
const PROCESS_CACHE_MAX_TEXTS = 200;

function evictIfNeeded<V>(map: Map<string, V>, max: number) {
  if (map.size >= max) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
}

/** Encode a Uint8Array to base64 without blowing the call stack on large buffers. */
function uint8ToBase64(buf: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function r2KeyFromUrl(url: string): string {
  return R2_KEY_PREFIX + url.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 512);
}

export class ZipResourceFetcher2 {
  private env?: ZipEnv;

  constructor(env?: ZipEnv) {
    this.env = env;
  }

  /**
   * Fetch a zip from the given URL.
   * Cache chain: in-process Map → KV → R2 → network.
   * Returns the raw zip bytes as a Uint8Array.
   */
  async getOrDownloadZip(url: string): Promise<Uint8Array> {
    // L0: in-process cache (works even without KV/R2, survives across tool calls)
    const processHit = ZIP_PROCESS_CACHE.get(url);
    if (processHit) return processHit;

    const kv = this.env?.KV;
    const r2 = this.env?.R2;
    const r2Key = r2KeyFromUrl(url);

    // L1: KV cache (fast, 1 h TTL, stores as base64)
    if (kv) {
      try {
        const cached = await kv.get(r2Key, "text");
        if (cached) {
          const buf = Uint8Array.from(atob(cached), (c) => c.charCodeAt(0));
          evictIfNeeded(ZIP_PROCESS_CACHE, PROCESS_CACHE_MAX_ZIPS);
          ZIP_PROCESS_CACHE.set(url, buf);
          return buf;
        }
      } catch {
        // KV miss or error — fall through
      }
    }

    // L2: R2 durable store
    if (r2) {
      try {
        const obj = await r2.get(r2Key);
        if (obj) {
          const buf = new Uint8Array(await obj.arrayBuffer());
          // Warm KV and process cache on R2 hit
          if (kv) {
            const b64 = uint8ToBase64(buf);
            kv.put(r2Key, b64, { expirationTtl: KV_TTL_SECONDS }).catch(() => {});
          }
          evictIfNeeded(ZIP_PROCESS_CACHE, PROCESS_CACHE_MAX_ZIPS);
          ZIP_PROCESS_CACHE.set(url, buf);
          return buf;
        }
      } catch {
        // R2 miss or error — fall through
      }
    }

    // L3: Network fetch
    const response = await fetch(url, {
      headers: { "User-Agent": "translation-helps-mcp/2.0" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching zip: ${url}`);
    }
    const buf = new Uint8Array(await response.arrayBuffer());

    // Populate all cache layers
    if (r2) r2.put(r2Key, buf).catch(() => {});
    if (kv) {
      const b64 = uint8ToBase64(buf);
      kv.put(r2Key, b64, { expirationTtl: KV_TTL_SECONDS }).catch(() => {});
    }
    evictIfNeeded(ZIP_PROCESS_CACHE, PROCESS_CACHE_MAX_ZIPS);
    ZIP_PROCESS_CACHE.set(url, buf);

    return buf;
  }

  /**
   * List all entry names in a ZIP buffer without extracting content.
   * Walks the local file headers and returns every stored filename.
   */
  listZipEntries(zipBuffer: Uint8Array): string[] {
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
      const fileNameBytes = zipBuffer.slice(offset + 30, offset + 30 + fileNameLen);
      const entryName = new TextDecoder().decode(fileNameBytes);
      entries.push(entryName);

      offset = offset + 30 + fileNameLen + extraLen + compressedSize;
    }

    return entries;
  }

  /**
   * Extract a single file from an in-memory ZIP buffer.
   * Caches extracted text in the module-level process cache (keyed by buffer
   * identity + filePath) to avoid redundant decompression on repeated calls.
   * Uses the Web Streams / DecompressionStream API available in Workers / modern runtimes.
   * Returns the file's raw text content, or null if not found.
   */
  async extractFileFromZip(
    zipBuffer: Uint8Array,
    filePath: string,
  ): Promise<string | null> {
    // Use buffer byte-length + offset as a cheap identity key (good enough for our use)
    const cacheKey = `${zipBuffer.byteOffset}:${zipBuffer.byteLength}::${filePath}`;
    const textHit = TEXT_PROCESS_CACHE.get(cacheKey);
    if (textHit !== undefined) return textHit || null;
    // Locate the file in the central directory.
    const view = new DataView(
      zipBuffer.buffer,
      zipBuffer.byteOffset,
      zipBuffer.byteLength,
    );

    // Walk local file headers (signature 0x04034b50 = PK\x03\x04).
    let offset = 0;
    while (offset < zipBuffer.length - 4) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compression = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const uncompressedSize = view.getUint32(offset + 22, true);
      const fileNameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const fileNameBytes = zipBuffer.slice(
        offset + 30,
        offset + 30 + fileNameLen,
      );
      const entryName = new TextDecoder().decode(fileNameBytes);

      const dataOffset = offset + 30 + fileNameLen + extraLen;

      // Match on exact path or trailing segment match (zip entries often start with repo-name/).
      const normalizedPath = filePath.replace(/^\//, "");
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
          // Stored (no compression)
          text = new TextDecoder().decode(compressed);
        } else if (compression === 8) {
          // Deflate — use DecompressionStream (Workers + modern browsers)
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
        return text;
      }

      offset = dataOffset + compressedSize;
    }

    // Cache the miss so we don't re-scan this ZIP for the same path
    evictIfNeeded(TEXT_PROCESS_CACHE, PROCESS_CACHE_MAX_TEXTS);
    TEXT_PROCESS_CACHE.set(cacheKey, ""); // empty string = not found sentinel
    return null;
  }
}
