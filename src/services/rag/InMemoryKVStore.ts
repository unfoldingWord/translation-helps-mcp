/**
 * In-memory KVStore — for unit tests and single-worker local dev.
 * No persistence; values evict on process restart.
 */

import type { KVStore } from "./interfaces.js";

interface Entry {
  value: string;
  expiresAt?: number; // epoch ms
}

export class InMemoryKVStore implements KVStore {
  private readonly data = new Map<string, Entry>();

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : undefined;
    this.data.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  async setNx(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    const existing = await this.get(key);
    if (existing !== null) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  /** Test helper */
  size(): number {
    return this.data.size;
  }

  /** Test helper */
  clear(): void {
    this.data.clear();
  }
}
