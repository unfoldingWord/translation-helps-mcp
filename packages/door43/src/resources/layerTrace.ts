/**
 * Per-request record of which cache layer supplied data.
 *
 * Catalog and zip reads call `traceLayer` while a request is inside
 * `withDataLayers`. Concurrent requests stay separate. A read outside a
 * request (a background refresh) records nothing.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type TracedLayer = "memory" | "kv" | "r2" | "network";

const storage = new AsyncLocalStorage<TracedLayer[]>();

export function withDataLayers<T>(fn: () => Promise<T>): Promise<T> {
  if (storage.getStore()) return fn();
  return storage.run([], fn);
}

export function traceLayer(layer: TracedLayer): void {
  storage.getStore()?.push(layer);
}

export function dataLayers(): readonly TracedLayer[] {
  return storage.getStore() ?? [];
}
