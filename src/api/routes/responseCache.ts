/**
 * Short-TTL KV response cache + in-flight coalescing for REST JSON payloads.
 *
 * Used by /notes, /word-links, /questions so parallel tool calls (and cold
 * isolates after the first warm) skip re-parsing TSV + alignment work.
 */

export type ResponseCacheSource = "kv" | "memory" | "network";

const RESP_TTL_SECONDS = 3600; // 1h — matches catalog:* TTLs

/** In-process coalescing for identical keys within one isolate. */
const IN_FLIGHT = new Map<string, Promise<unknown>>();

export function responseCacheKey(
  kind: "notes" | "word-links" | "questions" | "scripture",
  language: string,
  book: string,
  chapter: string,
  verse: string | undefined,
  /** Extra key segments (e.g. format + all for scripture). */
  ...extra: string[]
): string {
  const v = verse ?? "all";
  // v2: TSV parser unescapes literal `\n` / `<br>` in note/question text.
  // Bump this when cached JSON shape or text normalization changes.
  const base = `resp:v2:${kind}:${language}:${book}:${chapter}:${v}`;
  return extra.length > 0 ? `${base}:${extra.join(":")}` : base;
}

export async function getCachedJson<T>(
  kv: KVNamespace | undefined,
  key: string,
): Promise<{ value: T; source: "kv" } | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    return { value: JSON.parse(raw) as T, source: "kv" };
  } catch {
    return null;
  }
}

export function putCachedJson(
  kv: KVNamespace | undefined,
  key: string,
  value: unknown,
  execCtx?: ExecutionContext,
): void {
  if (!kv) return;
  const put = kv
    .put(key, JSON.stringify(value), { expirationTtl: RESP_TTL_SECONDS })
    .catch(() => {});
  if (execCtx) {
    execCtx.waitUntil(put);
  }
}

/**
 * Coalesce concurrent builders for the same key. First caller runs `build`;
 * later callers await the same promise.
 */
export async function coalesceInFlight<T>(
  key: string,
  build: () => Promise<T>,
): Promise<T> {
  const existing = IN_FLIGHT.get(key);
  if (existing) return existing as Promise<T>;

  const promise = build().finally(() => {
    IN_FLIGHT.delete(key);
  });
  IN_FLIGHT.set(key, promise);
  return promise;
}
