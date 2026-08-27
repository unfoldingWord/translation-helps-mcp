/**
 * Per-IP sliding-window rate limiter for Cloudflare Workers.
 *
 * Uses an in-memory Map (isolate-local). Soft limit: each colo/isolate
 * enforces independently — good enough for public read-only corpus abuse
 * prevention without KV round-trips on every request.
 *
 * Configure with env RATE_LIMIT_RPM (default 90). Set to 0 to disable.
 */

const DEFAULT_RPM = 90;
const WINDOW_MS = 60_000;
/** Cap Map size to avoid unbounded growth under IP churn. */
const MAX_KEYS = 10_000;

/** Isolate-local request timestamps keyed by client IP. */
const windows = new Map<string, number[]>();

export interface RateLimitConfig {
  /** Max requests per rolling 60s window. 0 = disabled. */
  rpm: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest request in the window expires (when blocked). */
  retryAfterSec: number;
  /** Current count in the window after this check (0 when disabled). */
  remaining: number;
  limit: number;
}

export function parseRateLimitRpm(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_RPM;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RPM;
  return n;
}

/**
 * Resolve client IP for rate limiting. Prefer CF-Connecting-IP on Cloudflare.
 */
export function clientIpFromRequest(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  if (cf) return cf;
  const xff = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  if (xff) return xff;
  return "unknown";
}

function pruneStale(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < WINDOW_MS);
}

function evictOldestKeys(): void {
  if (windows.size <= MAX_KEYS) return;
  const excess = windows.size - MAX_KEYS;
  let i = 0;
  for (const key of windows.keys()) {
    windows.delete(key);
    if (++i >= excess) break;
  }
}

/**
 * Check and record one request for `ip` against the sliding window.
 */
export function checkRateLimit(
  ip: string,
  config: RateLimitConfig,
): RateLimitResult {
  const limit = config.rpm;
  if (limit <= 0) {
    return { allowed: true, retryAfterSec: 0, remaining: Infinity, limit: 0 };
  }

  const now = Date.now();
  const key = ip || "unknown";
  const timestamps = pruneStale(windows.get(key) ?? [], now);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - oldest)) / 1000),
    );
    windows.set(key, timestamps);
    return {
      allowed: false,
      retryAfterSec,
      remaining: 0,
      limit,
    };
  }

  timestamps.push(now);
  windows.set(key, timestamps);
  evictOldestKeys();

  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: Math.max(0, limit - timestamps.length),
    limit,
  };
}

/** Test helper — clear isolate state between unit tests. */
export function resetRateLimitStoreForTests(): void {
  windows.clear();
}

/**
 * Build a standard HTTP 429 response with Retry-After.
 */
export function rateLimitResponse(
  result: RateLimitResult,
  cors: Record<string, string> = {},
): Response {
  const body = {
    error: {
      code: "RATE_LIMITED",
      message: `Rate limit exceeded (${result.limit} requests per minute). Retry after ${result.retryAfterSec}s.`,
      retryable: true,
    },
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSec),
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": "0",
      ...cors,
    },
  });
}

/**
 * Enforce rate limit for a request. Returns a 429 Response when blocked,
 * or null when the request may proceed.
 */
export function enforceRateLimit(
  request: Request,
  rpmRaw: string | undefined,
  cors?: Record<string, string>,
): Response | null {
  const rpm = parseRateLimitRpm(rpmRaw);
  if (rpm <= 0) return null;
  const result = checkRateLimit(clientIpFromRequest(request), { rpm });
  if (result.allowed) return null;
  return rateLimitResponse(result, cors);
}
