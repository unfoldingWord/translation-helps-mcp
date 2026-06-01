/**
 * Analytics Engine metrics helper.
 *
 * Emits one data point per MCP tool call with latency, cache status,
 * and error code. The data is queryable via Cloudflare's Analytics Engine
 * SQL API and feeds the website's performance dashboard.
 *
 * Falls back silently when the ANALYTICS binding is not configured.
 */

export interface ToolCallMetric {
  tool: string;
  requestId: string;
  latencyMs: number;
  /** "hit" | "miss" | "stale" — from the bundle/rag cache layer */
  cacheStatus: "hit" | "miss" | "stale" | "none";
  /** Stable error code if the call failed, otherwise "OK" */
  errorCode: string;
  language?: string;
}

export interface AnalyticsBinding {
  writeDataPoint(data: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

/**
 * Record a completed tool call into Analytics Engine.
 * Schema (positional):
 *   blobs:   [tool, requestId, cacheStatus, errorCode, language]
 *   doubles: [latencyMs]
 *   indexes: [tool]
 */
export function recordToolCall(
  analytics: AnalyticsBinding | undefined,
  metric: ToolCallMetric,
): void {
  if (!analytics) return;
  try {
    analytics.writeDataPoint({
      blobs: [
        metric.tool,
        metric.requestId,
        metric.cacheStatus,
        metric.errorCode,
        metric.language ?? "",
      ],
      doubles: [metric.latencyMs],
      indexes: [metric.tool],
    });
  } catch {
    // Never throw from metrics; fire-and-forget
  }
}
