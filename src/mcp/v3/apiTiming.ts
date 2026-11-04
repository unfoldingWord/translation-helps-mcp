/**
 * Timing for one /v3 tool call.
 *
 * v2 never enters this scope, so its API calls keep their current behaviour:
 * no deadline, and no extra Analytics fields. A /v3 call that reaches the API
 * gives up after 20 seconds and answers with the soft not-available shape.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  normalizeLayer,
  slowestLayer,
  type AnswerLayer,
} from "../../api/serverTiming.js";
import {
  mapApiCacheStatus,
  notAvailable,
  type ToolResult,
} from "../tools/shared.js";

/** Every /v3 call to the REST API stops waiting after this long. */
export const V3_API_TIMEOUT_MS = 20_000;

export class ApiTimeoutError extends Error {
  constructor() {
    super("The source was slow.");
    this.name = "ApiTimeoutError";
  }
}

export function isApiTimeout(error: unknown): boolean {
  return error instanceof ApiTimeoutError;
}

interface ApiCall {
  layer?: AnswerLayer;
  apiMs: number;
  started: number;
  ended: number;
}

interface Scope {
  timeoutMs: number;
  calls: ApiCall[];
}

const storage = new AsyncLocalStorage<Scope>();

export function withV3ApiTiming<T>(
  fn: () => Promise<T>,
  timeoutMs = V3_API_TIMEOUT_MS,
): Promise<T> {
  return storage.run({ timeoutMs, calls: [] }, fn);
}

export function v3ApiTimeoutMs(): number | undefined {
  return storage.getStore()?.timeoutMs;
}

/** `started` and `ended` are milliseconds on the same clock as `Date.now()`. */
export function noteV3ApiResponse(
  header: string | null,
  started: number,
  ended: number,
): void {
  const current = storage.getStore();
  if (!current) return;
  const parsed = parseServerTiming(header);
  current.calls.push({
    layer: parsed.layer,
    apiMs: parsed.apiMs,
    started,
    ended,
  });
}

export function v3ApiSummary(): {
  layer?: AnswerLayer;
  apiMs: number;
  waitedMs: number;
} {
  const calls = storage.getStore()?.calls ?? [];
  let apiMs = 0;
  const layers: Array<string | undefined> = [];
  for (const call of calls) {
    apiMs += call.apiMs;
    layers.push(call.layer);
  }
  return { layer: slowestLayer(layers), apiMs, waitedMs: unionWaitMs(calls) };
}

/** Overlapping waits count once. A gap between calls is not a wait. */
function unionWaitMs(calls: ApiCall[]): number {
  const intervals = calls
    .map((call) => {
      const start = call.started;
      const end = call.ended < start ? start : call.ended;
      return { start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let open = false;
  let start = 0;
  let end = 0;
  for (const interval of intervals) {
    if (!open) {
      start = interval.start;
      end = interval.end;
      open = true;
      continue;
    }
    if (interval.start <= end) {
      end = Math.max(end, interval.end);
      continue;
    }
    total += end - start;
    start = interval.start;
    end = interval.end;
  }
  if (open) total += end - start;
  return total;
}

/**
 * Analytics fields for one /v3 tool call. `cacheStatus` keeps its existing
 * meaning (hit, miss, stale, none). The layer name is a separate value.
 */
export function v3ToolMetric(
  latencyMs: number,
  cacheStatus: "hit" | "miss" | "stale" | "none",
): {
  cacheStatus: "hit" | "miss" | "stale" | "none";
  layer: string;
  apiMs: number;
  mcpMs: number;
} {
  const summary = v3ApiSummary();
  const layer = summary.layer ?? "";
  return {
    cacheStatus: layer ? mapApiCacheStatus(layer) : cacheStatus,
    layer,
    apiMs: summary.apiMs,
    // apiMs is a sum and can exceed latencyMs when calls overlap.
    // mcpMs uses the union of those waits, so parallel calls are not subtracted twice.
    mcpMs: Math.max(0, latencyMs - summary.waitedMs),
  };
}

/** Soft answer when the API does not respond in time. The tool does not throw. */
export function slowSourceAnswer(): ToolResult {
  return notAvailable(
    "translation helps",
    "The source was slow.",
    "Try again.",
  );
}

export function parseServerTiming(header: string | null): {
  layer?: AnswerLayer;
  apiMs: number;
} {
  if (!header) return { apiMs: 0 };
  let layer: AnswerLayer | undefined;
  let apiMs = 0;
  for (const part of splitMetrics(header)) {
    const pieces = part.split(";").map((piece) => piece.trim());
    const name = pieces[0] ?? "";
    if (name === "layer") {
      const desc = pieces.find((piece) => piece.startsWith("desc="));
      if (desc) {
        layer = normalizeLayer(unquote(desc.slice("desc=".length)));
      }
    }
    if (name === "total") {
      const dur = pieces.find((piece) => piece.startsWith("dur="));
      if (dur) {
        const value = Number(dur.slice("dur=".length));
        if (Number.isFinite(value)) apiMs = value;
      }
    }
  }
  return { layer, apiMs };
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

function splitMetrics(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of header) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function isTimeoutSignal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "TimeoutError" || name === "AbortError";
}
