import {
  verifyCatalogFile,
  type VerifiedCatalog,
} from "../../vendor/language-pack-client/index.js";
import { normalizePackLanguage } from "../api/routes/packs";
import { parseTrustedKeys, resetWarnOnceForTests, warnOnce } from "./keys";
import { resetSegmentCacheForTests } from "./segments";

export type Packs3Env = {
  LANGUAGE_PACKS?: R2Bucket;
  PACKS_V3?: string;
  PACKS_V3_TRUSTED_KEYS?: string;
};

export type Catalogs3 = {
  lang: string;
  key: string;
  catalogs: VerifiedCatalog[];
};

const FRESH_MS = 60_000;
const MISSING_MS = 300_000;

type Entry =
  | { kind: "ok"; v: VerifiedCatalog; etag: string; checkedAt: number }
  | { kind: "missing"; until: number };

/** Per bucket, then keyed by trusted-keys string and catalog name, so other keys never reuse a verified pair. */
type Store = {
  entries: Map<string, Entry>;
  inflight: Map<string, Promise<VerifiedCatalog | null>>;
};
let stores = new WeakMap<object, Store>();
let generation = 0;

export function resetPacks3CachesForTests(): void {
  stores = new WeakMap();
  generation++;
  resetSegmentCacheForTests();
  resetWarnOnceForTests();
}

const hex = (u: ArrayLike<number>) =>
  Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

function loadCatalog(
  bucket: R2Bucket,
  name: string,
  keysRaw: string,
  keys: Record<string, Uint8Array>,
  now: number,
): Promise<VerifiedCatalog | null> {
  let store = stores.get(bucket);
  if (!store) {
    store = { entries: new Map(), inflight: new Map() };
    stores.set(bucket, store);
  }
  const k = `${keysRaw}|${name}`;
  const e = store.entries.get(k);
  if (e?.kind === "missing" && now < e.until) return Promise.resolve(null);
  if (e?.kind === "ok" && now - e.checkedAt < FRESH_MS)
    return Promise.resolve(e.v);
  const running = store.inflight.get(k);
  if (running) return running;
  const gen = generation;
  const st = store;
  // A result is stored only if nothing replaced the entry (or the caches) while the read was in flight.
  const put = (v: Entry) => {
    if (gen === generation && st.entries.get(k) === e) st.entries.set(k, v);
  };
  const p = refresh(bucket, name, keys, now, e, put).finally(() => {
    if (st.inflight.get(k) === p) st.inflight.delete(k);
  });
  st.inflight.set(k, p);
  return p;
}

/** One catalog (`name` is a language or `common`): cached 60 s, then revalidated by ETag; rejections remembered 300 s. */
async function refresh(
  bucket: R2Bucket,
  name: string,
  keys: Record<string, Uint8Array>,
  now: number,
  e: Entry | undefined,
  put: (v: Entry) => void,
): Promise<VerifiedCatalog | null> {
  const key = `v3/catalog/${name}.seg`;
  const obj = await bucket.get(
    key,
    e?.kind === "ok" ? { onlyIf: { etagDoesNotMatch: e.etag } } : undefined,
  );
  if (!obj) {
    put({ kind: "missing", until: now + MISSING_MS });
    warnOnce(name, "no-catalog");
    return null;
  }
  if (e?.kind === "ok" && !("body" in obj && obj.body)) {
    put({ ...e, checkedAt: now });
    return e.v;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await (obj as R2ObjectBody).arrayBuffer());
  } catch {
    // Transient: not a rejection, so nothing is remembered.
    warnOnce(name, "r2-read-error");
    return null;
  }
  try {
    const v = await verifyCatalogFile(
      bytes,
      { trustedKeys: keys },
      { from: "network" },
    );
    put({ kind: "ok", v, etag: obj.etag, checkedAt: now });
    return v;
  } catch (err) {
    put({ kind: "missing", until: now + MISSING_MS });
    const code = (err as { code?: string }).code ?? "error";
    warnOnce(name, `catalog-rejected:${code}`);
    return null;
  }
}

/** Verified language and common catalogs, or `null` when format 3 cannot answer for this language here. */
export async function getCatalogs(
  env: Packs3Env,
  lang: string,
  now: number = Date.now(),
): Promise<Catalogs3 | null> {
  if (env.PACKS_V3 !== "on") return null;
  const keysRaw = env.PACKS_V3_TRUSTED_KEYS ?? "";
  const keys = parseTrustedKeys(env.PACKS_V3_TRUSTED_KEYS);
  if (!keys) return null;
  const norm = normalizePackLanguage(lang);
  if (!norm) return null;
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket) {
    warnOnce(norm, "no-bucket");
    return null;
  }
  try {
    const l = await loadCatalog(bucket, norm, keysRaw, keys, now);
    if (!l) return null;
    const c = await loadCatalog(bucket, "common", keysRaw, keys, now);
    if (!c) return null;
    const req = (l.catalog as { requires?: unknown }).requires;
    const wanted = (Array.isArray(req) ? req : []).find(
      (r) => Array.isArray(r) && r[0] === "common",
    ) as unknown[] | undefined;
    const id = wanted?.[2];
    if (
      !id ||
      typeof id !== "object" ||
      hex(id as ArrayLike<number>) !== c.id
    ) {
      warnOnce(norm, "common-mismatch");
      return null;
    }
    return { lang: norm, key: `${l.id}+${c.id}`, catalogs: [l, c] };
  } catch {
    warnOnce(norm, "r2-error");
    return null;
  }
}
