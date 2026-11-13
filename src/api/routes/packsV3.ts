/**
 * src/api/routes/packsV3.ts
 *
 * Language packs format 3 (spec/serving.md of bt-synergy's language-pack-v3 package), streamed from the
 * `LANGUAGE_PACKS` bucket under its own `v3/` prefix:
 *   /v3/packs/{lang}/catalog → v3/catalog/{lang}.seg (revalidated on every use)
 *   /v3/packs/common/catalog → v3/catalog/common.seg
 *   /v3/packs/seg/{id}       → v3/seg/{id}.seg (immutable, shared by every language)
 *
 * The Worker never decodes a file and never starts a build: format 3 is built in the same run as the language's
 * format 2.0 parts. The header helpers are those of /v2/packs (./packs.ts), so both prefixes read If-None-Match and
 * Range the same way. `PACKS_V3` must be `on`; anything else answers 404 v3-off.
 */

import { enforceRateLimit } from "../../core/rateLimit.js";
import {
  CORS,
  DEFAULT_PARTS_RPM,
  NO_STORE,
  PARTS_RATE_LIMIT_SCOPE,
  hasBody,
  matches,
  normalizePackLanguage,
  parseIfNoneMatch,
  parseRange,
  rangeBounds,
  rangeStart,
  type PacksEnv,
} from "./packs.js";

type V3Target =
  | {
      route: "catalog";
      lang: string;
      key: string;
      /** Served when `key` is missing: `es` has no pack of its own and falls to `es-419`. */
      alias?: { lang: string; key: string };
    }
  | { route: "seg"; id: string; key: string };

type Outcome =
  | "hit"
  | "not-modified"
  | "missing"
  | "unsatisfiable"
  | "bad-request"
  | "preflight"
  | "method-not-allowed"
  | "rate-limited"
  | "unavailable"
  | "v3-off"
  | "error";

/** `lang`: the language whose catalog answered, when it was the alias of the one asked for. */
type Served = { response: Response; outcome: Outcome; lang?: string };

const CATALOG_CACHE_CONTROL = "no-cache, no-transform";
const SEGMENT_CACHE_CONTROL =
  "public, max-age=31536000, immutable, no-transform";
const CONTENT_TYPE = "application/octet-stream";
/** The id of a segment: sha256 in lowercase hex. Uppercase is a bad path, not an alias. */
const SEGMENT_ID_RE = /^[0-9a-f]{64}$/;
/** `common` has more than 3 letters before any `-`, so it never collides with a language. */
const COMMON = "common";

/**
 * `path` is what follows `/v3/packs/`, still percent-encoded: a `%` never matches the patterns, so `..` and `%2F`
 * never reach a bucket key.
 */
export function parseV3Path(path: string): V3Target | null {
  const parts = path.split("/");
  if (parts.length !== 2) return null;
  const [first = "", second = ""] = parts;
  // `seg` is also a language (Segeju): the second element decides.
  if (first === "seg" && second !== "catalog") {
    if (!SEGMENT_ID_RE.test(second)) return null;
    return { route: "seg", id: second, key: `v3/seg/${second}.seg` };
  }
  if (second !== "catalog") return null;
  if (first === COMMON) {
    return { route: "catalog", lang: COMMON, key: "v3/catalog/common.seg" };
  }
  const lang = normalizePackLanguage(first);
  if (!lang) return null;
  // A code with an alias (VARIANTS) is asked for as itself first: `ar` has its own format 3 pack, and `ar-x-strong` is
  // another one. Only a code that is a VARIANTS key differs from its alias, so `exact` is a plain code.
  const exact = first.toLowerCase();
  if (exact !== lang) {
    return {
      route: "catalog",
      lang: exact,
      key: `v3/catalog/${exact}.seg`,
      alias: { lang, key: `v3/catalog/${lang}.seg` },
    };
  }
  return { route: "catalog", lang, key: `v3/catalog/${lang}.seg` };
}

function cacheControl(target: V3Target): string {
  return target.route === "catalog"
    ? CATALOG_CACHE_CONTROL
    : SEGMENT_CACHE_CONTROL;
}

function plain(
  status: number,
  outcome: Outcome,
  body: unknown,
  extra: Record<string, string> = {},
): Served {
  return {
    outcome,
    response: new Response(JSON.stringify(body), {
      status,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": NO_STORE,
        ...extra,
      },
    }),
  };
}

function notModified(target: V3Target, etag: string): Served {
  return {
    outcome: "not-modified",
    response: new Response(null, {
      status: 304,
      headers: { ...CORS, ETag: etag, "Cache-Control": cacheControl(target) },
    }),
  };
}

function unsatisfiable(size: number): Served {
  return plain(
    416,
    "unsatisfiable",
    { error: "range not satisfiable" },
    { "Content-Range": `bytes */${size}` },
  );
}

async function serve(
  request: Request,
  bucket: R2Bucket,
  target: V3Target,
): Promise<Served | null> {
  const tags = parseIfNoneMatch(request.headers.get("If-None-Match"));
  const isHead = request.method === "HEAD";
  const segment = target.route === "seg";
  // A catalog is whole or nothing: its Range header is ignored. HEAD reads Range like the GET it stands for.
  const range = segment ? parseRange(request.headers.get("Range")) : null;

  // R2 checks a single etag itself and then sends no body; a list or `*` is compared after the read.
  const single = tags.length === 1 && tags[0] !== "*" ? tags[0] : undefined;

  // Without the object's size a bad range cannot be answered, so it is looked up only when one fails.
  const afterBadRange = async (
    known?: R2Object | null,
  ): Promise<Served | null> => {
    const head = known === undefined ? await bucket.head(target.key) : known;
    if (!head) return null;
    if (matches(tags, head.etag)) return notModified(target, head.httpEtag);
    return unsatisfiable(head.size);
  };

  let object: R2Object | R2ObjectBody | null;
  if (range === "unsatisfiable") return afterBadRange();
  if (isHead) {
    object = await bucket.head(target.key);
  } else {
    try {
      object = await bucket.get(target.key, {
        ...(single !== undefined
          ? { onlyIf: { etagDoesNotMatch: single } }
          : {}),
        ...(range ? { range } : {}),
      });
    } catch (err) {
      // R2 rejects a range that starts past the end instead of answering it.
      if (!range) throw err;
      const head = await bucket.head(target.key);
      if (head && rangeStart(range, head.size) < head.size) throw err;
      return afterBadRange(head);
    }
  }
  if (!object) return null;

  if (matches(tags, object.etag)) {
    if (hasBody(object)) await object.body.cancel();
    return notModified(target, object.httpEtag);
  }
  if (range && rangeStart(range, object.size) >= object.size) {
    if (hasBody(object)) await object.body.cancel();
    return unsatisfiable(object.size);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  // Set after the object's own metadata: the route, not the upload, decides how the answer is cached. The client
  // hashes the decompressed body of a segment, and a catalog entry's size is the file's length, so the bytes on the
  // wire are the stored bytes: no Content-Encoding, whatever the upload carried.
  headers.set("Content-Type", CONTENT_TYPE);
  headers.set("Cache-Control", cacheControl(target));
  headers.set("ETag", object.httpEtag);
  headers.delete("Content-Encoding");
  if (segment) headers.set("Accept-Ranges", "bytes");

  let status = 200;
  if (range) {
    const [start, end] = rangeBounds(range, object.size);
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(end - start + 1));
  } else {
    headers.set("Content-Length", String(object.size));
  }
  const body = !isHead && hasBody(object) ? object.body : null;
  return { outcome: "hit", response: new Response(body, { status, headers }) };
}

/**
 * Check order: OPTIONS, rate limit, method (405), PACKS_V3 off (404 v3-off), bad path (400), no bucket (503), then
 * the object (404 when missing).
 */
async function respond(
  request: Request,
  env: PacksEnv & { PACKS_V3?: string },
  target: V3Target | null,
): Promise<Served> {
  if (request.method === "OPTIONS") {
    return {
      outcome: "preflight",
      response: new Response(null, { status: 204, headers: CORS }),
    };
  }
  const limitHeaders = { ...CORS, "Cache-Control": NO_STORE };
  const limited =
    target?.route === "seg"
      ? enforceRateLimit(request, env.PARTS_RATE_LIMIT_RPM, limitHeaders, {
          scope: PARTS_RATE_LIMIT_SCOPE,
          fallbackRpm: DEFAULT_PARTS_RPM,
        })
      : enforceRateLimit(request, env.RATE_LIMIT_RPM, limitHeaders);
  if (limited) return { outcome: "rate-limited", response: limited };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return plain(
      405,
      "method-not-allowed",
      { error: "method not allowed" },
      { Allow: "GET, HEAD, OPTIONS" },
    );
  }
  if (env.PACKS_V3 !== "on") {
    return plain(404, "v3-off", { state: "unavailable", reason: "v3-off" });
  }
  if (!target) return plain(400, "bad-request", { error: "bad pack path" });
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket) {
    return plain(503, "unavailable", { error: "packs are not configured" });
  }

  const served = await serve(request, bucket, target);
  if (served) return served;
  if (target.route === "catalog" && target.alias) {
    const aliased = await serve(request, bucket, {
      route: "catalog",
      ...target.alias,
    });
    if (aliased) return { ...aliased, lang: target.alias.lang };
  }
  return target.route === "catalog"
    ? plain(404, "missing", { error: "catalog not found" })
    : plain(404, "missing", { error: "segment not found" });
}

/** `path` is what follows `/v3/packs/`, still percent-encoded. */
export async function handlePacksV3Request(
  request: Request,
  env: PacksEnv & { PACKS_V3?: string },
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  const started = Date.now();
  const target = parseV3Path(path);
  let outcome: Outcome = "error";
  let servedLang: string | undefined;
  // HEAD gives the headers of the GET it stands for with no body, errors included.
  const bodiless = (res: Response): Response =>
    request.method === "HEAD" && res.body
      ? new Response(null, { status: res.status, headers: res.headers })
      : res;
  try {
    const served = await respond(request, env, target);
    outcome = served.outcome;
    servedLang = served.lang;
    return bodiless(served.response);
  } catch (err) {
    console.error(`[packs-v3] ${request.method} ${path} failed:`, err);
    return bodiless(plain(500, "error", { error: "internal error" }).response);
  } finally {
    const analytics = env.ANALYTICS;
    if (analytics) {
      const point = {
        indexes: ["pack"],
        blobs: [
          "pack",
          target ? `v3-${target.route}` : "invalid",
          target?.route === "catalog" ? (servedLang ?? target.lang) : "",
          outcome,
        ],
        doubles: [Date.now() - started],
      };
      ctx.waitUntil(
        Promise.resolve()
          .then(() => analytics.writeDataPoint(point))
          .catch(() => {}),
      );
    }
  }
}
