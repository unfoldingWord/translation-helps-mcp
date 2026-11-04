/**
 * Server-Timing for the REST routes /v3 calls.
 *
 * The header names the layer that answered (the slowest, when several did)
 * and the time this request spent, plus any durations the route already
 * recorded. It never carries a path, a cache key, or anything the caller sent.
 */

import { dataLayers, withDataLayers } from "@translation-helps/door43";
import { AsyncLocalStorage } from "node:async_hooks";

export const ANSWER_LAYERS = [
  "views",
  "memory",
  "kv",
  "r2",
  "network",
] as const;

export type AnswerLayer = (typeof ANSWER_LAYERS)[number];

/** Higher means slower. The header reports the highest layer that answered. */
const SLOWNESS: Record<AnswerLayer, number> = {
  views: 0,
  memory: 1,
  kv: 2,
  r2: 3,
  network: 4,
};

const TIMING_NAME = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

interface Scope {
  t0: number;
  layers: AnswerLayer[];
  timings: Record<string, number>;
}

const scope = new AsyncLocalStorage<Scope>();

export function serverTimingActive(): boolean {
  return scope.getStore() !== undefined;
}

export function withServerTiming<T>(fn: () => Promise<T>): Promise<T> {
  if (scope.getStore()) return fn();
  return withDataLayers(() =>
    scope.run({ t0: Date.now(), layers: [], timings: {} }, fn),
  );
}

/** Map a cache label the routes already use onto a header layer. */
export function normalizeLayer(
  value: string | undefined | null,
): AnswerLayer | undefined {
  if (!value) return undefined;
  if (value === "pack") return "views";
  if ((ANSWER_LAYERS as readonly string[]).includes(value)) {
    return value as AnswerLayer;
  }
  return undefined;
}

export function slowestLayer(
  layers: Array<string | undefined | null>,
): AnswerLayer | undefined {
  let best: AnswerLayer | undefined;
  let rank = -1;
  for (const raw of layers) {
    const layer = normalizeLayer(raw);
    if (!layer) continue;
    if (SLOWNESS[layer] > rank) {
      rank = SLOWNESS[layer];
      best = layer;
    }
  }
  return best;
}

export function noteLayer(layer: string | undefined | null): void {
  const normalized = normalizeLayer(layer);
  const current = scope.getStore();
  if (!current || !normalized) return;
  current.layers.push(normalized);
}

export function currentAnswerLayer(): AnswerLayer | undefined {
  const current = scope.getStore();
  return slowestLayer([...(current?.layers ?? []), ...dataLayers()]);
}

export function formatServerTiming(input: {
  layer?: string | null;
  totalMs: number;
  timings?: Record<string, number> | null;
}): string {
  const parts: string[] = [];
  const layer = normalizeLayer(input.layer);
  if (layer) parts.push(`layer;desc="${layer}"`);
  parts.push(`total;dur=${duration(input.totalMs)}`);
  if (input.timings) {
    for (const [name, value] of Object.entries(input.timings)) {
      if (!TIMING_NAME.test(name) || name === "total" || name === "layer") {
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      parts.push(`${name};dur=${duration(value)}`);
    }
  }
  return parts.join(", ");
}

function duration(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return String(Math.round(value));
}

function metaOf(body: unknown): {
  layer?: AnswerLayer;
  timings?: Record<string, number>;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const meta = (body as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const record = meta as { cache?: unknown; timings?: unknown };
  const layer =
    typeof record.cache === "string" ? normalizeLayer(record.cache) : undefined;
  const timings: Record<string, number> = {};
  if (record.timings && typeof record.timings === "object") {
    for (const [name, value] of Object.entries(
      record.timings as Record<string, unknown>,
    )) {
      if (typeof value === "number" && Number.isFinite(value)) {
        timings[name] = value;
      }
    }
  }
  return { layer, timings };
}

/**
 * Header for the active request, or null when this response is not one of
 * the timed routes. Traced layers win over `meta.cache`, so a label of
 * "network" on an empty catalog does not hide a kv hit that actually answered.
 */
export function serverTimingHeader(body: unknown): string | null {
  const current = scope.getStore();
  if (!current) return null;
  const meta = metaOf(body);
  const traced = slowestLayer([...current.layers, ...dataLayers()]);
  return formatServerTiming({
    layer: traced ?? meta.layer,
    totalMs: Date.now() - current.t0,
    timings: meta.timings,
  });
}
