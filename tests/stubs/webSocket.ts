/**
 * Globals Node 22 has and Node 20 does not. CI runs Node 20
 * (`.github/workflows/ci.yml`). Importing `agents` evaluates
 * `src/lifecycle/connection.ts`, which reads `WebSocket` at load time
 * (`"OPEN" in WebSocket`). The session path later does
 * `new URLPattern({ pathname })`. Leave a runtime that already has them.
 *
 * `OPEN` is present so agents skips its workerd polyfill (`READY_STATE_*`).
 * The URLPattern stand-in matches the literal pathnames `agents` builds
 * (`/v2/mcp`, `/mcp`, and a trailing `/*`). These tests never open a socket.
 * The session path uses a Durable Object double with its own plain object.
 */
if (typeof globalThis.WebSocket !== "function") {
  class Node20WebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    /** workerd names, if a future agents build takes the polyfill branch. */
    static READY_STATE_CONNECTING = 0;
    static READY_STATE_OPEN = 1;
    static READY_STATE_CLOSING = 2;
    static READY_STATE_CLOSED = 3;
  }

  globalThis.WebSocket = Node20WebSocket as unknown as typeof WebSocket;
}

const runtime = globalThis as typeof globalThis & { URLPattern?: unknown };

if (typeof runtime.URLPattern !== "function") {
  class Node20URLPattern {
    private readonly pathname: string;

    constructor(input: string | { pathname?: string } = {}) {
      this.pathname =
        typeof input === "string" ? input : (input.pathname ?? "/*");
    }

    test(input: string | URL | { pathname?: string }): boolean {
      const pathname = pathnameOf(input);
      const pattern = this.pathname;
      if (pattern === "*" || pattern === "/*") return true;
      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -1);
        return pathname === pattern.slice(0, -2) || pathname.startsWith(prefix);
      }
      return pathname === pattern;
    }
  }

  runtime.URLPattern = Node20URLPattern;
}

function pathnameOf(input: string | URL | { pathname?: string }): string {
  if (typeof input === "string") {
    try {
      return new URL(input).pathname;
    } catch {
      return input;
    }
  }
  if (input instanceof URL) return input.pathname;
  return input.pathname ?? "/";
}
