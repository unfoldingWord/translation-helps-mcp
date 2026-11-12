import type { Packs3Env } from "./catalogs";

/** Compressed segment bytes kept per isolate, least recently used out first. */
export const SEGMENT_CACHE_MAX_BYTES = 8 * 1024 * 1024;

const lru = new Map<string, Uint8Array>();
let held = 0;
const inflight = new Map<string, Promise<Uint8Array | undefined>>();

export function resetSegmentCacheForTests(): void {
  lru.clear();
  held = 0;
  inflight.clear();
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
    const running = inflight.get(id);
    if (running) return running;
    const p = fetchSegment(env, id).finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  };
}

async function fetchSegment(
  env: Packs3Env,
  id: string,
): Promise<Uint8Array | undefined> {
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket) return undefined;
  const obj = await bucket.get(`v3/seg/${id}.seg`);
  if (!obj) return undefined;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  if (bytes.length <= SEGMENT_CACHE_MAX_BYTES) {
    const old = lru.get(id);
    if (old) held -= old.length;
    lru.delete(id);
    lru.set(id, bytes);
    held += bytes.length;
    for (const [k, v] of lru) {
      if (held <= SEGMENT_CACHE_MAX_BYTES) break;
      lru.delete(k);
      held -= v.length;
    }
  }
  return bytes;
}
