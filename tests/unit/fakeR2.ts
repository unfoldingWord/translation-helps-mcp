/**
 * An in-memory R2 bucket for the packs tests: `list` with prefix, delimiter, cursor and a page size (R2 pages hold at
 * most 1000 objects), objects with `etag`, `size` and `uploaded`, plus `get`, `head`, `put` and `delete(keys)`. Every
 * call is recorded in `ops`, `fail` makes a call throw, to stand in for an R2 error, and `before` runs before each
 * call, to change the bucket mid-run.
 */

export type StoredObject = {
  text: string;
  etag: string;
  uploaded: Date;
  size: number;
};

export type FakeR2Op = { op: string; key?: string; o?: unknown };

let etags = 0;

export function fakeR2(
  initial: Record<string, string | { text: string; uploaded?: Date }> = {},
  opts: { pageSize?: number; now?: Date } = {},
) {
  const objects = new Map<string, StoredObject>();
  const ops: FakeR2Op[] = [];
  const deleted: string[] = [];
  /** Throws for a call whose op and key (or list prefix) match. */
  const fail: Array<(op: string, key: string) => boolean> = [];
  const store = (key: string, text: string, uploaded?: Date) => {
    objects.set(key, {
      text,
      etag: `etag-${++etags}`,
      uploaded: uploaded ?? opts.now ?? new Date(),
      size: new TextEncoder().encode(text).length,
    });
  };
  for (const [key, v] of Object.entries(initial)) {
    if (typeof v === "string") store(key, v);
    else store(key, v.text, v.uploaded);
  }
  /** Called before every call, to change the bucket mid-run as a build would. */
  const before: Array<(op: string, key: string) => void> = [];
  const check = (op: string, key: string) => {
    for (const hook of before) hook(op, key);
    if (fail.some((f) => f(op, key))) throw new Error(`R2 ${op} ${key} failed`);
  };
  const body = (key: string, o: StoredObject) => ({
    key,
    etag: o.etag,
    httpEtag: `"${o.etag}"`,
    size: o.size,
    uploaded: o.uploaded,
    text: async () => o.text,
    json: async () => JSON.parse(o.text),
    arrayBuffer: async () => new TextEncoder().encode(o.text).buffer,
  });
  const bucket = {
    async list(
      o: {
        prefix?: string;
        cursor?: string;
        delimiter?: string;
        limit?: number;
      } = {},
    ) {
      ops.push({ op: "list", key: o.prefix, o });
      check("list", o.prefix ?? "");
      const prefix = o.prefix ?? "";
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort();
      // With a delimiter, a key with another `/` after the prefix is rolled up into its folder.
      const entries: Array<{ key: string } | { folder: string }> = [];
      const folders = new Set<string>();
      for (const key of keys) {
        const rest = key.slice(prefix.length);
        const cut = o.delimiter ? rest.indexOf(o.delimiter) : -1;
        if (cut >= 0) {
          const folder = prefix + rest.slice(0, cut + 1);
          if (!folders.has(folder)) {
            folders.add(folder);
            entries.push({ folder });
          }
        } else entries.push({ key });
      }
      const size = Math.min(o.limit ?? 1000, opts.pageSize ?? 1000);
      const start = Number(o.cursor ?? "0");
      const page = entries.slice(start, start + size);
      const next = start + size;
      return {
        objects: page
          .filter((e): e is { key: string } => "key" in e)
          .map((e) => {
            const { text: _t, ...meta } = objects.get(e.key)!;
            return { key: e.key, ...meta, httpEtag: `"${meta.etag}"` };
          }),
        delimitedPrefixes: page
          .filter((e): e is { folder: string } => "folder" in e)
          .map((e) => e.folder),
        truncated: next < entries.length,
        ...(next < entries.length ? { cursor: String(next) } : {}),
      };
    },
    async get(key: string) {
      ops.push({ op: "get", key });
      check("get", key);
      const o = objects.get(key);
      return o ? body(key, o) : null;
    },
    async head(key: string) {
      ops.push({ op: "head", key });
      check("head", key);
      const o = objects.get(key);
      return o
        ? { key, etag: o.etag, size: o.size, uploaded: o.uploaded }
        : null;
    },
    async put(key: string, value: string, o?: unknown) {
      ops.push({ op: "put", key, o });
      check("put", key);
      store(key, value);
      return { key, etag: objects.get(key)!.etag };
    },
    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      ops.push({ op: "delete", o: list });
      for (const key of list) check("delete", key);
      for (const key of list) {
        if (objects.delete(key)) deleted.push(key);
      }
    },
  };
  return {
    bucket: bucket as unknown as R2Bucket,
    objects,
    ops,
    deleted,
    fail,
    before,
    /** Writes as a build would: a new etag and `uploaded`. */
    put: (key: string, text: string, uploaded?: Date) =>
      store(key, text, uploaded),
  };
}

/** KV that keeps values without expiring them. */
export function fakeKv() {
  const values = new Map<string, string>();
  const puts: Array<{ key: string; value: string; ttl?: number }> = [];
  const kv = {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string, o?: { expirationTtl?: number }) {
      values.set(key, value);
      puts.push({ key, value, ttl: o?.expirationTtl });
    },
  };
  return { kv: kv as unknown as KVNamespace, values, puts };
}
