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
  /**
   * /v3 only. The layer that answered (views, memory, kv, r2, network).
   * Appended after the existing blobs so earlier queries keep their columns.
   */
  layer?: string;
  /** /v3 only. Sum of API Server-Timing totals, appended after latencyMs. */
  apiMs?: number;
  /** /v3 only. Time spent in the MCP worker outside the API wait. */
  mcpMs?: number;
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
 *
 * A /v3 point appends, and does not reorder:
 *   blobs[5] = layer
 *   doubles[1] = apiMs
 *   doubles[2] = mcpMs
 * v2 points omit those fields, so a v2 row stays five blobs and one double.
 */
export function recordToolCall(
  analytics: AnalyticsBinding | undefined,
  metric: ToolCallMetric,
): void {
  if (!analytics) return;
  try {
    const blobs = [
      metric.tool,
      metric.requestId,
      metric.cacheStatus,
      metric.errorCode,
      metric.language ?? "",
    ];
    const doubles = [metric.latencyMs];
    if (metric.layer !== undefined) {
      blobs.push(metric.layer);
      doubles.push(metric.apiMs ?? 0, metric.mcpMs ?? 0);
    }
    analytics.writeDataPoint({
      blobs,
      doubles,
      indexes: [metric.tool],
    });
  } catch {
    // Never throw from metrics; fire-and-forget
  }
}
