/**
 * src/packs/dirBucket.ts
 *
 * A folder read as an R2 bucket, for the local format 3 server (scripts/packs-v3-local.ts) and for staging checks
 * before anything is uploaded. It offers only what src/api/routes/packsV3.ts calls: `get` (with
 * `onlyIf.etagDoesNotMatch` and `range`) and `head`. Read-only; a key is `<root>/<key>`.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

type Loaded = { bytes: Buffer; etag: string };

/** A key is a relative path of plain segments: no `..`, `.`, backslash, NUL, drive or empty segment. */
function safeKey(key: string): boolean {
  if (!key || key.includes("\\") || key.includes("\0")) return false;
  return key
    .split("/")
    .every(
      (part) =>
        part !== "" && part !== "." && part !== ".." && !part.includes(":"),
    );
}

export function dirBucket(root: string): R2Bucket {
  const base = resolve(root);

  async function load(key: string): Promise<Loaded | null> {
    if (!safeKey(key)) return null;
    const file = resolve(base, ...key.split("/"));
    if (!file.startsWith(base + sep)) return null;
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch {
      // Missing, or a folder: not an object.
      return null;
    }
    return { bytes, etag: createHash("sha256").update(bytes).digest("hex") };
  }

  const meta = (key: string, o: Loaded, range?: R2Range) => ({
    key,
    size: o.bytes.length,
    etag: o.etag,
    httpEtag: `"${o.etag}"`,
    range,
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", "application/octet-stream");
    },
  });

  const bucket = {
    async head(key: string) {
      const o = await load(key);
      return o ? meta(key, o) : null;
    },
    async get(key: string, options?: R2GetOptions) {
      const o = await load(key);
      if (!o) return null;
      const onlyIf = options?.onlyIf as R2Conditional | undefined;
      // As R2: a failed condition answers the object without a body.
      if (onlyIf?.etagDoesNotMatch === o.etag) return meta(key, o);
      const range = options?.range as R2Range | undefined;
      let slice: Buffer = o.bytes;
      if (range) {
        const size = o.bytes.length;
        const start =
          "suffix" in range && range.suffix !== undefined
            ? Math.max(0, size - range.suffix)
            : (range.offset ?? 0);
        if (start >= size) {
          throw new Error(
            "get: The requested range is not satisfiable (10039)",
          );
        }
        const length =
          "suffix" in range && range.suffix !== undefined
            ? size - start
            : (range.length ?? size - start);
        slice = o.bytes.subarray(start, Math.min(size, start + length));
      }
      return { ...meta(key, o, range), body: new Response(slice).body };
    },
  };
  return bucket as unknown as R2Bucket;
}
