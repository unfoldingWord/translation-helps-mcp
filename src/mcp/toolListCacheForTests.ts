/**
 * Test-only controls for the tools/list schema cache.
 *
 * Request handling reads these flags. Nothing here is an MCP tool or an HTTP
 * route, and registerServer.ts does not export them. Vitest is the only
 * caller of the functions named ForTests.
 */

type ClearCache = () => void;

let clearCache: ClearCache = () => {};
let probeAttempts = 0;
let probeFailuresRemaining = 0;
let dropPrivateListHandler = false;

/** Installed by registerServer so a test reset drops the isolate cache. */
export function bindToolListCacheReset(clear: ClearCache): void {
  clearCache = clear;
}

export function resetToolListCacheForTests(): void {
  probeAttempts = 0;
  probeFailuresRemaining = 0;
  dropPrivateListHandler = false;
  clearCache();
}

export function failNextToolListProbeForTests(): void {
  probeFailuresRemaining += 1;
  clearCache();
}

export function toolListProbeAttemptsForTests(): number {
  return probeAttempts;
}

/**
 * The next cache install treats `_requestHandlers` as missing while it looks
 * up the SDK's tools/list handler, then restores the map so the server can
 * still dispatch. One registration consumes this.
 */
export function dropPrivateToolListHandlerForTests(): void {
  dropPrivateListHandler = true;
}

export function noteToolListProbeAttempt(): void {
  probeAttempts += 1;
}

/** True once, when a test asked the next probe to throw. */
export function consumeToolListProbeFailure(): boolean {
  if (probeFailuresRemaining <= 0) return false;
  probeFailuresRemaining -= 1;
  return true;
}

/** True once, when a test asked the next lookup to see a missing map. */
export function consumeDroppedPrivateListHandler(): boolean {
  if (!dropPrivateListHandler) return false;
  dropPrivateListHandler = false;
  return true;
}
