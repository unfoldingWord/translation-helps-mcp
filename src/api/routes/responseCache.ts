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

/** Trimmed, lower-cased, with runs of whitespace collapsed to one space. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Response-cache key for article search. The query is normalized. Type tokens
 * are sorted so `ta,tw` and `tw,ta` share an entry. The query is encoded so a
 * colon inside it cannot collide with the other segments.
 */
export function searchResponseCacheKey(
  query: string,
  language: string,
  types: string,
  limit: number,
): string {
  const normalized = normalizeSearchQuery(query);
  const type = types
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
  return `resp:v2:search:${language}:${type}:${limit}:${encodeURIComponent(normalized)}`;
}

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
  // Notes and questions are v3: their payload adds `source`. The other kinds
  // stay v2. Bump a kind when its cached JSON shape changes.
  const generation = kind === "notes" || kind === "questions" ? "v3" : "v2";
  const base = `resp:${generation}:${kind}:${language}:${book}:${chapter}:${v}`;
  return extra.length > 0 ? `${base}:${extra.join(":")}` : base;
}

/**
 * Verse segment for a response cache key. A range must not reuse the
 * single-verse entry, and a cross-chapter range must not reuse either chapter.
 */
export function cacheVerse(
  chapter: string,
  verseStart?: string,
  verseEnd?: string,
  endChapter?: string,
): string | undefined {
  if (endChapter && endChapter !== chapter) {
    const start = verseStart ?? "1";
    const end = verseEnd ?? "end";
    return `${start}-${endChapter}:${end}`;
  }
  if (verseStart == null) return undefined;
  if (verseEnd && verseEnd !== verseStart) return `${verseStart}-${verseEnd}`;
  return verseStart;
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
