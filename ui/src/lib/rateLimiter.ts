/**
 * Simple in-memory token-bucket rate limiter for SvelteKit API routes.
 *
 * State is per-process (module-level Map).  Suitable for CF Pages workers
 * where state is isolated per invocation but reasonably bounded within a
 * single warm instance.
 */

interface Bucket {
	count: number;
	windowStart: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000; // 1 minute

/**
 * Returns `true` when the request SHOULD be rejected (rate-limit exceeded).
 *
 * @param key  Unique key per caller, e.g. client IP + route.
 * @param limit Maximum requests per minute.
 */
export function isRateLimited(key: string, limit: number): boolean {
	const now = Date.now();
	const bucket = buckets.get(key);

	if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
		buckets.set(key, { count: 1, windowStart: now });
		return false;
	}

	if (bucket.count >= limit) {
		return true;
	}

	bucket.count += 1;
	return false;
}

/** How many seconds remain until the current window expires. */
export function retryAfterSeconds(key: string): number {
	const bucket = buckets.get(key);
	if (!bucket) return 0;
	const elapsed = Date.now() - bucket.windowStart;
	return Math.ceil((WINDOW_MS - elapsed) / 1000);
}
