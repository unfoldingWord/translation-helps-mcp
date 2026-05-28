import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryKVStore } from "../../src/services/rag/InMemoryKVStore.js";
import { CFKVStore } from "../../src/services/rag/CFKVStore.js";
import type { KVNamespaceLike } from "../../src/services/rag/interfaces.js";

describe("InMemoryKVStore", () => {
  let store: InMemoryKVStore;

  beforeEach(() => {
    store = new InMemoryKVStore();
  });

  it("get returns null for missing key", async () => {
    expect(await store.get("missing")).toBeNull();
  });

  it("set and get roundtrip", async () => {
    await store.set("hello", "world");
    expect(await store.get("hello")).toBe("world");
  });

  it("del removes a key", async () => {
    await store.set("foo", "bar");
    await store.del("foo");
    expect(await store.get("foo")).toBeNull();
  });

  it("TTL evicts key after expiry (simulated via past timestamp)", async () => {
    // set with 1-second TTL then immediately expire by manipulating time
    // We test via direct internal access (white-box for unit test)
    const store2 = new InMemoryKVStore();
    await store2.set("ttl-key", "ttl-value", -1); // already expired
    expect(await store2.get("ttl-key")).toBeNull();
  });

  it("setNx returns true when key does not exist", async () => {
    const ok = await store.setNx("lock", "1", 30);
    expect(ok).toBe(true);
    expect(await store.get("lock")).toBe("1");
  });

  it("setNx returns false when key already exists", async () => {
    await store.set("lock", "existing");
    const ok = await store.setNx("lock", "new-value", 30);
    expect(ok).toBe(false);
    expect(await store.get("lock")).toBe("existing");
  });

  it("size tracks number of stored entries", async () => {
    await store.set("a", "1");
    await store.set("b", "2");
    expect(store.size()).toBe(2);
  });

  it("clear removes all entries", async () => {
    await store.set("a", "1");
    store.clear();
    expect(store.size()).toBe(0);
    expect(await store.get("a")).toBeNull();
  });
});

describe("CFKVStore (mock KV namespace)", () => {
  function makeMockKV(): { kv: KVNamespaceLike; store: Map<string, string> } {
    const store = new Map<string, string>();
    const kv: KVNamespaceLike = {
      async get(key) {
        return store.get(key) ?? null;
      },
      async put(key, value) {
        store.set(key, value);
      },
      async delete(key) {
        store.delete(key);
      },
    };
    return { kv, store };
  }

  it("get returns null for missing key", async () => {
    const { kv } = makeMockKV();
    const cfKv = new CFKVStore(kv);
    expect(await cfKv.get("missing")).toBeNull();
  });

  it("set and get roundtrip", async () => {
    const { kv } = makeMockKV();
    const cfKv = new CFKVStore(kv);
    await cfKv.set("hello", "world");
    expect(await cfKv.get("hello")).toBe("world");
  });

  it("del removes a key", async () => {
    const { kv } = makeMockKV();
    const cfKv = new CFKVStore(kv);
    await cfKv.set("foo", "bar");
    await cfKv.del("foo");
    expect(await cfKv.get("foo")).toBeNull();
  });

  it("setNx returns true when key is absent", async () => {
    const { kv } = makeMockKV();
    const cfKv = new CFKVStore(kv);
    const ok = await cfKv.setNx("lock", "1");
    expect(ok).toBe(true);
  });

  it("setNx returns false when key is present", async () => {
    const { kv } = makeMockKV();
    const cfKv = new CFKVStore(kv);
    await cfKv.set("lock", "existing");
    const ok = await cfKv.setNx("lock", "new");
    expect(ok).toBe(false);
    expect(await cfKv.get("lock")).toBe("existing");
  });
});
