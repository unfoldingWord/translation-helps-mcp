import type { Packs3Env } from "./catalogs";

/** Compressed segment bytes kept per isolate, least recently used out first. */
export const SEGMENT_CACHE_MAX_BYTES = 16 * 1024 * 1024;

const lru = new Map<string, Uint8Array>();
let held = 0;

export function resetSegmentCacheForTests(): void {
  lru.clear();
  held = 0;
}

/** `get` for `openFromSegments`: R2 key `v3/seg/{id}.seg`; a hit does not touch R2. */
export function segmentGetter(
  env: Packs3Env,
): (id: string) => Promise<Uint8Array | undefined> {
  return async (id) => {
    const hit = lru.get(id);
    if (hit) {
      lru.delete(id);
      lru.set(id, hit);
      return hit;
    }
    const bucket = env.LANGUAGE_PACKS;
    if (!bucket) return undefined;
    const obj = await bucket.get(`v3/seg/${id}.seg`);
    if (!obj) return undefined;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (bytes.length <= SEGMENT_CACHE_MAX_BYTES) {
      lru.set(id, bytes);
      held += bytes.length;
      for (const [k, v] of lru) {
        if (held <= SEGMENT_CACHE_MAX_BYTES) break;
        lru.delete(k);
        held -= v.length;
      }
    }
    return bytes;
  };
}
