/**
 * src/api/routes/packs.ts
 *
 * Language packs for tc-study, streamed from the `LANGUAGE_PACKS` bucket:
 *   /v2/packs/{compat}/{lang}           → catalog/{compat}/{lang}.json (the entry; revalidated on every use)
 *   /v2/packs/{compat}/{lang}/{sha256}  → packs/{compat}/{lang}/{sha256}.langpack.zip (immutable)
 *   /v2/packs/{compat}/originals/{sha256} → packs/{compat}/originals/{sha256}.langpack.zip
 *
 * Packs are content-addressed, so the keys an entry names are the keys these paths build. A language that is
 * eligible but has no entry yet answers 202 and asks tc-study's workflow for a build.
 *
 * main's Pages app proxies /v2/* through SvelteKit, which turns a 200 whose ETag equals If-None-Match into its own
 * 304 without the CORS headers, and caches anything public. So this route answers every 304 itself, with CORS, and
 * marks every 202 and 4xx `no-store`.
 */

import {
  catalogSearch,
  listLanguages,
  type CatalogEntry,
} from "@translation-helps/door43";
import { enforceRateLimit } from "../../core/rateLimit.js";
import {
  COMPAT_RE,
  CURRENT_PACK_COMPAT,
  LANGUAGE_RE,
  requestBuild,
  type BuildEnv,
  type BuildOutcome,
} from "../../packs/dispatch.js";
import {
  checkFreshness,
  type PackCatalogEntry,
} from "../../packs/freshness.js";
import { VARIANTS } from "./packViews.js";

export type PacksEnv = {
  LANGUAGE_PACKS?: R2Bucket;
  TRANSLATION_HELPS_CACHE: KVNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
  RATE_LIMIT_RPM?: string;
} & BuildEnv;

/** `unknown` when Door43 could not answer, which must not read as a definite no. */
export type Eligibility = "yes" | "no" | "unknown";

/** What the route needs from Door43 and GitHub; tests pass fakes. */
export type PacksDeps = {
  isEligible: (language: string, env: PacksEnv) => Promise<Eligibility>;
  requestBuild: typeof requestBuild;
  checkFreshness: typeof checkFreshness;
};

type Outcome =
  | "hit"
  | "not-modified"
  | "missing"
  | `preparing-${BuildOutcome}`
  | `unavailable-${BuildOutcome}`
  | "eligibility-unknown"
  | "not-eligible"
  | "old-compat"
  | "unsatisfiable"
  | "bad-request"
  | "preflight"
  | "method-not-allowed"
  | "rate-limited"
  | "unavailable"
  | "error";

type Target = {
  route: "entry" | "pack";
  compat: string;
  lang: string;
  key: string;
};

type Served = { response: Response; outcome: Outcome };

const CORS: Record<string, string> = {
  // The Pages cache in front does not vary by Origin, so the answer must be the same for every origin.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-None-Match",
  "Access-Control-Expose-Headers":
    "ETag, Content-Range, Content-Length, Accept-Ranges",
};
const NO_STORE = "no-store";
const CACHE_CONTROL = {
  entry: "no-cache",
  pack: "public, max-age=31536000, immutable",
} as const;
const CONTENT_TYPE = {
  entry: "application/json",
  pack: "application/zip",
} as const;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Lowercases, resolves the regional variant packs are built under (es → es-419), and validates. The mapping is
 * deliberate, the same variants the views reader uses: a bare `es` pack is never served.
 */
export function normalizePackLanguage(code: string): string | null {
  const lower = code.toLowerCase();
  const resolved = VARIANTS[lower]?.[0] ?? lower;
  return LANGUAGE_RE.test(resolved) ? resolved : null;
}

/** Every segment is checked against a strict pattern, so `..`, `%2F` and the like never reach a bucket key. */
function parsePath(path: string): Target | null {
  const parts = path.split("/");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [compat = "", rawLang = "", sha] = parts;
  if (!COMPAT_RE.test(compat)) return null;
  if (sha === undefined) {
    const lang = normalizePackLanguage(rawLang);
    if (!lang) return null;
    return {
      route: "entry",
      compat,
      lang,
      key: `catalog/${compat}/${lang}.json`,
    };
  }
  if (!SHA256_RE.test(sha)) return null;
  const lang =
    rawLang === "originals" ? "originals" : normalizePackLanguage(rawLang);
  if (!lang) return null;
  return {
    route: "pack",
    compat,
    lang,
    key: `packs/${compat}/${lang}/${sha}.langpack.zip`,
  };
}

/** Etags without quotes or W/, so a client that drops the quotes still gets its 304. */
function parseIfNoneMatch(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((t) =>
      t
        .trim()
        .replace(/^W\//, "")
        .replace(/^"(.*)"$/, "$1"),
    )
    .filter((t) => t !== "");
}

function matches(tags: string[], etag: string): boolean {
  return tags.some((t) => t === "*" || t === etag);
}

/** One `bytes=` range; anything else (several ranges, other units, garbage) is ignored, as RFC 9110 allows. */
function parseRange(header: string | null): R2Range | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, first = "", last = ""] = m;
  if (first === "" && last === "") return null;
  if (first === "") {
    const suffix = Number(last);
    return suffix === 0 ? "unsatisfiable" : { suffix };
  }
  const offset = Number(first);
  if (last === "") return { offset };
  const end = Number(last);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

/** The bytes a satisfiable range covers in an object of `size` bytes, end inclusive. */
function rangeBounds(range: R2Range, size: number): [number, number] {
  if ("suffix" in range) return [Math.max(0, size - range.suffix), size - 1];
  const start = range.offset ?? 0;
  const end =
    range.length === undefined
      ? size - 1
      : Math.min(size, start + range.length) - 1;
  return [start, end];
}

function rangeStart(range: R2Range, size: number): number {
  return rangeBounds(range, size)[0];
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

function notModified(target: Target, object: R2Object): Served {
  return {
    outcome: "not-modified",
    response: new Response(null, {
      status: 304,
      headers: {
        ...CORS,
        ETag: object.httpEtag,
        "Cache-Control": CACHE_CONTROL[target.route],
      },
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

function hasBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return "body" in object && object.body !== undefined;
}

async function serve(
  request: Request,
  bucket: R2Bucket,
  target: Target,
): Promise<Served | null> {
  const tags = parseIfNoneMatch(request.headers.get("If-None-Match"));
  const isHead = request.method === "HEAD";
  const range =
    target.route === "pack" && !isHead
      ? parseRange(request.headers.get("Range"))
      : null;

  // R2 checks a single etag itself and then sends no body; a list or `*` is compared after the read.
  const single = tags.length === 1 && tags[0] !== "*" ? tags[0] : undefined;

  // Without the object's size a bad range cannot be answered, so it is looked up only when one fails.
  const afterBadRange = async (
    known?: R2Object | null,
  ): Promise<Served | null> => {
    const head = known === undefined ? await bucket.head(target.key) : known;
    if (!head) return null;
    if (matches(tags, head.etag)) return notModified(target, head);
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
    return notModified(target, object);
  }
  if (range && rangeStart(range, object.size) >= object.size) {
    if (hasBody(object)) await object.body.cancel();
    return unsatisfiable(object.size);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  // Set after the object's own metadata: the route, not the upload, decides how the answer is cached.
  headers.set("Content-Type", CONTENT_TYPE[target.route]);
  headers.set("Cache-Control", CACHE_CONTROL[target.route]);
  headers.set("ETag", object.httpEtag);
  if (target.route === "pack") headers.set("Accept-Ranges", "bytes");

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

async function respond(
  request: Request,
  env: PacksEnv,
  ctx: ExecutionContext,
  target: Target | null,
  deps: PacksDeps,
): Promise<Served> {
  if (request.method === "OPTIONS") {
    return {
      outcome: "preflight",
      response: new Response(null, { status: 204, headers: CORS }),
    };
  }
  const limited = enforceRateLimit(request, env.RATE_LIMIT_RPM, {
    ...CORS,
    "Cache-Control": NO_STORE,
  });
  if (limited) return { outcome: "rate-limited", response: limited };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return plain(
      405,
      "method-not-allowed",
      { error: "method not allowed" },
      { Allow: "GET, HEAD, OPTIONS" },
    );
  }
  if (!target) return plain(400, "bad-request", { error: "bad pack path" });
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket) {
    return plain(503, "unavailable", { error: "packs are not configured" });
  }

  const served = await serve(request, bucket, target);
  if (served) {
    if (target.route === "entry" && request.method === "GET") {
      // After the answer: the phone gets the entry it has now, and a newer pack is built for its next visit.
      ctx.waitUntil(
        deps.checkFreshness({
          env,
          ctx,
          compat: target.compat,
          language: target.lang,
          entry: () => readEntry(bucket, target.key),
        }),
      );
    }
    return served;
  }
  if (target.route === "pack") {
    return plain(404, "missing", { error: "pack not found" });
  }

  let eligible: Eligibility = "unknown";
  try {
    eligible = await deps.isEligible(target.lang, env);
  } catch (err) {
    console.error(`[packs] eligibility of ${target.lang} unknown:`, err);
  }
  if (eligible === "unknown") {
    return plain(
      503,
      "eligibility-unknown",
      { state: "unavailable" },
      { "Retry-After": "300" },
    );
  }
  if (eligible === "no") {
    return plain(404, "not-eligible", { error: "no packs for this language" });
  }
  // The workflow only builds the current compat; asking for an older one would loop. The app must update.
  if (target.compat !== CURRENT_PACK_COMPAT) {
    return plain(404, "old-compat", {
      state: "unavailable",
      reason: "old-compat",
    });
  }
  // Awaited: this runs only until the language's first build is asked for, and the phone should learn whether one
  // is coming at all.
  const build = await deps.requestBuild({
    env,
    compat: target.compat,
    language: target.lang,
    reason: "missing",
  });
  console.log(`[packs] build for ${target.compat}/${target.lang}: ${build}`);
  if (PREPARING.has(build)) {
    return plain(
      202,
      `preparing-${build}`,
      { state: "preparing" },
      { "Retry-After": "600" },
    );
  }
  return plain(
    503,
    `unavailable-${build}`,
    { state: "unavailable", reason: build },
    { "Retry-After": "3600" },
  );
}

/** Build outcomes after which a pack is on its way; the others need a person (or configuration) first. */
const PREPARING: ReadonlySet<BuildOutcome> = new Set([
  "dispatched",
  "running",
  "cooling",
  "capped",
]);

function resourceId(entry: CatalogEntry): string {
  return (entry.abbreviation || entry.name.split("_").pop() || "").toLowerCase();
}

/** Listed by the tc-ready, prod catalog, with a literal Aligned Bible (glt, ult…) to build the pack from. */
export async function isEligibleLanguage(
  language: string,
  env: PacksEnv,
): Promise<Eligibility> {
  const kv = env.TRANSLATION_HELPS_CACHE;
  try {
    // listLanguages answers [] when Door43 fails, and the catalog is never really empty.
    const languages = await listLanguages(kv);
    if (languages.length === 0) return "unknown";
    const listed = languages.find((l) => l.code.toLowerCase() === language);
    if (!listed) return "no";
    // catalogSearch rethrows Door43's 5xx; a network failure still reads as no bible (and as "no" here).
    const bibles = await catalogSearch({
      lang: listed.code,
      subject: "Aligned Bible",
      kv,
    });
    return bibles.some((e) => resourceId(e).endsWith("lt")) ? "yes" : "no";
  } catch (err) {
    console.error(`[packs] eligibility of ${language} unknown:`, err);
    return "unknown";
  }
}

/** Read again rather than taken from the answer: a 304 has no body, and a 200's body is streamed to the phone. */
async function readEntry(
  bucket: R2Bucket,
  key: string,
): Promise<PackCatalogEntry | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return (await new Response(object.body).json()) as PackCatalogEntry;
}

const DEFAULT_DEPS: PacksDeps = {
  isEligible: isEligibleLanguage,
  requestBuild,
  checkFreshness,
};

/** `path` is what follows `/v2/packs/`, still percent-encoded. */
export async function handlePacks(
  request: Request,
  env: PacksEnv,
  ctx: ExecutionContext,
  path: string,
  deps: PacksDeps = DEFAULT_DEPS,
): Promise<Response> {
  const started = Date.now();
  const target = parsePath(path);
  let outcome: Outcome = "error";
  try {
    const served = await respond(request, env, ctx, target, deps);
    outcome = served.outcome;
    return served.response;
  } catch (err) {
    console.error(`[packs] ${request.method} ${path} failed:`, err);
    return plain(500, "error", { error: "internal error" }).response;
  } finally {
    const analytics = env.ANALYTICS;
    if (analytics) {
      const point = {
        indexes: ["pack"],
        blobs: [
          "pack",
          target?.route ?? "invalid",
          target?.lang ?? "",
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
