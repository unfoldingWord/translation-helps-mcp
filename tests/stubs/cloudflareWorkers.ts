/**
 * Minimal stand-in for the `cloudflare:workers` runtime so Vitest can import
 * `agents/mcp` (which extends DurableObject) under Node.
 */
export class DurableObject {
  ctx: unknown;
  env: unknown;
  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}

export const exports: Record<string, unknown> = {};

export const tracing = undefined;
