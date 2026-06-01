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

function r2KeyFromUrl(url: string): string {
  return R2_KEY_PREFIX + url.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 512);
}

export class ZipResourceFetcher2 {
  private env?: ZipEnv;

  constructor(env?: ZipEnv) {
    this.env = env;
  }

  /**
   * Fetch a zip from the given URL, using KV → R2 → network fallback chain.
   * Returns the raw zip bytes as a Uint8Array.
   */
  async getOrDownloadZip(url: string): Promise<Uint8Array> {
    const kv = this.env?.KV;
    const r2 = this.env?.R2;
    const r2Key = r2KeyFromUrl(url);

    // L1: KV cache (fast, 1 h TTL, stores as base64)
    if (kv) {
      try {
        const cached = await kv.get(r2Key, "text");
        if (cached) {
          return Uint8Array.from(atob(cached), (c) => c.charCodeAt(0));
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
          // Warm KV on R2 hit
          if (kv) {
            const b64 = btoa(String.fromCharCode(...buf));
            await kv
              .put(r2Key, b64, { expirationTtl: KV_TTL_SECONDS })
              .catch(() => {});
          }
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

    // Persist to R2 and warm KV
    if (r2) {
      await r2.put(r2Key, buf).catch(() => {});
    }
    if (kv) {
      const b64 = btoa(String.fromCharCode(...buf));
      await kv
        .put(r2Key, b64, { expirationTtl: KV_TTL_SECONDS })
        .catch(() => {});
    }

    return buf;
  }

  /**
   * Extract a single file from an in-memory ZIP buffer.
   * Uses the Web Streams / DecompressionStream API available in Workers / modern runtimes.
   * Returns the file's raw text content, or null if not found.
   */
  async extractFileFromZip(
    zipBuffer: Uint8Array,
    filePath: string,
  ): Promise<string | null> {
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

        if (compression === 0) {
          // Stored (no compression)
          return new TextDecoder().decode(compressed);
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
          if (out.length !== uncompressedSize && uncompressedSize > 0) {
            // size mismatch — still return best-effort
          }
          return new TextDecoder().decode(out);
        } else {
          throw new Error(
            `Unsupported zip compression method ${compression} for ${entryName}`,
          );
        }
      }

      offset = dataOffset + compressedSize;
    }

    return null;
  }
}
