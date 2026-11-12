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

const entries = new Map<string, Entry>();

export function resetPacks3CachesForTests(): void {
  entries.clear();
  resetSegmentCacheForTests();
  resetWarnOnceForTests();
}

const hex = (u: ArrayLike<number>) =>
  Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

/** One catalog (`name` is a language or `common`): cached 60 s, then revalidated by ETag; failures remembered 300 s. */
async function loadCatalog(
  bucket: R2Bucket,
  name: string,
  keys: Record<string, Uint8Array>,
  now: number,
): Promise<VerifiedCatalog | null> {
  const e = entries.get(name);
  if (e?.kind === "missing" && now < e.until) return null;
  if (e?.kind === "ok" && now - e.checkedAt < FRESH_MS) return e.v;
  const key = `v3/catalog/${name}.seg`;
  const obj = await bucket.get(
    key,
    e?.kind === "ok" ? { onlyIf: { etagDoesNotMatch: e.etag } } : undefined,
  );
  if (!obj) {
    entries.set(name, { kind: "missing", until: now + MISSING_MS });
    warnOnce(name, "no-catalog");
    return null;
  }
  if (e?.kind === "ok" && !("body" in obj && obj.body)) {
    e.checkedAt = now;
    return e.v;
  }
  try {
    const bytes = new Uint8Array(await (obj as R2ObjectBody).arrayBuffer());
    const v = await verifyCatalogFile(
      bytes,
      { trustedKeys: keys },
      { from: "network" },
    );
    entries.set(name, { kind: "ok", v, etag: obj.etag, checkedAt: now });
    return v;
  } catch (err) {
    entries.set(name, { kind: "missing", until: now + MISSING_MS });
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
    const l = await loadCatalog(bucket, norm, keys, now);
    if (!l) return null;
    const c = await loadCatalog(bucket, "common", keys, now);
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
