/**
 * src/api/routes/packs.ts
 *
 * Language packs for tc-study, streamed from the `LANGUAGE_PACKS` bucket:
 *   /v2/packs/{compat}/{lang}           → catalog/{compat}/{lang}.json (the entry; revalidated on every use)
 *   /v2/packs/{compat}/{lang}/{sha256}  → packs/{compat}/{lang}/{sha256}.langpack.zip (immutable)
 *   /v2/packs/{compat}/originals/{sha256} → packs/{compat}/originals/{sha256}.langpack.zip
 *
 * Under a parts compat (format 2 and later) the entry is the language's parts list, and:
 *   /v2/packs/{compat}/originals/{sha256} → catalog/{compat}/originals/{sha256}.json (the originals list; immutable)
 *   /v2/packs/parts/{sha256}            → parts/{sha256}.part.gz (immutable, shared by every compat and language)
 *
 * Packs and parts are content-addressed, so the keys a list names are the keys these paths build. A language that
 * is eligible but has no entry yet answers 202 and asks tc-study's workflow for a build.
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
  CURRENT_PARTS_COMPAT,
  LANGUAGE_RE,
  isBuildableCompat,
  isPartsCompat,
  partsDispatchEnabled,
  requestBuild,
  type BuildEnv,
  type BuildOutcome,
} from "../../packs/dispatch.js";
import {
  checkFreshness,
  type PackCatalogEntry,
} from "../../packs/freshness.js";
import {
  checkPartsFreshness,
  type PartsListLite,
} from "../../packs/partsFreshness.js";
import { VARIANTS } from "./packViews.js";

export type PacksEnv = {
  LANGUAGE_PACKS?: R2Bucket;
  TRANSLATION_HELPS_CACHE: KVNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
  RATE_LIMIT_RPM?: string;
  /** Max part requests/min per IP, counted apart from RATE_LIMIT_RPM. Default 600; 0 = off. */
  PARTS_RATE_LIMIT_RPM?: string;
} & BuildEnv;

/** `unknown` when Door43 could not answer, which must not read as a definite no. */
export type Eligibility = "yes" | "no" | "unknown";

/** What the route needs from Door43 and GitHub; tests pass fakes. */
export type PacksDeps = {
  isEligible: (language: string, env: PacksEnv) => Promise<Eligibility>;
  requestBuild: typeof requestBuild;
  checkFreshness: typeof checkFreshness;
  checkPartsFreshness: typeof checkPartsFreshness;
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
  | "parts-off"
  | "unsatisfiable"
  | "bad-request"
  | "preflight"
  | "method-not-allowed"
  | "rate-limited"
  | "unavailable"
  | "error";

type Target = {
  route: "entry" | "pack" | "originals" | "part";
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
const IMMUTABLE = "public, max-age=31536000, immutable";
const CACHE_CONTROL = {
  entry: "no-cache",
  pack: IMMUTABLE,
  // A JSON list may be compressed on its way: fetch hands the app the decoded bytes, which are the stored ones.
  originals: IMMUTABLE,
  // A part is gzip the app hashes as stored: no cache or proxy may recompress or re-encode it.
  part: `${IMMUTABLE}, no-transform`,
} as const;
const CONTENT_TYPE = {
  entry: "application/json",
  pack: "application/zip",
  originals: "application/json",
  part: "application/gzip",
} as const;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** About 730 requests download all of English; a limit of their own keeps them from blocking list checks. */
const PARTS_RATE_LIMIT_SCOPE = "parts";
const DEFAULT_PARTS_RPM = 600;

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
  // `parts` can never be a compat, so it cannot shadow one.
  if (compat === "parts" && sha === undefined) {
    if (!SHA256_RE.test(rawLang)) return null;
    return {
      route: "part",
      compat: "",
      lang: "",
      key: `parts/${rawLang}.part.gz`,
    };
  }
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
  if (isPartsCompat(compat)) {
    // A parts compat has no per-language packs: a language's parts are under /v2/packs/parts/.
    if (rawLang !== "originals") return null;
    return {
      route: "originals",
      compat,
      lang: "originals",
      key: `catalog/${compat}/originals/${sha}.json`,
    };
  }
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
  const ranged = target.route === "pack" || target.route === "part";
  const range =
    ranged && !isHead ? parseRange(request.headers.get("Range")) : null;

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
  if (ranged) headers.set("Accept-Ranges", "bytes");
  // The app checks the sha256 of the gzip bytes themselves. With a Content-Encoding, whatever the upload carried,
  // the runtime would compress them again or a browser would hand the app the decoded bytes.
  if (target.route === "part") headers.delete("Content-Encoding");

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
  const limitHeaders = { ...CORS, "Cache-Control": NO_STORE };
  const limited =
    target?.route === "part"
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
  if (!target) return plain(400, "bad-request", { error: "bad pack path" });
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket) {
    return plain(503, "unavailable", { error: "packs are not configured" });
  }

  const served = await serve(request, bucket, target);
  if (served) {
    // After the answer: the phone gets the entry it has now, and a newer one is built for its next visit.
    if (target.route === "entry" && request.method === "GET") {
      if (isPartsCompat(target.compat)) {
        ctx.waitUntil(
          deps.checkPartsFreshness({
            env,
            ctx,
            compat: target.compat,
            language: target.lang,
            list: () => readEntry<PartsListLite>(bucket, target.key),
          }),
        );
      } else {
        ctx.waitUntil(
          deps.checkFreshness({
            env,
            ctx,
            compat: target.compat,
            language: target.lang,
            entry: () => readEntry<PackCatalogEntry>(bucket, target.key),
          }),
        );
      }
    }
    return served;
  }
  if (target.route === "pack") {
    return plain(404, "missing", { error: "pack not found" });
  }
  if (target.route === "part") {
    return plain(404, "missing", { error: "part not found" });
  }
  if (target.route === "originals") {
    return plain(404, "missing", { error: "originals list not found" });
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
  // The workflow only builds the current compats; asking for an older one would loop. The app must update.
  if (!isBuildableCompat(target.compat)) {
    return plain(404, "old-compat", {
      state: "unavailable",
      reason: "old-compat",
    });
  }
  // Not old-compat: the app is current, this Worker just does not ask for parts builds yet (PACKS_PARTS_DISPATCH).
  if (target.compat === CURRENT_PARTS_COMPAT && !partsDispatchEnabled(env)) {
    return plain(404, "parts-off", {
      state: "unavailable",
      reason: "parts-off",
    });
  }
  // Awaited: this runs only until the language's first build is asked for, and the phone should learn whether one
  // is coming at all. The lowercase code, not Door43's spelling: the workflow keys catalog/, packs/ and status/ by
  // the code it is given, and this route reads them lowercased (Door43's catalog search ignores case).
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

/**
 * The resource id from the repo name (`es-419_glt` → `glt`), as tc-study's build takes it. The abbreviation is
 * the publisher's own and may be in the language: es-419_glt's is `tpl` (Texto Puente Literal).
 */
function resourceId(entry: CatalogEntry): string {
  return (entry.name.split("_").pop() || "").toLowerCase();
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
async function readEntry<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return (await new Response(object.body).json()) as T;
}

const DEFAULT_DEPS: PacksDeps = {
  isEligible: isEligibleLanguage,
  requestBuild,
  checkFreshness,
  checkPartsFreshness,
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
