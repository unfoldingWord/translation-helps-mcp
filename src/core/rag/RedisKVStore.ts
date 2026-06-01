/**
 * Upstash Redis KVStore (production free tier: 10K cmds/day).
 *
 * Uses @upstash/redis REST client — works in both Node and Cloudflare Workers.
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL   — Upstash REST endpoint
 *   UPSTASH_REDIS_REST_TOKEN — Upstash REST token
 *
 * Fallback: if env vars are missing in dev, operations silently no-op
 * and return null/false (caller should catch degradation via health()).
 */

import { Redis } from "@upstash/redis";
import type { KVStore } from "./interfaces.js";

export class RedisKVStore implements KVStore {
  private readonly redis: Redis | null;

  constructor(options?: { url?: string; token?: string }) {
    const url = options?.url ?? process.env["UPSTASH_REDIS_REST_URL"];
    const token = options?.token ?? process.env["UPSTASH_REDIS_REST_TOKEN"];
    if (url && token) {
      this.redis = new Redis({ url, token });
    } else {
      this.redis = null;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const val = await this.redis.get<string>(key);
      return val ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.redis) return;
    try {
      if (ttlSeconds !== undefined) {
        await this.redis.set(key, value, { ex: ttlSeconds });
      } else {
        await this.redis.set(key, value);
      }
    } catch {
      // Degrade gracefully — log in caller if needed
    }
  }

  async del(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(key);
    } catch {
      // Degrade gracefully
    }
  }

  async setNx(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (!this.redis) return true; // Degrade: treat as if lock acquired
    try {
      let result: unknown;
      if (ttlSeconds !== undefined) {
        result = await this.redis.set(key, value, { nx: true, ex: ttlSeconds });
      } else {
        result = await this.redis.set(key, value, { nx: true });
      }
      return result !== null;
    } catch {
      return true; // Degrade: treat as if lock acquired
    }
  }

  /** Returns true if the Redis client is configured and reachable */
  async health(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}
